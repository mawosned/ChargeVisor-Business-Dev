import {createHmac,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {updateUserPointAccess} from './auth.mjs';
import {FREECHARGE_TAG,freechargeGrant} from './freecharge.mjs';
import {validUuid} from './test-rfid.mjs';

const isCardTag=tag=>typeof tag==='string'&&/^[\x21-\x7e]{1,20}$/.test(tag)&&
  !/^(?:SIM-|CV-SIM-TEST$|CV-FREECHARGE$)/i.test(tag);
const maxRecentReads=50;
const recentCutoff="now()-interval '24 hours'";
const unknownRead='NOT EXISTS (SELECT 1 FROM cv_rfid_cards r WHERE r.tag_hash=q.tag_hash)';
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value))return null;
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toISOString():null;
};
const meter=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647;
const stopReasons=new Set(['DeAuthorized','EmergencyStop','EVDisconnected','HardReset','Local',
  'Other','PowerLoss','Reboot','Remote','SoftReset','UnlockCommand']);
const hasSignedEnergy=readings=>Array.isArray(readings)&&readings.some(row=>
  Array.isArray(row?.sampledValue)&&row.sampledValue.some(sample=>
    sample?.format==='SignedData'&&!sample.phase&&
    (!sample.measurand||sample.measurand==='Energy.Active.Import.Register')&&
    typeof sample.value==='string'&&sample.value.trim()!==''));

export async function ensurePhysicalOcppSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_rfid_cards (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL,
      tag_hash text NOT NULL UNIQUE,
      label text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (user_id,tenant_id) REFERENCES cv_users(id,tenant_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS cv_rfid_recent_reads (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      station_id uuid NOT NULL,
      identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
      connector_id integer,
      tag_hash text NOT NULL,
      last_seen timestamptz NOT NULL,
      UNIQUE (tenant_id,tag_hash),
      FOREIGN KEY (station_id,tenant_id) REFERENCES cv_stations(id,tenant_id) ON DELETE CASCADE
    );
    ALTER TABLE cv_rfid_cards ADD COLUMN IF NOT EXISTS tag_cipher text;
    ALTER TABLE cv_rfid_recent_reads ADD COLUMN IF NOT EXISTS tag_cipher text;
    CREATE INDEX IF NOT EXISTS cv_rfid_recent_order_idx
      ON cv_rfid_recent_reads (tenant_id,last_seen DESC,id DESC);
    CREATE INDEX IF NOT EXISTS cv_rfid_recent_expiry_idx ON cv_rfid_recent_reads (last_seen);
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS chargepoint_id uuid;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS user_id uuid;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS card_id uuid;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS meter_last_wh numeric;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS authorization_kind text;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS remote_actor_role text;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS price_per_kwh numeric(7,4);
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS stop_reason text;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS signed_meter boolean;
    ALTER TABLE cv_ocpp_transactions ADD COLUMN IF NOT EXISTS remote_paused boolean NOT NULL DEFAULT false;
    ALTER TABLE cv_ocpp_connector_live ADD COLUMN IF NOT EXISTS power_updated_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS cv_ocpp_real_active_connector_idx
      ON cv_ocpp_transactions (identity,connector_id) WHERE NOT simulated AND stopped_at IS NULL;
    CREATE INDEX IF NOT EXISTS cv_ocpp_real_history_idx
      ON cv_ocpp_transactions (tenant_id,started_at DESC,id DESC) WHERE NOT simulated;
  `);
}

async function transaction(pool,work){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

const tagAssignment=`
  SELECT r.id AS card_id,u.id AS user_id,p.id AS point_id
  FROM cv_rfid_cards r
  JOIN cv_users u ON u.id=r.user_id AND u.tenant_id=r.tenant_id
  JOIN cv_point_access a ON a.user_id=u.id AND a.tenant_id=u.tenant_id
  JOIN cv_chargepoints p ON p.id=a.chargepoint_id AND p.tenant_id=a.tenant_id
  JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id
  JOIN cv_tenants t ON t.id=s.tenant_id
  WHERE r.tag_hash=$1 AND r.tenant_id=$2 AND p.station_id=$3 AND p.ocpp_identity=$4
    AND ($5::integer IS NULL OR p.connector_number=$5)
    AND r.enabled AND u.enabled AND u.role='user' AND p.enabled AND NOT s.is_simulator
    AND t.status='active' AND t.deleted_at IS NULL`;

const recentStation=`
  JOIN cv_stations s ON s.id=q.station_id AND s.tenant_id=q.tenant_id AND NOT s.is_simulator
  JOIN cv_ocpp_credentials c ON c.identity=q.identity AND c.station_id=s.id AND c.tenant_id=s.tenant_id`;

async function rememberRead(client,ctx,digest,connectorId,cipher){
  if(ctx.simulated)return false;
  // Multiple chargers can report at once. Bound a tenant's queue across connections.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['cv-rfid-recent:'+ctx.tenantId]);
  const remembered=await client.query(`
    INSERT INTO cv_rfid_recent_reads AS q(id,tenant_id,station_id,identity,connector_id,tag_hash,last_seen,tag_cipher)
    SELECT $1,c.tenant_id,c.station_id,c.identity,$5,$6,now(),$7
    FROM cv_ocpp_credentials c
    JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id
    JOIN cv_tenants t ON t.id=c.tenant_id
    WHERE c.tenant_id=$2 AND c.station_id=$3 AND c.identity=$4 AND NOT s.is_simulator
      AND t.status='active' AND t.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM cv_rfid_cards WHERE tag_hash=$6)
    ON CONFLICT (tenant_id,tag_hash) DO UPDATE SET
      id=CASE WHEN q.last_seen<${recentCutoff} THEN EXCLUDED.id ELSE q.id END,
      connector_id=CASE WHEN EXCLUDED.connector_id IS NOT NULL THEN EXCLUDED.connector_id
        WHEN q.last_seen>=${recentCutoff} AND q.identity=EXCLUDED.identity AND q.station_id=EXCLUDED.station_id THEN q.connector_id END,
      station_id=EXCLUDED.station_id,identity=EXCLUDED.identity,last_seen=EXCLUDED.last_seen,tag_cipher=EXCLUDED.tag_cipher
    RETURNING id`,[randomUUID(),ctx.tenantId,ctx.stationId,ctx.identity,connectorId,digest,cipher]);
  if(!remembered.rowCount)return false;
  await client.query(`
    DELETE FROM cv_rfid_recent_reads WHERE id IN (
      SELECT id FROM cv_rfid_recent_reads WHERE last_seen<${recentCutoff}
      ORDER BY last_seen LIMIT 500 FOR UPDATE SKIP LOCKED
    )`);
  await client.query(`
    DELETE FROM cv_rfid_recent_reads WHERE id IN (
      SELECT id FROM cv_rfid_recent_reads WHERE tenant_id=$1
      ORDER BY last_seen DESC,id DESC OFFSET $2
    )`,[ctx.tenantId,maxRecentReads]);
  return true;
}

export function createPhysicalOcpp(pool,env){
  const key=Buffer.from(env.CV_RFID_HMAC_KEY||'','base64');
  const configured=key.length===32;
  const windows=new Map();
  const tagHash=tag=>createHmac('sha256',key).update(tag).digest('hex');
  // Preserve HMAC authorization; a separate derived key protects the display-only idTag.
  const displayKey=createHmac('sha256',key).update('chargevisor-rfid-display-v1').digest();
  const seal=(tag,tenantId,digest)=>{
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',displayKey,iv);
    cipher.setAAD(Buffer.from(tenantId+':'+digest));
    const data=Buffer.concat([cipher.update(tag,'utf8'),cipher.final()]);
    return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');
  };
  const reveal=(encoded,tenantId,digest)=>{
    if(!configured||!encoded)return null;
    try{
      const [iv,authTag,data]=encoded.split('.').map(x=>Buffer.from(x,'base64url'));
      const decipher=createDecipheriv('aes-256-gcm',displayKey,iv);
      decipher.setAAD(Buffer.from(tenantId+':'+digest));
      decipher.setAuthTag(authTag);
      const tag=Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
      return isCardTag(tag)&&tagHash(tag)===digest?tag:null;
    }catch{return null;}
  };
  async function rememberKnown(client,tenantId,digest,tag){
    await client.query('UPDATE cv_rfid_cards SET tag_cipher=$3 WHERE tenant_id=$1 AND tag_hash=$2 AND tag_cipher IS NULL',
      [tenantId,digest,seal(tag,tenantId,digest)]);
  }
  const displayRow=(row,tenantId)=>{
    const {tag_hash,tag_cipher,...rest}=row;
    return {...rest,id_tag:reveal(tag_cipher,tenantId,tag_hash)};
  };
  const scope=ctx=>[ctx.tenantId,ctx.stationId,ctx.identity];

  const remoteGrant=(ctx,tag)=>typeof tag==='string'&&/^CVR-[a-f0-9]{16}$/.test(tag)&&
    ctx.remoteStart?.tag===tag&&ctx.remoteStart.expires>Date.now()?ctx.remoteStart:null;
  async function authorize(ctx,tag){
    if(typeof tag==='string'&&/^CVR-[a-f0-9]{16}$/.test(tag))return !!remoteGrant(ctx,tag);
    if(tag===FREECHARGE_TAG)return !!await freechargeGrant(pool,ctx);
    if(!configured||!isCardTag(tag))return false;
    const digest=tagHash(tag);
    const result=await pool.query(tagAssignment+' LIMIT 1',[digest,...scope(ctx),null]);
    if(result.rowCount){await rememberKnown(pool,ctx.tenantId,digest,tag);return true;}
    if(!await transaction(pool,client=>rememberRead(client,ctx,digest,null,seal(tag,ctx.tenantId,digest))))return false;
    const open=windows.get(ctx.identity);
    if(open&&open.tenantId===ctx.tenantId&&open.stationId===ctx.stationId&&!open.candidate&&open.until>Date.now())
      open.candidate=tag;
    return false;
  }

  async function start(ctx,payload){
    const {connectorId,meterStart,idTag}=payload;
    const at=timestamp(payload.timestamp);
    if(!Number.isInteger(connectorId)||connectorId<1||connectorId>128||!meter(meterStart)||!at)
      return {error:'Ungültige Transaktionswerte'};
    const remote=remoteGrant(ctx,idTag),remoteTag=typeof idTag==='string'&&/^CVR-[a-f0-9]{16}$/.test(idTag);
    if(remoteTag&&(remote?.connector!==connectorId||
      (remote?.startedAt&&(remote.startedAt!==at||remote.meterStart!==meterStart))))return {transactionId:0};
    const freecharge=idTag===FREECHARGE_TAG;
    if(!remote&&!freecharge&&(!configured||!isCardTag(idTag)))return {transactionId:0};
    const digest=remote||freecharge?null:tagHash(idTag);
    const authorization=remote?'remote':freecharge?'freecharge':'rfid';
    const result=await transaction(pool,async client=>{
      // Serialize starts for this connector even across replacement sockets.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['cv-ocpp-start:'+ctx.identity+':'+connectorId]);
      const grant=remote?(await client.query(`
        SELECT p.id AS point_id,$3::uuid AS user_id,NULL::uuid AS card_id,u.role AS remote_actor_role
        FROM cv_chargepoints p JOIN cv_tenants t ON t.id=p.tenant_id
        JOIN cv_users u ON u.id=$4 AND u.enabled AND u.portal_enabled
        WHERE p.id=$1 AND p.tenant_id=$2 AND p.enabled AND t.status='active' AND t.deleted_at IS NULL
          AND (u.role='superadmin' OR (u.tenant_id=t.id AND u.can_control_charging
            AND (u.role='admin' OR EXISTS(SELECT 1 FROM cv_point_access a WHERE a.tenant_id=$2 AND a.user_id=u.id AND a.chargepoint_id=p.id))))
        FOR SHARE OF p,t,u`,[remote.pointId,ctx.tenantId,remote.userId,remote.actorId])).rows[0]:freecharge?await freechargeGrant(client,ctx,connectorId,{lock:true}):
        (await client.query(tagAssignment+' LIMIT 1 FOR SHARE OF r,u,a,p,s,t',
          [digest,...scope(ctx),connectorId])).rows[0];
      if(!grant){
        if(!freecharge&&!remote)await rememberRead(client,ctx,digest,connectorId,seal(idTag,ctx.tenantId,digest));
        return {transactionId:0};
      }
      if(!freecharge&&!remote)await rememberKnown(client,ctx.tenantId,digest,idTag);
      const {rows:[previous]}=await client.query(`
        SELECT id FROM cv_ocpp_transactions
        WHERE identity=$1 AND tenant_id=$2 AND connector_id=$3 AND NOT simulated
          AND card_id IS NOT DISTINCT FROM $4 AND started_at=$5 AND meter_start_wh=$6
          AND COALESCE(authorization_kind,'rfid')=$7
        ORDER BY id DESC LIMIT 1`,[ctx.identity,ctx.tenantId,connectorId,grant.card_id,at,meterStart,authorization]);
      if(previous)return {transactionId:Number(previous.id),replayed:true};
      const active=await client.query(
        'SELECT id FROM cv_ocpp_transactions WHERE identity=$1 AND connector_id=$2 AND NOT simulated AND stopped_at IS NULL',
        [ctx.identity,connectorId]);
      if(active.rowCount)return {error:'Transaktion bereits aktiv'};
      const {rows:[created]}=await client.query(`
        INSERT INTO cv_ocpp_transactions(identity,tenant_id,connector_id,meter_start_wh,started_at,
          simulated,chargepoint_id,user_id,card_id,authorization_kind,price_per_kwh,signed_meter,remote_actor_role)
        VALUES($1,$2,$3,$4,$5,false,$6,$7,$8,$9,(SELECT price_per_kwh FROM cv_tenants WHERE id=$2),false,$10) RETURNING id`,
      [ctx.identity,ctx.tenantId,connectorId,meterStart,at,grant.point_id,grant.user_id,grant.card_id,authorization,remote?grant.remote_actor_role:null]);
      return {transactionId:Number(created.id)};
    });
    if(remote&&result.transactionId){remote.startedAt=at;remote.meterStart=meterStart;}
    return result;
  }

  async function sample(ctx,payload,energyWh){
    if(payload.transactionId===undefined)return true;
    if(!Number.isSafeInteger(payload.transactionId)||payload.transactionId<1)return false;
    const result=await pool.query(`
      UPDATE cv_ocpp_transactions SET meter_last_wh=GREATEST(meter_last_wh,$5),
        signed_meter=CASE WHEN $6 THEN true ELSE signed_meter END
      WHERE id=$1 AND identity=$2 AND tenant_id=$3 AND connector_id=$4 AND NOT simulated AND stopped_at IS NULL
      RETURNING id`,[payload.transactionId,ctx.identity,ctx.tenantId,payload.connectorId,energyWh,hasSignedEnergy(payload.meterValue)]);
    return result.rowCount>0;
  }

  async function stop(ctx,payload){
    const {transactionId,meterStop}=payload;
    const at=timestamp(payload.timestamp);
    if(!Number.isSafeInteger(transactionId)||transactionId<1||!meter(meterStop)||!at)
      return {error:'Ungültiges Transaktionsende'};
    const args=[transactionId,ctx.identity,ctx.tenantId,meterStop,at];
    const result=await pool.query(`
      UPDATE cv_ocpp_transactions SET meter_stop_wh=$4,stopped_at=$5,stop_reason=$6,
        signed_meter=CASE WHEN $7 THEN true ELSE signed_meter END
      WHERE id=$1 AND identity=$2 AND tenant_id=$3 AND NOT simulated AND stopped_at IS NULL AND started_at<=$5
      RETURNING id`,[...args,stopReasons.has(payload.reason)?payload.reason:null,hasSignedEnergy(payload.transactionData)]);
    if(result.rowCount)return {};
    const previous=await pool.query(`
      SELECT id FROM cv_ocpp_transactions
      WHERE id=$1 AND identity=$2 AND tenant_id=$3 AND NOT simulated AND meter_stop_wh=$4 AND stopped_at=$5`,args);
    return previous.rowCount?{replayed:true}:{error:'Unbekannte Transaktion oder ungültige Endzeit'};
  }

  async function readCards(tenantId,actor,identity){
    const cards=await pool.query(
      'SELECT id,user_id,label,enabled,created_at,tag_hash,tag_cipher FROM cv_rfid_cards WHERE tenant_id=$1 ORDER BY created_at DESC',[tenantId]);
    const recent=configured?await pool.query(`
      SELECT q.id,s.name AS station_name,q.connector_id,p.id AS point_id,p.name AS point_name,q.last_seen,q.tag_hash,q.tag_cipher
      FROM cv_rfid_recent_reads q ${recentStation}
      LEFT JOIN cv_chargepoints p ON p.tenant_id=q.tenant_id AND p.station_id=q.station_id
        AND p.ocpp_identity=q.identity AND p.connector_number=q.connector_id
      WHERE q.tenant_id=$1 AND q.last_seen>=${recentCutoff} AND ${unknownRead}
      ORDER BY q.last_seen DESC,q.id DESC LIMIT $2`,[tenantId,maxRecentReads]):{rows:[]};
    const open=windows.get(identity);
    const window=open&&open.actorId===actor.id&&open.tenantId===tenantId&&open.until>Date.now()
      ?{expiresAt:new Date(open.until).toISOString(),candidate:open.candidate}:null;
    return {cards:cards.rows.map(row=>displayRow(row,tenantId)),recent:recent.rows.map(row=>displayRow(row,tenantId)),window,configured};
  }

  async function assignSeen(tenantId,actor,input){
    const {readId,userId,label,pointIds=[],allPoints=false}=input;
    if(!validUuid(readId)||!validUuid(userId)||typeof label!=='string'||!label.trim()||label.length>80||
       typeof allPoints!=='boolean'||!Array.isArray(pointIds)||pointIds.length>50||
       !pointIds.every(validUuid)||new Set(pointIds).size!==pointIds.length||(allPoints&&pointIds.length))
      return {status:400,error:'Erkennung, Karte, Nutzer und Ladepunktauswahl prüfen'};
    const result=await transaction(pool,async client=>{
      const tenant=await client.query(
        "SELECT id FROM cv_tenants WHERE id=$1 AND status='active' AND deleted_at IS NULL FOR SHARE",[tenantId]);
      if(!tenant.rowCount)return {status:403,error:'Kunde nicht freigeschaltet'};
      const {rows:[read]}=await client.query(`
        SELECT q.tag_hash,q.tag_cipher FROM cv_rfid_recent_reads q ${recentStation}
        WHERE q.id=$1 AND q.tenant_id=$2 AND q.last_seen>=${recentCutoff} AND ${unknownRead}
        FOR UPDATE OF q`,[readId,tenantId]);
      if(!read)return {status:409,error:'Diese RFID-Erkennung ist nicht mehr verfügbar'};
      const user=await client.query(
        "SELECT id FROM cv_users WHERE id=$1 AND tenant_id=$2 AND enabled AND role='user' FOR UPDATE",[userId,tenantId]);
      if(!user.rowCount)return {status:404,error:'Aktiver Nutzer nicht gefunden'};
      const cardId=randomUUID();
      const added=await client.query(`
        INSERT INTO cv_rfid_cards(id,tenant_id,user_id,tag_hash,label,tag_cipher) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tag_hash) DO NOTHING RETURNING id`,[cardId,tenantId,userId,read.tag_hash,label.trim(),read.tag_cipher??null]);
      if(!added.rowCount)return {status:409,error:'Diese RFID-Erkennung ist nicht mehr verfügbar'};
      if(allPoints||pointIds.length)
        await updateUserPointAccess(client,{tenantId,userId,allPoints,pointIds});
      await client.query('DELETE FROM cv_rfid_recent_reads WHERE id=$1 AND tenant_id=$2',[readId,tenantId]);
      await client.query("INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,'rfid_seen_assigned',$3)",
        [actor.id,tenantId,cardId]);
      return null;
    }).catch(error=>{
      if(error.status===400||error.status===403)return {status:error.status,error:error.message};
      throw error;
    });
    return result;
  }

  async function handleRfid({actor,req,params,origin,send}){
    if(!['superadmin','admin'].includes(actor.role))return send(403,{error:'Keine Berechtigung'});
    if(!['GET','POST'].includes(req.method))return send(405,{error:'Methode nicht verfügbar'});
    let input=Object.fromEntries(params);
    if(req.method==='POST'){
      if(!origin||req.headers.origin!==origin||String(req.headers['content-type']||'').split(';')[0]!=='application/json')
        return send(403,{error:'Ungültige Anfrage'});
      const chunks=[];
      let bytes=0;
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>4096)return send(413,{error:'Anfrage zu groß'});
        chunks.push(chunk);
      }
      try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Ungültiges JSON'});}
      if(!input||typeof input!=='object'||Array.isArray(input))return send(400,{error:'Ungültige Anfrage'});
    }

    const tenantId=actor.role==='superadmin'?input.tenantId:actor.tenant_id;
    const {identity,stationId,action,cardId,enabled,userId}=input;
    if(!validUuid(tenantId))return send(400,{error:'Kunde auswählen'});
    const tenant=await pool.query("SELECT id FROM cv_tenants WHERE id=$1 AND status='active' AND deleted_at IS NULL",[tenantId]);
    if(!tenant.rowCount)return send(403,{error:'Kunde nicht freigeschaltet'});
    if(req.method==='GET')return send(200,await readCards(tenantId,actor,identity));
    if(!configured)return send(503,{error:'RFID ist serverseitig noch nicht eingerichtet'});
    if(action==='assign-seen'){
      const result=await assignSeen(tenantId,actor,input);
      if(result)return send(result.status,{error:result.error});
      return send(200,await readCards(tenantId,actor,identity));
    }
    if(action==='set-enabled'){
      if(!validUuid(cardId)||typeof enabled!=='boolean')return send(400,{error:'Karte und Status erforderlich'});
      const changed=await transaction(pool,async client=>{
        const result=await client.query('UPDATE cv_rfid_cards SET enabled=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id',[enabled,cardId,tenantId]);
        if(!result.rowCount)return false;
        await client.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
          [actor.id,tenantId,enabled?'rfid_enabled':'rfid_disabled',cardId]);
        return true;
      });
      if(!changed)return send(404,{error:'Karte nicht gefunden'});
      return send(200,await readCards(tenantId,actor,identity));
    }
    if(action!=='manual'){
      if(!validUuid(stationId)||typeof identity!=='string'||identity.length>120)
        return send(400,{error:'OCPP-Verbindung auswählen'});
      const station=await pool.query(`
        SELECT c.identity FROM cv_ocpp_credentials c
        JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id
        WHERE c.identity=$1 AND c.station_id=$2 AND c.tenant_id=$3 AND NOT s.is_simulator`,
      [identity,stationId,tenantId]);
      if(!station.rowCount)return send(404,{error:'Physische Wallbox nicht gefunden'});
    }
    const open=windows.get(identity);
    const own=open?.actorId===actor.id&&open.tenantId===tenantId&&open.stationId===stationId&&open.until>Date.now();
    if(action==='open'){
      if(open&&open.until>Date.now())return send(409,{error:'Für diese Wallbox läuft bereits ein Einlesefenster'});
      const window={actorId:actor.id,tenantId,stationId,until:Date.now()+90000,candidate:null};
      windows.set(identity,window);
      setTimeout(()=>{if(windows.get(identity)===window)windows.delete(identity);},90000).unref();
    }else if(action==='cancel'){
      if(own)windows.delete(identity);
    }else if(action==='manual'||action==='confirm'){
      if(action==='confirm'&&(!own||open.candidate!==input.tag))
        return send(409,{error:'Einlesefenster oder erkannte Kennung hat sich geändert'});
      if(!isCardTag(input.tag)||!validUuid(userId)||typeof input.label!=='string'||!input.label.trim()||input.label.length>80)
        return send(400,{error:'Kartenkennung, Name und Nutzer sind erforderlich'});
      const cardId=randomUUID();
      const result=await transaction(pool,async client=>{
        const user=await client.query(
          "SELECT id FROM cv_users WHERE id=$1 AND tenant_id=$2 AND enabled AND role='user' FOR SHARE",[userId,tenantId]);
        if(!user.rowCount)return 'user';
        const added=await client.query(`
          INSERT INTO cv_rfid_cards(id,tenant_id,user_id,tag_hash,label,tag_cipher) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(tag_hash) DO NOTHING RETURNING id`,[cardId,tenantId,userId,tagHash(input.tag),input.label.trim(),seal(input.tag,tenantId,tagHash(input.tag))]);
        if(!added.rowCount)return 'duplicate';
        await client.query("INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,'rfid_enrolled',$3)",
          [actor.id,tenantId,cardId]);
        return 'added';
      });
      if(result==='user')return send(404,{error:'Aktiver Nutzer nicht gefunden'});
      if(result==='duplicate')return send(409,{error:'Diese Kartenkennung ist bereits registriert'});
      if(action==='confirm'&&windows.get(identity)===open)windows.delete(identity);
    }else return send(400,{error:'Unbekannte RFID-Aktion'});
    return send(200,await readCards(tenantId,actor,identity));
  }

  async function history(actor,tenantId,{userId=null,from=null,to=null,beforeId=null,limit=100,siteId=null}={}){
    const params=[tenantId,actor.role==='user'?actor.id:userId,from,to,beforeId,limit,siteId];
    const {rows}=await pool.query(`
      SELECT x.id,x.connector_id,s.id AS station_id,s.name AS station_name,p.name AS point_name,
        si.id AS site_id,si.name AS site_name,t.name AS organization_name,
        CASE WHEN x.authorization_kind='remote' THEN
          CASE COALESCE(x.remote_actor_role,
            CASE WHEN x.user_id IS NOT NULL THEN 'user' END,
            -- Legacy remote starts: only a single matching audit event close to
            -- the transaction start is evidence. Never guess an unknown role.
            (SELECT CASE WHEN count(*)=1 THEN min(au.role::text) END
             FROM cv_audit a JOIN cv_users au ON au.id=a.actor_id
             WHERE a.tenant_id=x.tenant_id AND a.target_id=x.chargepoint_id::text
               AND a.action='ocpp_start'
               AND a.happened_at BETWEEN x.started_at-interval '5 seconds' AND x.started_at+interval '5 seconds'))
            WHEN 'superadmin' THEN 'S-Admin' WHEN 'admin' THEN 'Admin' WHEN 'user' THEN 'Nutzer'
          END
        ELSE u.name END AS user_name,x.price_per_kwh,x.started_at,x.stopped_at,x.simulated,x.authorization_kind,
        x.card_id,r.label AS card_name,x.stop_reason,x.signed_meter,x.meter_start_wh,x.meter_stop_wh,
        CASE WHEN x.stopped_at IS NOT NULL AND x.meter_stop_wh>=x.meter_start_wh
          THEN x.meter_stop_wh-x.meter_start_wh END AS energy_wh,
        CASE WHEN x.stopped_at IS NOT NULL AND x.meter_stop_wh>=x.meter_start_wh
          THEN round((x.meter_stop_wh-x.meter_start_wh)*x.price_per_kwh/1000,2) END AS amount_eur
      FROM cv_ocpp_transactions x
      JOIN cv_tenants t ON t.id=x.tenant_id
      JOIN cv_ocpp_credentials c ON c.identity=x.identity AND c.tenant_id=x.tenant_id
      JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id
      LEFT JOIN cv_sites si ON si.id=s.site_id AND si.tenant_id=s.tenant_id
      LEFT JOIN cv_chargepoints p ON p.id=x.chargepoint_id AND p.tenant_id=x.tenant_id
      LEFT JOIN cv_users u ON u.id=x.user_id AND u.tenant_id=x.tenant_id
      LEFT JOIN cv_rfid_cards r ON r.id=x.card_id AND r.tenant_id=x.tenant_id
      WHERE x.tenant_id=$1 AND NOT x.simulated
        AND ($7::uuid IS NULL OR s.site_id=$7)
        AND ($2::uuid IS NULL OR x.user_id=$2)
        AND ($3::date IS NULL OR x.started_at>=($3::date::timestamp AT TIME ZONE 'Europe/Berlin'))
        AND ($4::date IS NULL OR x.started_at<(($4::date+1)::timestamp AT TIME ZONE 'Europe/Berlin'))
        AND ($5::bigint IS NULL OR (x.started_at,x.id)<(
          SELECT started_at,id FROM cv_ocpp_transactions
          WHERE id=$5 AND tenant_id=$1 AND NOT simulated AND ($2::uuid IS NULL OR user_id=$2)
        ))
      ORDER BY x.started_at DESC,x.id DESC LIMIT $6`,params);
    return rows;
  }
  async function firstHistoryMonth(actor,tenantId){
    const {rows:[entry]}=await pool.query(`
      SELECT to_char(started_at AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS month
      FROM cv_ocpp_transactions
      WHERE tenant_id=$1 AND NOT simulated AND ($2::uuid IS NULL OR user_id=$2)
      ORDER BY started_at,id LIMIT 1`,[tenantId,actor.role==='user'?actor.id:null]);
    return entry?.month??null;
  }

  async function powerHistory(actor,tenantId,siteId){
    const {rows}=await pool.query(`
      WITH eligible AS (
        SELECT p.id,p.ocpp_identity,p.connector_number
        FROM cv_chargepoints p
        JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id
        WHERE p.tenant_id=$1 AND p.enabled AND NOT s.is_simulator
          AND ($3::uuid IS NULL OR s.site_id=$3)
          AND ($2::uuid IS NULL OR EXISTS (
            SELECT 1 FROM cv_point_access a WHERE a.tenant_id=p.tenant_id AND a.user_id=$2 AND a.chargepoint_id=p.id
          ))
      ), readings AS (
        SELECT DISTINCT ON (bucket,p.id) p.id,
          date_bin(interval '2 minutes',e.created_at,'2000-01-01T00:00:00Z') AS bucket,
          CASE WHEN e.action='MeterValues' THEN (e.payload->>'powerW')::numeric ELSE 0 END AS watts
        FROM cv_ocpp_events e
        JOIN eligible p ON p.ocpp_identity=e.identity AND e.payload->>'connectorId'=p.connector_number::text
        WHERE e.tenant_id=$1 AND NOT e.simulated AND e.action IN ('MeterValues','StatusNotification')
          AND e.created_at>=date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'
          AND (e.action='MeterValues' AND jsonb_typeof(e.payload->'powerW')='number'
            OR e.action='StatusNotification' AND e.payload->>'status' IN ('Available','Preparing','Finishing'))
        ORDER BY bucket,p.id,e.created_at DESC,e.id DESC
      )
      SELECT bucket,sum(watts)/1000 AS kw,count(*)::int AS reported,
        (SELECT count(*)::int FROM eligible) AS points
      FROM readings GROUP BY bucket ORDER BY bucket`,[tenantId,actor.role==='user'?actor.id:null,siteId]);
    return rows;
  }
  return {authorize,start,stop,sample,handleRfid,history,firstHistoryMonth,powerHistory,configured};
}
