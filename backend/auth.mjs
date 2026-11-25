import {randomBytes,randomUUID,createHash,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {sendInviteMail,sendAccessNoticeMail} from './mail.mjs';
import {sendMicrosoftMail} from './microsoft.mjs';
const scrypt=promisify(scryptCb),COOKIE='cv_session';
const token=()=>randomBytes(32).toString('base64url');
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const email=v=>String(v||'').trim().toLowerCase();
const str=(v,n=160)=>String(v||'').trim().slice(0,n);
// Missing fields preserve existing values on PATCH; an explicit empty string clears a field.
function customerAddress(p,partial=false){
  return Object.fromEntries(Object.entries({street:160,houseNumber:30,postalCode:20,city:120,country:90}).map(([key,max])=>{
    if(p[key]===undefined)return [key,partial?undefined:''];
    if(typeof p[key]!=='string'||p[key].trim().length>max)fail(400,'Ungültige Kundenanschrift');
    return [key,p[key].trim()];
  }));
}
const validEmail=v=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validPwd=v=>typeof v==='string'&&v.length>=12&&v.length<=256;
const reply=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
const getCookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
const publicBase=env=>env.CV_PUBLIC_URL?.trim().replace(/\/+$/,'');
const base=(req,env)=>publicBase(env)||'https://'+req.headers.host;
const setCookie=(req,env,t,age)=>COOKIE+'='+t+'; Path=/; Max-Age='+age+'; HttpOnly; SameSite=Lax'+(base(req,env).startsWith('https://')?'; Secure':'');
const buckets=new Map();
function rateLimit(key){const now=Date.now(),b=buckets.get(key)||{time:now,count:0};if(now-b.time>900000){b.time=now;b.count=0;}b.count++;buckets.set(key,b);if(buckets.size>2000)buckets.clear();return b.count<=10;}
// Existing users keep one login. Access can grow without generating another invitation.
const uuidPattern=/^[a-f0-9-]{36}$/i;
const previewIdPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const previewPaths=new Set([
  '/api/auth/me','/api/points','/api/users','/api/invitations','/api/structure/overview','/api/ocpp/live','/api/ocpp/sessions','/api/ocpp/analytics'
]);
const actorColumns='u.id,u.email,u.name,u.role,u.enabled,u.tenant_id,u.can_invite_users,u.can_download_pdf,u.can_control_charging,u.can_reset_station,'+
  't.price_per_kwh,t.name AS tenant_name,t.status AS tenant_status,t.contact_name,t.contact_email,t.contact_phone';
const validLinkToken=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{35,100}$/.test(value);
const availableRecoveryAccount="u.enabled AND u.portal_enabled AND (u.tenant_id IS NULL OR (t.deleted_at IS NULL AND t.status<>'suspended'))";
const availableResetToken='r.token_hash=$1 AND r.expires_at>now() AND r.used_at IS NULL';
const availableInviteTenant="t.deleted_at IS NULL AND t.status<>'suspended'";
const emailInUse='Für diese E-Mail besteht bereits ein ChargeVisor-Zugang. Bitte kläre die Kundenzuordnung mit Walectra.';
function parsePointIds(ids,required=true){
  if(!Array.isArray(ids)||ids.length>50||(required&&!ids.length)||
     ids.some(id=>typeof id!=='string'||!uuidPattern.test(id))||new Set(ids).size!==ids.length)
    fail(400,required?'Bitte mindestens einen gültigen Ladepunkt auswählen':'Ungültige Ladepunktauswahl');
  return ids;
}
function pointSelection(data){
  if(data.allPoints!==undefined&&typeof data.allPoints!=='boolean')fail(400,'Ungültige Ladepunktauswahl');
  return data.allPoints?{allPoints:true,pointIds:[]}:
    {allPoints:false,pointIds:parsePointIds(data.pointIds??[],false)};
}
async function enabledPoints(client,tenantId,{pointIds,allPoints}){
  if(!allPoints&&!pointIds.length)return [];
  const result=await client.query(
    'SELECT id,name FROM cv_chargepoints WHERE tenant_id=$1 AND enabled=true'+
    (allPoints?'':' AND id=ANY($2::uuid[])')+' ORDER BY id FOR SHARE',
    allPoints?[tenantId]:[tenantId,pointIds]);
  if(!allPoints&&result.rowCount!==pointIds.length)
    fail(403,'Mindestens ein Ladepunkt gehört nicht zu diesem Kunden oder ist deaktiviert');
  return result.rows;
}
export async function updateUserPointAccess(client,{tenantId,userId,pointIds=[],allPoints=false,replace=false}){
  if(!allPoints)parsePointIds(pointIds,!replace);
  const allowed=await enabledPoints(client,tenantId,{pointIds,allPoints});
  const ids=allowed.map(point=>point.id);
  const inserted=ids.length?
    await client.query(
      'INSERT INTO cv_point_access(user_id,chargepoint_id,tenant_id) '+
      'SELECT $1,id,$2 FROM cv_chargepoints WHERE tenant_id=$2 AND enabled=true AND id=ANY($3::uuid[]) '+
      'ON CONFLICT DO NOTHING RETURNING chargepoint_id',[userId,tenantId,ids]):
    {rows:[],rowCount:0};
  const addedIds=new Set(inserted.rows.map(row=>row.chargepoint_id));
  const removed=replace?await client.query(
    'DELETE FROM cv_point_access a USING cv_chargepoints p WHERE a.user_id=$1 AND a.tenant_id=$2 '+
    'AND p.id=a.chargepoint_id AND p.tenant_id=a.tenant_id'+(allPoints?'':' AND p.enabled')+
    ' AND NOT(a.chargepoint_id=ANY($3::uuid[])) RETURNING a.chargepoint_id',
    [userId,tenantId,ids]):{rowCount:0,rows:[]};
  return {added:inserted.rowCount,removed:removed.rowCount,
    addedNames:allowed.filter(point=>addedIds.has(point.id)).map(point=>point.name)};
}
export async function hashPassword(v){
  if(!validPwd(v))fail(400,'Passwort muss mindestens 12 Zeichen lang sein');
  const salt=randomBytes(16).toString('hex');
  const derived=await scrypt(v,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return 'scrypt$'+salt+'$'+Buffer.from(derived).toString('hex');
}
export async function verifyPassword(v,h){
  if(typeof v!=='string'||v.length>256||typeof h!=='string')return false;
  const m=/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(h);
  if(!m)return false;
  const derived=await scrypt(v,Buffer.from(m[1],'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(Buffer.from(derived),Buffer.from(m[2],'hex'));
}
async function readJson(req){
  const buffers=[];let n=0;
  for await(const c of req){n+=c.length;if(n>16384)fail(413,'Anfrage zu groß');buffers.push(c);}
  try{return JSON.parse(Buffer.concat(buffers).toString('utf8')||'{}');}
  catch{fail(400,'Ungültiges JSON');}
}
export async function createAuthApi(env=process.env){
  let pool=null,status='database_not_configured';
  if(env.CV_DATABASE_URL){
    try{
      const {Pool}=await import('pg');
      const p=new Pool({connectionString:env.CV_DATABASE_URL,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
      await p.query('SELECT id FROM cv_users LIMIT 1');
      // Idempotent migration of existing Neon databases created before password recovery.
      await p.query(`CREATE TABLE IF NOT EXISTS cv_password_resets (
        token_hash char(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await p.query('CREATE INDEX IF NOT EXISTS cv_password_resets_user_idx ON cv_password_resets(user_id)');
      // Idempotent migration: pre-existing customer records remain editable.
      for(const sql of [
        "ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT ''",
        "ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT ''",
        "ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT ''",
        "ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS street text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS house_number text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT ''",
        "ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz"
      ])await p.query(sql);
      await p.query('ALTER TABLE cv_tenants ADD COLUMN IF NOT EXISTS price_per_kwh numeric(7,4) CHECK (price_per_kwh BETWEEN 0 AND 999)');
      await p.query('ALTER TABLE cv_users ADD COLUMN IF NOT EXISTS archived_login_email text,'+
        ' ADD COLUMN IF NOT EXISTS can_invite_users boolean NOT NULL DEFAULT false,'+
        ' ADD COLUMN IF NOT EXISTS can_download_pdf boolean NOT NULL DEFAULT false,'+
        ' ADD COLUMN IF NOT EXISTS can_control_charging boolean NOT NULL DEFAULT false,'+
        ' ADD COLUMN IF NOT EXISTS can_reset_station boolean NOT NULL DEFAULT false,'+
        ' ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT true');
      pool=p;status='ready';
    }catch(e){status='database_unavailable_or_schema_missing';console.error('ChargeVisor DB not ready:',e.code||e.message);}
  }
  async function transaction(fn){
    const c=await pool.connect();
    try{await c.query('BEGIN');const val=await fn(c);await c.query('COMMIT');return val;}
    catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async function lockAccountEmail(client,emailAddress){
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['chargevisor-account:'+emailAddress]);
  }
  async function requireWritableTenant(client,actor,tenantId){
    const {rows:[tenant]}=await client.query(
      'SELECT status FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[tenantId]);
    if(!tenant)fail(404,'Kunde nicht vorhanden');
    if(tenant.status==='suspended'||(actor.role==='admin'&&tenant.status!=='active'))
      fail(403,'Walectra-Freigabe fehlt');
  }
  async function sessionActor(req){
    const t=getCookie(req);
    if(!pool||!t||!/^[a-zA-Z0-9_-]{32,100}$/.test(t))return null;
    const r=await pool.query('SELECT '+actorColumns+' '+
      'FROM cv_sessions s JOIN cv_users u ON u.id=s.user_id LEFT JOIN cv_tenants t ON t.id=u.tenant_id '+
      'WHERE s.token_hash=$1 AND s.expires_at>now() AND '+availableRecoveryAccount,[sha(t)]);
    return r.rows[0]?.enabled?r.rows[0]:null;
  }
  const role=(a,...allowed)=>{if(!a)fail(401,'Bitte anmelden');if(!allowed.includes(a.role))fail(403,'Keine Berechtigung');};
  const tid=(a,requested)=>{const t=a.role==='superadmin'?requested:a.tenant_id;if(!t)fail(400,'Kunde fehlt');return t;};
  const previewActors=new WeakMap();
  const isPreview=req=>req.headers['x-cv-preview-user']!==undefined||req.headers['x-cv-preview-tenant']!==undefined;
  const getActor=req=>isPreview(req)?previewActors.get(req)??null:sessionActor(req);
  async function authorizeRolePreview(req,res,path){
    if(!isPreview(req))return true;
    try{
      if(req.method!=='GET'||!previewPaths.has(path))fail(403,'Rollenansicht erlaubt nur das Lesen der freigegebenen Seiten');
      if(!pool)fail(503,'Rollenansicht nicht verfügbar');
      role(await sessionActor(req),'superadmin');
      const userId=req.headers['x-cv-preview-user'],tenantId=req.headers['x-cv-preview-tenant'];
      if(typeof userId!=='string'||typeof tenantId!=='string'||!previewIdPattern.test(userId)||!previewIdPattern.test(tenantId))
        fail(400,'Nutzer und Kunde für die Rollenansicht auswählen');
      const result=await pool.query(
        'SELECT '+actorColumns+' FROM cv_users u JOIN cv_tenants t ON t.id=u.tenant_id '+
        "WHERE u.id=$1 AND u.tenant_id=$2 AND u.role IN ('admin','user') AND "+availableRecoveryAccount,
        [userId,tenantId]);
      if(!result.rowCount)fail(404,'Konto für die Rollenansicht nicht verfügbar');
      previewActors.set(req,result.rows[0]);
      return true;
    }catch(error){
      if(!error.status)console.error('ChargeVisor role preview:',error.code||error.message);
      reply(res,error.status||500,{error:error.status?error.message:'Rollenansicht nicht verfügbar'});
      return false;
    }
  }
  async function audit(c,a,tenant,action,target){
    await c.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',[a?.id||null,tenant||null,action,target||null]);
  }
  async function sendPasswordReset(recipient,{tenantId,actor}={}){
    if(!validEmail(recipient))return 'unavailable';
    if(!rateLimit('reset:'+recipient))return 'limited';
    const publicUrl=publicBase(env)||env.RENDER_EXTERNAL_URL?.trim().replace(/\/+$/,'');
    if(!publicUrl)return 'failed';

    const accountScope=tenantId?" AND u.tenant_id=$2 AND u.role='admin' AND lower(btrim(t.contact_email))=u.email":'';
    const resetToken=await transaction(async c=>{
      const {rows:[account]}=await c.query(
        'SELECT u.id FROM cv_users u LEFT JOIN cv_tenants t ON t.id=u.tenant_id '+
        'WHERE u.email=$1 AND '+availableRecoveryAccount+accountScope+' FOR UPDATE OF u',
        tenantId?[recipient,tenantId]:[recipient]);
      if(!account)return null;
      const t=token();
      await c.query('DELETE FROM cv_password_resets WHERE user_id=$1',[account.id]);
      await c.query("INSERT INTO cv_password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [sha(t),account.id]);
      if(tenantId)await audit(c,actor,tenantId,'contact_password_reset_requested',account.id);
      return t;
    });
    if(!resetToken)return 'unavailable';

    const link=publicUrl+'/login?reset='+encodeURIComponent(resetToken);
    const subject='ChargeVisor – Passwort zurücksetzen';
    const body=['Hallo,','','für dein ChargeVisor-Konto wurde ein neues Passwort angefordert. Der Link ist 30 Minuten gültig.',
      '',link,'','Falls du das nicht warst, ignoriere diese Nachricht.','','ChargeVisor by Walectra'].join('\n');
    let sent=false;
    try{
      sent=(await sendMicrosoftMail(env,pool,{to:recipient,subject,body})).sent;
    }catch(err){console.error('ChargeVisor password recovery Graph:',err.message);}
    if(!sent)try{sent=(await sendAccessNoticeMail(env,recipient,subject,body)).sent;}
    catch(err){console.error('ChargeVisor password recovery SMTP:',err.code||err.message);}
    if(!sent)console.warn('ChargeVisor password recovery email not sent');
    return sent?'email':'failed';
  }
  async function notifyNewPoints(user,addedNames,req){
    if(!user.portal_enabled||!addedNames.length)return 'none';
    const subject='ChargeVisor – Weitere Ladepunkte freigeschaltet';
    const body='Hallo '+user.name+',\n\nfür deinen bestehenden ChargeVisor-Zugang wurden weitere Ladepunkte freigeschaltet:\n'+
      addedNames.map(n=>'• '+n).join('\n')+'\n\nMelde dich wie gewohnt mit deiner E-Mail-Adresse und deinem bisherigen Passwort an:\n'+
      base(req,env)+'/app\n\nDu musst kein neues Konto erstellen und kein neues Passwort vergeben.\n\nChargeVisor by Walectra';
    let sent=false;
    try{sent=(await sendMicrosoftMail(env,pool,{to:user.email,subject,body})).sent;}
    catch(e){console.error('ChargeVisor access notice Graph:',e.message);}
    if(!sent)try{sent=(await sendAccessNoticeMail(env,user.email,subject,body)).sent;}
    catch(e){console.error('ChargeVisor access notice SMTP:',e.message);}
    return sent?'email':'failed';
  }
  async function handle(req,res,path){
    if(!path.startsWith('/api/'))return false;
    if(path==='/api/auth/status'&&req.method==='GET'){reply(res,200,{ready:!!pool,status,mode:pool?'auth':'demo'});return true;}
    if(!pool){reply(res,503,{error:'Login noch nicht aktiviert: eigene ChargeVisor-Datenbank erforderlich',code:status});return true;}
    if(!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)){reply(res,405,{error:'Methode nicht erlaubt'});return true;}
    if(req.method!=='GET'){
      if(req.headers.origin!==base(req,env)){reply(res,403,{error:'Ungültige Anfragequelle'});return true;}
      if(req.method!=='DELETE'&&(req.headers['content-type']||'').split(';')[0]!=='application/json'){reply(res,415,{error:'JSON erwartet'});return true;}
    }
    try{
      if(path==='/api/auth/invite-status'&&req.method==='GET'){
        const t=new URL(req.url,'http://localhost').searchParams.get('token');
        if(!validLinkToken(t)){reply(res,200,{status:'invalid'});return true;}
        const {rows:[invite]}=await pool.query(
          'SELECT i.email,i.tenant_id,i.role,i.accepted_at,i.expires_at>now() AS unexpired FROM cv_invitations i '+
          'JOIN cv_tenants t ON t.id=i.tenant_id WHERE i.token_hash=$1 AND '+availableInviteTenant,[sha(t)]);
        if(invite?.accepted_at){
          const a=await sessionActor(req);
          const signedIn=a?.email===invite.email&&a.tenant_id===invite.tenant_id&&a.role===invite.role;
          reply(res,200,{status:'accepted',signedIn});return true;
        }
        reply(res,200,{status:invite?.unexpired?'pending':'invalid'});return true;
      }
      if(path==='/api/auth/password-reset/status'&&req.method==='GET'){
        const t=new URL(req.url,'http://localhost').searchParams.get('token');
        if(!validLinkToken(t)){reply(res,200,{status:'invalid'});return true;}
        const r=await pool.query(
          'SELECT 1 FROM cv_password_resets r JOIN cv_users u ON u.id=r.user_id LEFT JOIN cv_tenants t ON t.id=u.tenant_id '+
          'WHERE '+availableResetToken+' AND '+availableRecoveryAccount,[sha(t)]);
        reply(res,200,{status:r.rowCount?'pending':'invalid'});return true;
      }
      if(path==='/api/auth/password-reset/request'&&req.method==='POST'){
        const p=await readJson(req);
        await sendPasswordReset(email(p.email));
        reply(res,200,{ok:true,message:'Falls diese E-Mail-Adresse registriert ist, erhältst du einen Link zum Zurücksetzen des Passworts.'});return true;
      }
      if(path==='/api/auth/password-reset/confirm'&&req.method==='POST'){
        const p=await readJson(req),t=p.token;
        if(!validLinkToken(t)||!validPwd(p.password))
          fail(400,'Link ungültig oder Passwort zu kurz (mindestens 12 Zeichen)');
        await transaction(async c=>{
          // Acquire the same account lock as a new recovery request.
          const q=await c.query(
            'SELECT u.id FROM cv_password_resets r JOIN cv_users u ON u.id=r.user_id LEFT JOIN cv_tenants t ON t.id=u.tenant_id '+
            'WHERE '+availableResetToken+' AND '+availableRecoveryAccount+' FOR UPDATE OF u',
            [sha(t)]);
          const uid=q.rows[0]?.id;
          if(!uid)fail(400,'Link abgelaufen oder bereits verwendet. Bitte einen neuen anfordern.');
          const used=await c.query('UPDATE cv_password_resets SET used_at=now() '+
            'WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() AND used_at IS NULL RETURNING user_id',[sha(t),uid]);
          if(!used.rowCount)fail(400,'Link abgelaufen oder bereits verwendet. Bitte einen neuen anfordern.');
          await c.query('UPDATE cv_users SET password_hash=$1 WHERE id=$2',[await hashPassword(p.password),uid]);
          await c.query('DELETE FROM cv_sessions WHERE user_id=$1',[uid]);
          await audit(c,null,null,'password_reset',uid);
        });
        reply(res,200,{ok:true});return true;
      }
      if(path==='/api/auth/accept'&&req.method==='POST'){
        const p=await readJson(req),t=p.token;
        if(!validLinkToken(t)||!validPwd(p.password))fail(400,'Einladungslink ungültig oder Passwort zu kurz');
        const result=await transaction(async c=>{
          const tokenHash=sha(t);
          const {rows:[pending]}=await c.query('SELECT email,tenant_id FROM cv_invitations WHERE token_hash=$1',[tokenHash]);
          if(!pending)fail(400,'Einladung abgelaufen oder verbraucht');
          await lockAccountEmail(c,pending.email);
          // Archive operations lock the tenant before expiring its invitations.
          const tenant=await c.query(
            'SELECT id FROM cv_tenants t WHERE id=$1 AND '+availableInviteTenant+' FOR SHARE',[pending.tenant_id]);
          if(!tenant.rowCount)fail(400,'Einladung abgelaufen oder verbraucht');
          const q=await c.query(
            'SELECT * FROM cv_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash]);
          const inv=q.rows[0];
          if(!inv)fail(400,'Einladung abgelaufen oder verbraucht');
          const hash=await hashPassword(p.password);
          const activated=await c.query(
            "UPDATE cv_users SET password_hash=$1,portal_enabled=true WHERE email=$2 AND tenant_id=$3 "+
            "AND role='user' AND role=$4 AND enabled AND NOT portal_enabled RETURNING id",
            [hash,inv.email,inv.tenant_id,inv.role]);
          let id=activated.rows[0]?.id;
          if(!id){
            // Release a prior login only when this new invitation is redeemed.
            // Keep the archived user's identity, email history and references intact.
            await c.query(
              "UPDATE cv_users u SET archived_login_email=u.email,email='archived:' || u.id::text,enabled=false "+
              'FROM cv_tenants t WHERE u.email=$1 AND t.id=u.tenant_id AND t.deleted_at IS NOT NULL',[inv.email]);
            id=randomUUID();
            const inserted=await c.query(
              'INSERT INTO cv_users(id,tenant_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING RETURNING id',
              [id,inv.tenant_id,inv.email,inv.name,inv.role,hash]);
            if(!inserted.rowCount)fail(409,emailInUse);
          }
          if(inv.role==='user'){
            // In one transaction, activate the invited user's pre-approved access.
            await c.query(
              `INSERT INTO cv_point_access(user_id,chargepoint_id,tenant_id)
                SELECT $1,ap.chargepoint_id,$2
                FROM cv_invitation_point_access ap
                JOIN cv_invitations i ON i.token_hash=ap.token_hash AND i.tenant_id=ap.tenant_id
                JOIN cv_chargepoints cp ON cp.id=ap.chargepoint_id
                  AND cp.tenant_id=ap.tenant_id AND cp.enabled=true
                WHERE i.tenant_id=$2 AND i.email=$3 AND i.role='user'
                  AND i.accepted_at IS NULL AND i.expires_at>now()
                ON CONFLICT DO NOTHING`,
              [id,inv.tenant_id,inv.email]);
          }
          // An invited person may have received several point invitations before registering.
          // Accepting any valid one grants the union of all currently pending points.
          await c.query(
            'UPDATE cv_invitations SET accepted_at=now() WHERE tenant_id=$1 AND email=$2 AND role=$3 AND accepted_at IS NULL AND expires_at>now()',
            [inv.tenant_id,inv.email,inv.role]);
          await audit(c,null,inv.tenant_id,activated.rowCount?'portal_access_activated':'invite_accepted',id);
          return {ok:true,email:inv.email};
        });
        reply(res,201,result);return true;
      }
      if(path==='/api/auth/login'&&req.method==='POST'){
        const p=await readJson(req),e=email(p.email),ip=String(req.socket.remoteAddress||'');
        if(!rateLimit(ip+'|'+e))fail(429,'Zu viele Anmeldeversuche');
        const q=await pool.query('SELECT u.*,t.status AS tenant_status,t.deleted_at AS tenant_deleted_at FROM cv_users u LEFT JOIN cv_tenants t ON t.id=u.tenant_id WHERE email=$1',[e]);
        const a=q.rows[0],valid=a?.enabled&&a.portal_enabled&&await verifyPassword(p.password,a.password_hash);
        if(!valid)fail(401,'E-Mail oder Passwort falsch');
        if(a.tenant_status==='suspended'||a.tenant_deleted_at)fail(403,'Kundenkonto ist gesperrt');
        const t=token();
        await pool.query("INSERT INTO cv_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[sha(t),a.id]);
        reply(res,200,{ok:true},{'Set-Cookie':setCookie(req,env,t,604800)});return true;
      }
      const a=await getActor(req);
      if(path==='/api/auth/me'&&req.method==='GET'){
        role(a,'superadmin','admin','user');
        reply(res,200,{user:{id:a.id,email:a.email,name:a.name,role:a.role,tenantId:a.tenant_id,
          pricePerKwh:a.price_per_kwh??null,
          canControlCharging:a.can_control_charging===true,canResetStation:a.can_reset_station===true,
          testToolsEnabled:env.CV_SHOW_TEST_TOOLS==='1',
          canInviteUsers:a.role==='superadmin'||(a.role==='admin'&&a.can_invite_users===true),
          canDownloadPdf:a.role==='superadmin'||(a.role==='admin'&&a.can_download_pdf===true),
          tenantName:a.tenant_name||null,tenantStatus:a.tenant_status||null,
          contactName:a.contact_name||null,contactEmail:a.contact_email||null,contactPhone:a.contact_phone||null}});return true;
      }
      if(path==='/api/auth/logout'&&req.method==='POST'){
        const t=getCookie(req);if(t)await pool.query('DELETE FROM cv_sessions WHERE token_hash=$1',[sha(t)]);
        reply(res,200,{ok:true},{'Set-Cookie':setCookie(req,env,'',0)});return true;
      }
      if(path==='/api/tenants'&&req.method==='GET'){
        role(a,'superadmin');
        const r=await pool.query(`
          SELECT t.id,t.name,t.status,t.price_per_kwh,t.contact_name,t.contact_email,t.contact_phone,t.street,t.house_number,t.postal_code,t.city,t.country,t.created_at,
            CASE
              WHEN u.tenant_id=t.id AND u.role='admin' AND u.enabled THEN 'registered'
              WHEN u.tenant_id=t.id AND u.role='admin' THEN 'disabled'
              WHEN u.id IS NOT NULL AND owner.deleted_at IS NULL THEN 'reserved'
              WHEN invitation.expires_at>now() THEN 'invited'
              WHEN invitation.expires_at IS NOT NULL THEN 'expired'
              ELSE 'available'
            END AS contact_access
          FROM cv_tenants t
          LEFT JOIN cv_users u ON u.email=lower(btrim(t.contact_email))
          LEFT JOIN cv_tenants owner ON owner.id=u.tenant_id
          LEFT JOIN LATERAL (
            SELECT max(i.expires_at) AS expires_at FROM cv_invitations i
            WHERE i.tenant_id=t.id AND i.role='admin' AND i.email=lower(btrim(t.contact_email)) AND i.accepted_at IS NULL
          ) invitation ON true
          WHERE t.deleted_at IS NULL ORDER BY t.created_at DESC`);
        reply(res,200,{tenants:r.rows});return true;
      }
      if(path==='/api/tenants'&&req.method==='POST'){
        role(a,'superadmin');
        const p=await readJson(req);
        const name=str(p.name,180),contactName=str(p.contactName,160),contactEmail=email(p.contactEmail),
          contactPhone=str(p.contactPhone,60);
        const address=customerAddress(p);
        if(name.length<2||contactName.length<2||!validEmail(contactEmail)||contactPhone.length<5)
          fail(400,'Kundenname, Kontaktperson, gültige E-Mail und Telefonnummer sind erforderlich');
        const id=randomUUID();
        await transaction(async client=>{
          await client.query(
            'INSERT INTO cv_tenants(id,name,contact_name,contact_email,contact_phone,status,street,house_number,postal_code,city,country) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
            [id,name,contactName,contactEmail,contactPhone,'active',address.street,address.houseNumber,address.postalCode,address.city,address.country]);
          await audit(client,a,id,'tenant_created',id);
        });
        reply(res,201,{id,name,contact_name:contactName,contact_email:contactEmail,
          contact_phone:contactPhone,status:'active',street:address.street,house_number:address.houseNumber,postal_code:address.postalCode,city:address.city,country:address.country});return true;
      }
      const contactResetMatch=path.match(/^[/]api[/]tenants[/]([a-f0-9-]{36})[/]contact-password-reset$/i);
      if(contactResetMatch&&req.method==='POST'){
        role(a,'superadmin');const tenantId=contactResetMatch[1];
        if(!previewIdPattern.test(tenantId))fail(400,'Ungültiges Kundenkonto');
        const {rows:[tenant]}=await pool.query(
          "SELECT contact_email FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL AND status<>'suspended'",[tenantId]);
        if(!tenant)fail(404,'Kein freigegebenes Kundenkonto gefunden');
        const delivery=await sendPasswordReset(email(tenant.contact_email),{tenantId,actor:a});
        if(delivery==='unavailable')fail(409,'Für die aktuelle Kontaktadresse ist kein aktiver Kunden-Admin-Zugang hinterlegt.');
        if(delivery==='limited')fail(429,'Zu viele Anfragen. Bitte später erneut versuchen.');
        reply(res,200,{delivery});return true;
      }
      const priceRoute=path.match(/^[/]api[/]tenants[/]([a-f0-9-]{36})[/]tariff$/i);
      if(priceRoute&&req.method==='PUT'){
        role(a,'superadmin','admin');
        const id=priceRoute[1];
        if(!previewIdPattern.test(id))fail(400,'Ungültiges Kundenkonto');
        if(a.role==='admin'&&a.tenant_id!==id)fail(403,'Keine Berechtigung');
        const {pricePerKwh}=await readJson(req);
        if(typeof pricePerKwh!=='number'||!Number.isFinite(pricePerKwh)||pricePerKwh<0||pricePerKwh>999)
          fail(400,'Bitte einen gültigen Preis in Euro pro kWh eingeben');
        const saved=await transaction(async client=>{
          await requireWritableTenant(client,a,id);
          const result=await client.query(
            'UPDATE cv_tenants SET price_per_kwh=$2,updated_at=now() WHERE id=$1 RETURNING price_per_kwh',[id,pricePerKwh]);
          await audit(client,a,id,'tenant_tariff_updated',id);
          return result.rows[0];
        });
        reply(res,200,saved);return true;
      }
      const tenantMatch=path.match(/^[/]api[/]tenants[/]([a-f0-9-]{36})$/i);
      if(tenantMatch&&req.method==='PATCH'){
        role(a,'superadmin');const p=await readJson(req),id=tenantMatch[1];
        // Update either the customer data or status; license count is no longer a customer setting.
        if(p.status!==undefined&&!['pending','active','suspended'].includes(p.status))
          fail(400,'Ungültiger Kundenstatus');
        const name=p.name===undefined?undefined:str(p.name,180);
        const contactName=p.contactName===undefined?undefined:str(p.contactName,160);
        const contactEmail=p.contactEmail===undefined?undefined:email(p.contactEmail);
        const contactPhone=p.contactPhone===undefined?undefined:str(p.contactPhone,60);
        const address=customerAddress(p,true);
        if(name!==undefined&&name.length<2||
           contactName!==undefined&&contactName.length<2||
           contactEmail!==undefined&&!validEmail(contactEmail)||
           contactPhone!==undefined&&contactPhone.length<5)
          fail(400,'Ungültige Kunden- oder Kontaktdaten');
        if([name,contactName,contactEmail,contactPhone,p.status,...Object.values(address)].every(x=>x===undefined))
          fail(400,'Keine Änderungen übermittelt');
        const updated=await transaction(async client=>{
          const existing=await client.query('SELECT id FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id]);
          if(!existing.rowCount)fail(404,'Kunde nicht gefunden');
          const r=await client.query(
            'UPDATE cv_tenants SET name=COALESCE($2,name),contact_name=COALESCE($3,contact_name),'+
            'contact_email=COALESCE($4,contact_email),contact_phone=COALESCE($5,contact_phone),'+
            'status=COALESCE($6,status),street=COALESCE($7,street),house_number=COALESCE($8,house_number),'+
            'postal_code=COALESCE($9,postal_code),city=COALESCE($10,city),country=COALESCE($11,country),updated_at=now() WHERE id=$1 AND deleted_at IS NULL '+
            'RETURNING id,name,status,contact_name,contact_email,contact_phone,street,house_number,postal_code,city,country',
            [id,name??null,contactName??null,contactEmail??null,contactPhone??null,p.status??null,address.street??null,address.houseNumber??null,address.postalCode??null,address.city??null,address.country??null]);
          if(p.status==='suspended')await client.query(
            'DELETE FROM cv_sessions WHERE user_id IN (SELECT id FROM cv_users WHERE tenant_id=$1)',[id]);
          await audit(client,a,id,'tenant_updated',id);return r.rows[0];
        });
        reply(res,200,{tenant:updated});return true;
      }
      if(tenantMatch&&req.method==='DELETE'){
        role(a,'superadmin');const id=tenantMatch[1];
        const archived=await transaction(async client=>{
          const r=await client.query(
            "UPDATE cv_tenants SET status='suspended',deleted_at=now(),updated_at=now() "+
            'WHERE id=$1 AND deleted_at IS NULL RETURNING id,name',[id]);
          if(!r.rowCount)fail(404,'Kunde nicht vorhanden oder bereits entfernt');
          await client.query(
            'DELETE FROM cv_sessions WHERE user_id IN (SELECT id FROM cv_users WHERE tenant_id=$1)',[id]);
          await client.query(
            'UPDATE cv_invitations SET expires_at=now() WHERE tenant_id=$1 AND accepted_at IS NULL',[id]);
          await audit(client,a,id,'tenant_archived',id);
          return r.rows[0];
        });
        reply(res,200,{ok:true,archived:true,tenant:archived,
          message:'Kunde archiviert. Seine Zugänge sind gesperrt. Die E-Mail-Adressen können neu eingeladen werden.'});return true;
      }
      if(path==='/api/users'&&req.method==='GET'){
        role(a,'superadmin','admin');
        const requested=new URL(req.url,'http://localhost').searchParams.get('tenantId');
        const id=tid(a,requested);
        const r=await pool.query(
          'SELECT id,COALESCE(archived_login_email,email) AS email,name,role,enabled,portal_enabled,'+
          'can_invite_users,can_download_pdf,can_control_charging,can_reset_station,created_at FROM cv_users WHERE tenant_id=$1 ORDER BY created_at',[id]);
        reply(res,200,{users:r.rows});return true;
      }
      if(path==='/api/users'&&req.method==='POST'){
        role(a,'superadmin','admin');
        const p=await readJson(req),tenantId=tid(a,p.tenantId),name=str(p.name),address=email(p.email);
        if(!validEmail(address)||name.length<2)fail(400,'Bitte Namen und eine gültige E-Mail-Adresse angeben');
        const selection=pointSelection(p),userId=randomUUID();
        const assigned=await transaction(async client=>{
          await lockAccountEmail(client,address);
          await requireWritableTenant(client,a,tenantId);
          const user=await client.query(
            "INSERT INTO cv_users(id,tenant_id,email,name,role,password_hash,portal_enabled) "+
            "VALUES($1,$2,$3,$4,'user','portal-disabled',false) ON CONFLICT(email) DO NOTHING RETURNING id",
            [userId,tenantId,address,name]);
          if(!user.rowCount)fail(409,emailInUse);
          const result=await updateUserPointAccess(client,{tenantId,userId,...selection,replace:true});
          await audit(client,a,tenantId,'rfid_user_created',userId);
          return result;
        });
        reply(res,201,{id:userId,email:address,name,role:'user',enabled:true,portal_enabled:false,addedPoints:assigned.added});return true;
      }
      const stationPermissions=path.match(/^[/]api[/]users[/]([a-f0-9-]{36})[/]charging-permissions$/i);
      if(stationPermissions&&req.method==='PUT'){
        role(a,'superadmin');
        const p=await readJson(req),tenantId=tid(a,p.tenantId),userId=stationPermissions[1];
        if(!previewIdPattern.test(tenantId)||!previewIdPattern.test(userId)||
          typeof p.canControlCharging!=='boolean'||typeof p.canResetStation!=='boolean')
          fail(400,'Ungültige Ladefreigaben');
        await transaction(async client=>{
          await requireWritableTenant(client,a,tenantId);
          const result=await client.query(
            "UPDATE cv_users SET can_control_charging=$1,can_reset_station=($2 AND role='admin') "+
            "WHERE id=$3 AND tenant_id=$4 AND role IN ('admin','user')",
            [p.canControlCharging,p.canResetStation,userId,tenantId]);
          if(!result.rowCount)fail(404,'Konto nicht gefunden');
          await audit(client,a,tenantId,'charging_permissions_updated',userId);
        });
        reply(res,200,{ok:true});return true;
      }
      const adminPermissionsMatch=path.match(/^[/]api[/]users[/]([a-f0-9-]{36})[/]admin-permissions$/i);
      if(adminPermissionsMatch&&req.method==='PUT'){
        role(a,'superadmin');
        const p=await readJson(req),tenantId=tid(a,p.tenantId),userId=adminPermissionsMatch[1];
        if(!previewIdPattern.test(tenantId)||!previewIdPattern.test(userId)||
            typeof p.canInviteUsers!=='boolean'||typeof p.canDownloadPdf!=='boolean')
          fail(400,'Kunden-Admin und beide Berechtigungen angeben');
        const saved=await transaction(async client=>{
          await requireWritableTenant(client,a,tenantId);
          const r=await client.query(
            "UPDATE cv_users SET can_invite_users=$1,can_download_pdf=$2 WHERE id=$3 AND tenant_id=$4 AND role='admin' "+
            'RETURNING id,can_invite_users,can_download_pdf',
            [p.canInviteUsers,p.canDownloadPdf,userId,tenantId]);
          if(!r.rowCount)fail(404,'Kunden-Admin in diesem Kundenkonto nicht gefunden');
          await audit(client,a,tenantId,'admin_permissions_updated',userId);
          return r.rows[0];
        });
        reply(res,200,{ok:true,user:saved});return true;
      }
      if(path==='/api/invitations'&&req.method==='GET'){
        role(a,'superadmin','admin');
        const requested=new URL(req.url,'http://localhost').searchParams.get('tenantId');
        const id=tid(a,requested);
        // Invitation tokens are never returned; tenant scope is enforced server-side.
        const r=await pool.query(
          `SELECT i.email,i.name,i.role,i.created_at,i.expires_at,i.accepted_at,
            COALESCE((SELECT array_agg(cp.name ORDER BY cp.name)
              FROM cv_invitation_point_access ap
              JOIN cv_chargepoints cp ON cp.id=ap.chargepoint_id AND cp.tenant_id=ap.tenant_id
              WHERE ap.token_hash=i.token_hash AND ap.tenant_id=i.tenant_id),
            ARRAY[]::text[]) AS point_names
            FROM cv_invitations i WHERE i.tenant_id=$1 ORDER BY i.created_at DESC LIMIT 50`,
          [id]);
        reply(res,200,{invitations:r.rows});return true;
      }
      if(path==='/api/invitations'&&req.method==='POST'){
        role(a,'superadmin','admin');
        const p=await readJson(req),e=email(p.email),n=str(p.name),r=str(p.role);
        if(!validEmail(e)||n.length<2||!['admin','user'].includes(r))fail(400,'Ungültige Einladung');
        if(a.role==='admin'&&r!=='user')fail(403,'Nur Walectra kann weitere Kunden-Admins einladen');
        const id=tid(a,p.tenantId);
        const selection=pointSelection(p);
        if(r==='admin'&&(selection.allPoints||selection.pointIds.length))fail(400,'Ungültige Ladepunktzuweisung');
        const invitation=await transaction(async client=>{
          await lockAccountEmail(client,e);
          await requireWritableTenant(client,a,id);
          const {rows:[existing]}=await client.query(
            'SELECT u.id,u.tenant_id,u.role,u.enabled,u.portal_enabled,u.name,u.email FROM cv_users u '+
            'LEFT JOIN cv_tenants t ON t.id=u.tenant_id WHERE u.email=$1 AND t.deleted_at IS NULL FOR UPDATE OF u',[e]);
          if(existing){
            if(existing.tenant_id!==id)
              fail(409,emailInUse);
            if(!existing.enabled)fail(403,'Dieser Benutzer ist gesperrt. Bitte das Konto zuerst freigeben.');
            if(existing.role!==r)
              fail(409,'Die E-Mail gehört bereits zu einer anderen Benutzerrolle. Bitte die Rolle separat verwalten.');
            if(r!=='user')return {existing,added:0,addedNames:[]};
            if(existing.portal_enabled){
              const granted=await updateUserPointAccess(client,{tenantId:id,userId:existing.id,...selection});
              if(granted.added)await audit(client,a,id,'existing_user_points_added',existing.id);
              return {existing,...granted};
            }
          }
          if(a.role==='admin'){
            const permission=await client.query(
              "SELECT id FROM cv_users WHERE id=$1 AND tenant_id=$2 AND role='admin' AND enabled AND portal_enabled "+
              'AND can_invite_users FOR SHARE',[a.id,id]);
            if(!permission.rowCount)fail(403,'Walectra hat das Versenden von Portal-Einladungen noch nicht freigegeben.');
          }
          if(!rateLimit('invite:'+a.id))fail(429,'Zu viele Einladungen. Bitte später erneut versuchen.');
          const selected=await enabledPoints(client,id,selection);
          if(r==='user'&&!existing&&!selected.length)fail(400,'Bitte mindestens einen Ladepunkt für den Nutzer auswählen');
          const t=token();
          await client.query(
            "INSERT INTO cv_invitations(token_hash,email,name,role,tenant_id,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '72 hours')",
            [sha(t),e,n,r,id,a.id]);
          if(selected.length)await client.query(
            'INSERT INTO cv_invitation_point_access(token_hash,tenant_id,chargepoint_id) '+
            'SELECT $1,$2,id FROM cv_chargepoints WHERE tenant_id=$2 AND id=ANY($3::uuid[])',
            [sha(t),id,selected.map(point=>point.id)]);
          await audit(client,a,id,'invite_created',e);
          return {token:t};
        });
        if(invitation.existing){
          const {existing,added,addedNames}=invitation;
          const delivery=await notifyNewPoints(existing,addedNames,req);
          reply(res,200,{ok:true,existingUser:true,alreadyAssigned:added===0,addedPoints:added,delivery,
            message:added?'Ladepunkte für bestehenden Nutzer freigeschaltet.':
              r==='admin'?'Kunden-Admin ist bereits registriert.':'Der Nutzer hat bereits Zugriff auf die ausgewählten Ladepunkte.'});
          return true;
        }
        const t=invitation.token;
        const link=base(req,env)+'/login?invite='+encodeURIComponent(t);
        let sent=false;
        try {
          sent=(await sendMicrosoftMail(env,pool,{to:e,subject:'ChargeVisor – Einladung',
            body:'Hallo '+n+',\n\nDu wurdest zu ChargeVisor eingeladen. Bitte lege innerhalb von 72 Stunden dein Passwort fest:\n'+link+'\n\nChargeVisor by Walectra'})).sent;
        } catch(err){console.error('ChargeVisor Graph invitation failed:',err.message);}
        if(!sent)try{sent=(await sendInviteMail(env,e,n,link)).sent;}
        catch(err){console.error('ChargeVisor SMTP invitation failed:',err.code||err.message);}
        reply(res,201,{ok:true,delivery:sent?'email':'manual',link:sent?undefined:link,expiresInHours:72});return true;
      }
      const userPointsMatch=path.match(/^[/]api[/]users[/]([a-f0-9-]{36})[/]points$/i);
      if(userPointsMatch&&req.method==='PUT'){
        role(a,'superadmin','admin');
        const p=await readJson(req),tenantId=tid(a,p.tenantId),userId=userPointsMatch[1],
          selection=pointSelection(p);
        if(!selection.allPoints&&!Array.isArray(p.pointIds))fail(400,'Ungültige Ladepunktauswahl');
        const changed=await transaction(async client=>{
          await requireWritableTenant(client,a,tenantId);
          const member=await client.query(
            "SELECT id,email,name,portal_enabled FROM cv_users WHERE id=$1 AND tenant_id=$2 AND role='user' AND enabled=true FOR UPDATE",
            [userId,tenantId]);
          if(!member.rowCount)fail(404,'Nutzer in diesem Kundenkonto nicht gefunden');
          const updated=await updateUserPointAccess(client,{
            tenantId,userId,...selection,replace:true
          });
          if(updated.added||updated.removed)
            await audit(client,a,tenantId,'user_point_access_updated',userId);
          return {...updated,user:member.rows[0]};
        });
        const delivery=p.notify===false?'none':await notifyNewPoints(changed.user,changed.addedNames,req);
        reply(res,200,{ok:true,addedPoints:changed.added,removedPoints:changed.removed,
          delivery,message:changed.added||changed.removed?
            'Ladepunktzuweisungen aktualisiert.':'Keine Änderungen erforderlich.'});
        return true;
      }
      if(path==='/api/points'&&req.method==='GET'){
        role(a,'superadmin','admin','user');
        const q=new URL(req.url,'http://localhost').searchParams;
        const id=tid(a,q.get('tenantId'));
        const r=a.role==='user'
          ?await pool.query(
              'SELECT p.id,p.name,p.enabled,p.connector_number,st.id AS station_id,st.name AS station_name,st.topology AS station_topology,st.is_simulator,'+
              'si.id AS site_id,si.name AS site_name,si.address AS site_address '+
              'FROM cv_chargepoints p JOIN cv_point_access x ON x.chargepoint_id=p.id AND x.tenant_id=p.tenant_id '+
              'LEFT JOIN cv_stations st ON st.id=p.station_id AND st.tenant_id=p.tenant_id '+
              'LEFT JOIN cv_sites si ON si.id=st.site_id AND si.tenant_id=p.tenant_id '+
              'WHERE p.tenant_id=$1 AND x.user_id=$2 ORDER BY si.name,p.name',[id,a.id])
          :await pool.query('SELECT id,name,ocpp_identity,enabled FROM cv_chargepoints WHERE tenant_id=$1 ORDER BY name',[id]);
        reply(res,200,{points:r.rows});return true;
      }
      if(path==='/api/points'&&req.method==='POST'){
        role(a,'superadmin');
        const p=await readJson(req),id=tid(a,p.tenantId),n=str(p.name),ocpp=str(p.ocppIdentity,120);
        if(!n||!/^[-a-zA-Z0-9_.:]{2,120}$/.test(ocpp))fail(400,'Ladepunktname oder OCPP-ID ungültig');
        const point=await transaction(async c=>{
          const t=(await c.query('SELECT status FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
          if(!t)fail(404,'Kunde nicht vorhanden');if(t.status!=='active')fail(403,'Kunde nicht freigeschaltet');
          const pid=randomUUID();
          await c.query('INSERT INTO cv_chargepoints(id,tenant_id,name,ocpp_identity,enabled) VALUES($1,$2,$3,$4,true)',[pid,id,n,ocpp]);
          await audit(c,a,id,'point_created',pid);return pid;
        });
        reply(res,201,{id:point,name:n,ocppIdentity:ocpp,enabled:true});return true;
      }
      const match=path.match(/^\/api\/points\/([a-f0-9-]{36})\/access$/i);
      if(match&&req.method==='PUT'){
        role(a,'superadmin','admin');
        const p=await readJson(req),id=tid(a,p.tenantId),uid=p.userId,pid=match[1];
        if(!/^[a-f0-9-]{36}$/i.test(uid||''))fail(400,'Ungültige Nutzer-ID');
        const result=await transaction(async c=>{
          const {rows:[user]}=await c.query("SELECT id,name,email,portal_enabled FROM cv_users WHERE id=$1 AND tenant_id=$2 AND role='user' AND enabled=true FOR UPDATE",[uid,id]);
          const {rows:[point]}=await c.query('SELECT id,name,enabled FROM cv_chargepoints WHERE id=$1 AND tenant_id=$2 FOR SHARE',[pid,id]);
          if(!user||!point)fail(404,'Ladepunkt oder Nutzer nicht gefunden');
          const remove=p.allowed===false;
          if(!remove&&!point.enabled)fail(403,'Ladepunkt ist deaktiviert');
          const changed=remove
            ?await c.query('DELETE FROM cv_point_access WHERE user_id=$1 AND chargepoint_id=$2 AND tenant_id=$3',[uid,pid,id])
            :await c.query('INSERT INTO cv_point_access(user_id,chargepoint_id,tenant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[uid,pid,id]);
          if(changed.rowCount)await audit(c,a,id,remove?'access_revoked':'access_granted',pid);
          return {user,addedPoints:remove?0:changed.rowCount,addedNames:!remove&&changed.rowCount?[point.name]:[]};
        });
        const delivery=p.notify===false?'none':await notifyNewPoints(result.user,result.addedNames,req);
        reply(res,200,{ok:true,addedPoints:result.addedPoints,delivery});return true;
      }
      reply(res,404,{error:'API-Endpunkt nicht gefunden'});return true;
    }catch(e){
      if(e?.code==='23505')reply(res,409,{error:'Eintrag existiert bereits'});
      else if(e?.code==='23503')reply(res,400,{error:'Ungültige Datenverknüpfung'});
      else if(e?.status)reply(res,e.status,{error:e.message});
      else{console.error('ChargeVisor API:',e.code||e.message);reply(res,500,{error:'Interner Fehler'});}
      return true;
    }
  }
  return {handle,getActor,authorizeRolePreview,pool,ready:()=>!!pool,status:()=>status,close:async()=>pool?.end()};
}
