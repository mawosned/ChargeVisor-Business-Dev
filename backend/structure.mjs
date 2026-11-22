// Persistent site -> station -> connector management for ChargeVisor Business.
// This module NEVER reads or writes the standalone BLITZ OCPP database.
import {randomUUID, randomBytes} from 'node:crypto';
import {hashPassword} from './auth.mjs';

// One random technical identity per OCPP connection, independent of tenant-facing names.
// 10 easy-to-type characters, ~40 random bits, with a UNIQUE database constraint.
const newOcppIdentity=()=>{
  const alphabet='0123456789abcdefghjkmnpqrstvwxyz'; // 8 human-readable Crockford base32 chars
  const bytes=randomBytes(5);let bits=0n;
  for(const b of bytes)bits=(bits<<8n)|BigInt(b);
  let code='';
  for(let i=7;i>=0;i--)code+=alphabet[Number((bits>>BigInt(i*5))&31n)];
  return 'cv'+code;
};
// 16 characters from a 32-symbol, non-ambiguous alphabet = 80 bits of entropy.
 // Excludes 0/O and 1/I/L to simplify manual commissioning.
const newOcppSecret=()=>{
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes=randomBytes(10);
  let bits=0n;
  for(const b of bytes)bits=(bits<<8n)|BigInt(b);
  let password='';
  for(let i=15;i>=0;i--)password+=alphabet[Number((bits>>BigInt(i*5))&31n)];
  return password;
};
const wssBase=env=>{
  const value=String(env.CV_OCPP_WSS_BASE_URL||'').trim().replace(/\/+$/,'');
  if(!value)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='wss:'||!url.hostname||url.username||url.password||url.search||url.hash)return null;
    return url.href.replace(/\/+$/,'');
  }catch{return null;}
};
const endpoint=(env,identity)=>{
  const base=wssBase(env);
  return base?base+'/'+encodeURIComponent(identity):null;
};

const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
const validIdentity=v=>/^[-a-zA-Z0-9_.:]{2,120}$/.test(v);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function readBody(req){
  const chunks=[];let size=0;
  for await(const c of req){
    size+=c.length;if(size>30000)fail(413,'Anfrage zu groß');chunks.push(c);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
  catch{fail(400,'Ungültige Anfrage');}
}
async function transaction(pool,fn){
  const c=await pool.connect();
  try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
const ddl=[
  `CREATE TABLE IF NOT EXISTS cv_sites (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
    name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
    address text NOT NULL DEFAULT '',
    street text NOT NULL DEFAULT '',
    house_number text NOT NULL DEFAULT '',
    postal_code text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT 'Deutschland',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id,tenant_id)
  )`,
  `CREATE INDEX IF NOT EXISTS cv_sites_tenant_idx ON cv_sites(tenant_id)`,
  `ALTER TABLE cv_sites ADD COLUMN IF NOT EXISTS street text NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_sites ADD COLUMN IF NOT EXISTS house_number text NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_sites ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_sites ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_sites ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'Deutschland'`,
  `CREATE TABLE IF NOT EXISTS cv_stations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
    site_id uuid NOT NULL,
    name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
    topology text NOT NULL CHECK(topology IN ('shared','individual')),
    serial text NOT NULL DEFAULT '',
    ocpp_identity text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id,tenant_id),
    FOREIGN KEY(site_id,tenant_id) REFERENCES cv_sites(id,tenant_id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS cv_stations_site_idx ON cv_stations(site_id,tenant_id)`,
  `ALTER TABLE cv_stations ADD COLUMN IF NOT EXISTS is_simulator boolean NOT NULL DEFAULT false`,
  `ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS station_id uuid`,
  `ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS connector_number integer NOT NULL DEFAULT 1`,
  `ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS serial text NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS power_kw numeric(6,2)`,
  `ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS freecharge_enabled boolean NOT NULL DEFAULT false`,
  `DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cv_chargepoints_station_fk')
    THEN ALTER TABLE cv_chargepoints ADD CONSTRAINT cv_chargepoints_station_fk
      FOREIGN KEY(station_id,tenant_id) REFERENCES cv_stations(id,tenant_id) ON DELETE RESTRICT;
    END IF;
  END $$`,
  // OCPP 1.6J: one charge box identity can contain multiple numbered connectors.
  `ALTER TABLE cv_chargepoints DROP CONSTRAINT IF EXISTS cv_chargepoints_ocpp_identity_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cv_point_ocpp_connector_uniq ON cv_chargepoints(ocpp_identity,connector_number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cv_invitation_tenant_uq ON cv_invitations(token_hash,tenant_id)`,
  `CREATE TABLE IF NOT EXISTS cv_invitation_point_access (
    token_hash char(64) NOT NULL,
    tenant_id uuid NOT NULL,
    chargepoint_id uuid NOT NULL,
    PRIMARY KEY(token_hash,chargepoint_id),
    FOREIGN KEY(token_hash,tenant_id) REFERENCES cv_invitations(token_hash,tenant_id) ON DELETE CASCADE,
    FOREIGN KEY(chargepoint_id,tenant_id) REFERENCES cv_chargepoints(id,tenant_id) ON DELETE CASCADE
  )`,
    `CREATE INDEX IF NOT EXISTS cv_point_station_idx ON cv_chargepoints(station_id,tenant_id)`,
  // Each OCPP WebSocket connection gets one unique identity and only a hashed secret.
  `CREATE TABLE IF NOT EXISTS cv_ocpp_credentials (
    identity text PRIMARY KEY,
    tenant_id uuid NOT NULL,
    station_id uuid NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    rotated_at timestamptz,
    last_connected_at timestamptz,
    FOREIGN KEY(station_id,tenant_id) REFERENCES cv_stations(id,tenant_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS cv_ocpp_credentials_station_idx ON cv_ocpp_credentials(station_id,tenant_id)`
];
export async function ensureStructureSchema(pool){
  if(!pool)return;
  await transaction(pool,async c=>{for(const stmt of ddl)await c.query(stmt);});
}
export function createStructureApi(env,{pool,getActor}){
  const origin=()=>String(env.CV_PUBLIC_URL||'').replace(/[/]$/,'');
  const scope=(a,wanted)=>{
    if(a.role==='superadmin'){
      if(typeof wanted!=='string'||! /^[a-f0-9-]{36}$/i.test(wanted))fail(400,'Bitte einen Kunden auswählen');
      return wanted;
    }
    if(!a.tenant_id)fail(403,'Kein Kundenkonto');
    return a.tenant_id;
  };
  async function handle(req,res,path){
    if(!path.startsWith('/api/structure/'))return false;
    if(!pool){json(res,503,{error:'Datenbank nicht verfügbar'});return true;}
    try{
      const actor=await getActor(req);
      if(!actor||!['superadmin','admin'].includes(actor.role))fail(actor?403:401,'Keine Berechtigung');
      if(!['GET','POST','PATCH'].includes(req.method))fail(405,'Methode nicht erlaubt');
      if(req.method!=='GET'){
        if(req.headers.origin!==origin())fail(403,'Ungültige Anfragequelle');
        if((req.headers['content-type']||'').split(';')[0]!=='application/json')fail(415,'JSON erwartet');
      }
      const query=new URL(req.url,'http://localhost').searchParams;
      if(path==='/api/structure/overview'&&req.method==='GET'){
        const tid=scope(actor,query.get('tenantId'));
        const [tenant,sites,stations,points,access]=await Promise.all([
          pool.query('SELECT id,name,status,licensed_points FROM cv_tenants WHERE id=$1',[tid]),
          pool.query('SELECT id,name,address,street,house_number,postal_code,city,country,created_at FROM cv_sites WHERE tenant_id=$1 ORDER BY created_at,name',[tid]),
          pool.query('SELECT id,site_id,name,topology,serial,ocpp_identity,is_simulator,created_at FROM cv_stations WHERE tenant_id=$1 ORDER BY created_at,name',[tid]),
          pool.query('SELECT id,station_id,name,ocpp_identity,connector_number,serial,power_kw,enabled,freecharge_enabled FROM cv_chargepoints WHERE tenant_id=$1 ORDER BY created_at,name',[tid]),
          pool.query('SELECT x.chargepoint_id,x.user_id,u.name FROM cv_point_access x JOIN cv_users u ON u.id=x.user_id WHERE x.tenant_id=$1 ORDER BY u.name',[tid])
        ]);
        if(!tenant.rowCount)fail(404,'Kunde nicht gefunden');
        json(res,200,{tenant:tenant.rows[0],sites:sites.rows,stations:stations.rows,points:points.rows,access:access.rows});
        return true;
      }
      if(path==='/api/structure/sites'&&req.method==='POST'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf Standorte konfigurieren');
        const p=await readBody(req),tid=scope(actor,p.tenantId);
        const name=clean(p.name),street=clean(p.street,160),house=clean(p.houseNumber,30),
          postal=clean(p.postalCode,20),city=clean(p.city,120),country=clean(p.country||'Deutschland',90);
        const structured=!!(street||house||postal||city);
        const address=structured?[street+' '+house,postal+' '+city,country].map(x=>x.trim()).filter(Boolean).join(', '):
          clean(p.address,300);
        if(name.length<2||structured&&(!street||!house||!postal||!city||!country))
          fail(400,'Bitte Standortname und vollständige Adresse angeben');
        const id=randomUUID();
        await transaction(pool,async client=>{
          const t=await client.query('SELECT status FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL',[tid]);
          if(!t.rowCount||t.rows[0].status!=='active')fail(403,'Kunde nicht freigeschaltet');
          await client.query(
            'INSERT INTO cv_sites(id,tenant_id,name,address,street,house_number,postal_code,city,country) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [id,tid,name,address,street,house,postal,city,country]);
          await client.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
            [actor.id,tid,'site_created',id]);
        });
        json(res,201,{id,name,address,street,house_number:house,postal_code:postal,city,country});return true;
      }
      const siteMatch=path.match(/^[/]api[/]structure[/]sites[/]([a-f0-9-]{36})$/i);
      if(siteMatch&&req.method==='PATCH'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf Standorte bearbeiten');
        const p=await readBody(req),tid=scope(actor,p.tenantId),id=siteMatch[1];
        const name=clean(p.name),street=clean(p.street,160),house=clean(p.houseNumber,30),
          postal=clean(p.postalCode,20),city=clean(p.city,120),country=clean(p.country||'Deutschland',90);
        if(name.length<2||!street||!house||!postal||!city||!country)
          fail(400,'Bitte Standortname und vollständige Adresse angeben');
        const address=[street+' '+house,postal+' '+city,country].map(x=>x.trim()).join(', ');
        const saved=await transaction(pool,async client=>{
          const result=await client.query(
            'UPDATE cv_sites SET name=$3,address=$4,street=$5,house_number=$6,postal_code=$7,city=$8,country=$9 '+
            'WHERE id=$1 AND tenant_id=$2 RETURNING id,name,address,street,house_number,postal_code,city,country',
            [id,tid,name,address,street,house,postal,city,country]);
          if(!result.rowCount)fail(404,'Standort nicht gefunden');
          await client.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
            [actor.id,tid,'site_updated',id]);
          return result.rows[0];
        });
        json(res,200,{site:saved});return true;
      }
      if(path==='/api/structure/stations'&&req.method==='POST'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf Standorte, Stationen und Ladepunkte konfigurieren');
        const p=await readBody(req),tid=scope(actor,p.tenantId);
        const name=clean(p.name),siteId=clean(p.siteId,50),topology=clean(p.topology,20);
        const serial=clean(p.serial,120);
        const isSimulator=p.isSimulator===true;
        // Wallbox identities can be supplied for fixed-ID hardware, otherwise ChargeVisor generates them.
        const sharedId=clean(p.ocppIdentity,120)||newOcppIdentity();
        const specs=p.pointSpecs;
        if(name.length<2||!['shared','individual'].includes(topology))fail(400,'Name oder Anschlussart ungültig');
        if(!/^[a-f0-9-]{36}$/i.test(siteId))fail(400,'Standort fehlt');
        if(!Array.isArray(specs)||specs.length<1||specs.length>32)fail(400,'Bitte 1 bis 32 Ladepunkte anlegen');
        if(topology==='shared'&&!validIdentity(sharedId))fail(400,'Gültige gemeinsame OCPP-ID erforderlich');
        const normalized=specs.map((raw,i)=>{
          const pointName=clean(raw?.name);
          const identity=topology==='shared'?sharedId:(clean(raw?.ocppIdentity,120)||newOcppIdentity());
          const connector=topology==='shared'?i+1:1;
          if(!pointName||!validIdentity(identity))fail(400,'Ladepunktname oder OCPP-ID fehlt');
          return {name:pointName,ocpp:identity,connector};
        });
        const identityPairs=normalized.map(x=>x.ocpp+':'+x.connector);
        if(new Set(identityPairs).size!==identityPairs.length)fail(409,'Mehrfach vorhandene OCPP-ID / Connector');
        const stationId=randomUUID();
        const rows=await transaction(pool,async c=>{
          const tenant=await c.query('SELECT status FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[tid]);
          if(!tenant.rowCount||tenant.rows[0].status!=='active')fail(403,'Kunde nicht freigeschaltet');
          const site=await c.query('SELECT id FROM cv_sites WHERE id=$1 AND tenant_id=$2',[siteId,tid]);
          if(!site.rowCount)fail(404,'Standort gehört nicht zum Kunden');
          // Walectra alone provisions charge points. No separate licensed-points quota.
          await c.query(
            'INSERT INTO cv_stations(id,tenant_id,site_id,name,topology,serial,ocpp_identity,is_simulator) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [stationId,tid,siteId,name,topology,serial,topology==='shared'?sharedId:null,isSimulator]);
          const added=[];
          for(const pnt of normalized){
            const id=randomUUID();
            await c.query(
              'INSERT INTO cv_chargepoints(id,tenant_id,station_id,name,ocpp_identity,connector_number,enabled) VALUES($1,$2,$3,$4,$5,$6,true)',
              [id,tid,stationId,pnt.name,pnt.ocpp,pnt.connector]);
            added.push({id,name:pnt.name,ocppIdentity:pnt.ocpp,connectorNumber:pnt.connector});
          }
          // Provision one credential per distinct charge box (not per connector).
          const credentials=[];
          for(const identity of [...new Set(normalized.map(x=>x.ocpp))]){
            const password=newOcppSecret();
            await c.query(
              'INSERT INTO cv_ocpp_credentials(identity,tenant_id,station_id,password_hash) VALUES($1,$2,$3,$4)',
              [identity,tid,stationId,await hashPassword(password)]);
            credentials.push({identity,password,username:identity,wssUrl:endpoint(env,identity)});
          }
          await c.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',[actor.id,tid,'station_created',stationId]);
          return {points:added,credentials};
        });
        // Passwords appear in this HTTPS response once; the database only stores scrypt hashes.
        json(res,201,{id:stationId,name,isSimulator,points:rows.points,credentials:rows.credentials,
          wssConfigured:!!wssBase(env),connectionReady:false});return true;
      }
      const extension=path.match(/^[/]api[/]structure[/]stations[/]([a-f0-9-]{36})[/]points$/i);
      if(extension&&req.method==='POST'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf Ladepunkte erweitern');
        const body=await readBody(req),tid=scope(actor,body.tenantId),stationId=extension[1];
        const names=Array.isArray(body.names)?body.names.map(name=>typeof name==='string'?clean(name):''):[];
        if(!names.length||names.length>32||names.some(name=>!name))fail(400,'Bitte 1 bis 32 Ladepunktnamen angeben');
        const result=await transaction(pool,async c=>{
          const {rows:[station]}=await c.query(
            "SELECT s.* FROM cv_stations s JOIN cv_tenants t ON t.id=s.tenant_id "+
            "WHERE s.id=$1 AND t.id=$2 AND t.deleted_at IS NULL AND t.status='active' FOR UPDATE OF s,t",
            [stationId,tid]);
          if(!station||station.is_simulator)fail(404,'Aktive Ladestation nicht gefunden');
          const {rows:[existing]}=await c.query(
            'SELECT count(*)::int AS count,COALESCE(max(connector_number),0) AS last FROM cv_chargepoints WHERE station_id=$1 AND tenant_id=$2',
            [stationId,tid]);
          const shared=station.topology==='shared';
          if(existing.count+names.length>32||(shared&&existing.last+names.length>32))
            fail(409,'Maximal 32 Ladepunkte je Ladestation');
          if(shared&&!validIdentity(station.ocpp_identity||''))fail(409,'Gemeinsame OCPP-ID fehlt');
          const points=[],credentials=[];
          for(const [index,name] of names.entries()){
            const id=randomUUID(),identity=shared?station.ocpp_identity:newOcppIdentity();
            const connector=shared?existing.last+index+1:1;
            await c.query('INSERT INTO cv_chargepoints(id,tenant_id,station_id,name,ocpp_identity,connector_number,enabled) VALUES($1,$2,$3,$4,$5,$6,true)',
              [id,tid,stationId,name,identity,connector]);
            if(!shared){
              const password=newOcppSecret();
              await c.query('INSERT INTO cv_ocpp_credentials(identity,tenant_id,station_id,password_hash) VALUES($1,$2,$3,$4)',
                [identity,tid,stationId,await hashPassword(password)]);
              credentials.push({identity,password,username:identity,wssUrl:endpoint(env,identity)});
            }
            points.push({id,name,connectorNumber:connector,ocppIdentity:identity});
          }
          await c.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
            [actor.id,tid,'station_extended',stationId]);
          return {points,credentials,wssConfigured:!!wssBase(env)};
        });
        json(res,201,result);return true;
      }
      // Migrates a previously created station from manual identities to secure credentials.
      const credentialsProvision=path.match(/^[/]api[/]structure[/]stations[/]([a-f0-9-]{36})[/]credentials[/]provision$/i);
      if(credentialsProvision&&req.method==='POST'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf OCPP-Zugangsdaten erzeugen');
        const p=await readBody(req),tid=scope(actor,p.tenantId),stationId=credentialsProvision[1];
        const added=await transaction(pool,async c=>{
          const station=await c.query('SELECT id FROM cv_stations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[stationId,tid]);
          if(!station.rowCount)fail(404,'Ladestation nicht gefunden');
          const ids=await c.query(
            'SELECT DISTINCT ocpp_identity FROM cv_chargepoints WHERE station_id=$1 AND tenant_id=$2 ORDER BY ocpp_identity',
            [stationId,tid]);
          if(!ids.rowCount)fail(400,'Diese Anlage hat noch keine Ladepunkte');
          const current=await c.query(
            'SELECT identity FROM cv_ocpp_credentials WHERE station_id=$1 AND tenant_id=$2',
            [stationId,tid]);
          const found=new Set(current.rows.map(x=>x.identity));
          const result=[];
          for(const x of ids.rows){
            if(found.has(x.ocpp_identity))continue;
            const password=newOcppSecret();
            await c.query(
              'INSERT INTO cv_ocpp_credentials(identity,tenant_id,station_id,password_hash) VALUES($1,$2,$3,$4)',
              [x.ocpp_identity,tid,stationId,await hashPassword(password)]);
            result.push({identity:x.ocpp_identity,username:x.ocpp_identity,
              password,wssUrl:endpoint(env,x.ocpp_identity)});
          }
          if(result.length)await c.query(
            'INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
            [actor.id,tid,'ocpp_credentials_provisioned',stationId]);
          return result;
        });
        json(res,200,{credentials:added,wssConfigured:!!wssBase(env),connectionReady:false});
        return true;
      }
      // Read-only credentials metadata: secrets must never be retrieved in plaintext.
      const credentialList=path.match(/^[/]api[/]structure[/]stations[/]([a-f0-9-]{36})[/]credentials$/i);
      if(credentialList&&req.method==='GET'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf OCPP-Zugangsdaten sehen');
        const tid=scope(actor,query.get('tenantId')),stationId=credentialList[1];
        const station=await pool.query('SELECT id,topology FROM cv_stations WHERE id=$1 AND tenant_id=$2',[stationId,tid]);
        if(!station.rowCount)fail(404,'Ladestation nicht gefunden');
        const credentials=await pool.query(
          'SELECT identity,created_at,rotated_at,last_connected_at FROM cv_ocpp_credentials WHERE station_id=$1 AND tenant_id=$2 ORDER BY identity',
          [stationId,tid]);
        json(res,200,{credentials:credentials.rows.map(x=>({
          identity:x.identity,created_at:x.created_at,rotated_at:x.rotated_at,
          last_connected_at:x.last_connected_at,username:x.identity,
          wssUrl:endpoint(env,x.identity),passwordStored:true
        })),wssConfigured:!!wssBase(env),connectionReady:false});
        return true;
      }
      const credentialRotate=path.match(/^[/]api[/]structure[/]stations[/]([a-f0-9-]{36})[/]credentials[/]([-a-zA-Z0-9_.:]+)[/]rotate$/i);
      if(credentialRotate&&req.method==='POST'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf OCPP-Passwörter zurücksetzen');
        const body=await readBody(req),tid=scope(actor,body.tenantId);
        const stationId=credentialRotate[1],identity=credentialRotate[2];
        const password=newOcppSecret();
        const found=await transaction(pool,async c=>{
          const r=await c.query(
            'UPDATE cv_ocpp_credentials SET password_hash=$1,rotated_at=now() WHERE identity=$2 AND station_id=$3 AND tenant_id=$4 RETURNING identity',
            [await hashPassword(password),identity,stationId,tid]);
          if(!r.rowCount)fail(404,'OCPP-Zugangsdaten nicht gefunden');
          await c.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
            [actor.id,tid,'ocpp_password_rotated',stationId]);
          return r.rows[0];
        });
        json(res,200,{identity:found.identity,username:found.identity,password,
          wssUrl:endpoint(env,identity),wssConfigured:!!wssBase(env),connectionReady:false});
        return true;
      }
      const match=path.match(/^[/]api[/]structure[/]points[/]([a-f0-9-]{36})$/i);
      if(match&&req.method==='PATCH'){
        if(actor.role!=='superadmin')fail(403,'Nur Walectra darf Standorte, Stationen und Ladepunkte konfigurieren');
        const p=await readBody(req),tid=scope(actor,p.tenantId),id=match[1];
        if(p.enabled!==undefined&&typeof p.enabled!=='boolean')fail(400,'Status ungültig');
        if(p.name!==undefined&&clean(p.name).length<1)fail(400,'Ladepunktname fehlt');
        const changesPoint=p.enabled!==undefined||p.name!==undefined;
        const changesFreecharge=p.freechargeEnabled!==undefined;
        if(changesFreecharge&&typeof p.freechargeEnabled!=='boolean')fail(400,'Freecharge-Status ungültig');
        if(!changesPoint&&!changesFreecharge)fail(400,'Keine Änderung');
        const result=await transaction(pool,async c=>{
          const tenant=await c.query('SELECT status FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[tid]);
          if(!tenant.rowCount)fail(404,'Kunde nicht gefunden');
          const {rows:[point]}=await c.query(`
            SELECT p.id,p.name,p.enabled,p.freecharge_enabled,s.is_simulator=false AS physical
            FROM cv_chargepoints p
            LEFT JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id
            WHERE p.id=$1 AND p.tenant_id=$2 FOR UPDATE OF p`,[id,tid]);
          if(!point)fail(404,'Ladepunkt nicht gefunden');
          if((changesFreecharge||p.enabled===true&&!point.enabled)&&tenant.rows[0].status!=='active')
            fail(403,'Kunde ist nicht aktiv');
          if(changesFreecharge&&!point.physical)fail(400,'Freecharge ist nur für physische Ladepunkte verfügbar');
          const name=p.name===undefined?point.name:clean(p.name);
          const enabled=p.enabled??point.enabled;
          const freechargeEnabled=p.freechargeEnabled??point.freecharge_enabled;
          await c.query(`
            UPDATE cv_chargepoints SET name=$1,enabled=$2,freecharge_enabled=$3 WHERE id=$4 AND tenant_id=$5`,
            [name,enabled,freechargeEnabled,id,tid]);
          const audit='INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)';
          if(changesPoint)await c.query(audit,[actor.id,tid,'point_updated',id]);
          if(freechargeEnabled!==point.freecharge_enabled)
            await c.query(audit,[actor.id,tid,freechargeEnabled?'freecharge_enabled':'freecharge_disabled',id]);
          return {id,name,enabled,freechargeEnabled};
        });
        json(res,200,{point:result});return true;
      }
      fail(404,'Endpunkt nicht vorhanden');
    }catch(err){
      if(err?.code==='23505')json(res,409,{error:'OCPP-ID / Connector bereits vergeben'});
      else if(err?.code==='23503')json(res,400,{error:'Standort, Ladestation oder Kunde nicht gefunden'});
      else if(err?.status)json(res,err.status,{error:err.message});
      else{console.error('ChargeVisor structure error:',err.code||err.message);json(res,500,{error:'Interner Fehler'});}
      return true;
    }
  }
  return {handle};
}
