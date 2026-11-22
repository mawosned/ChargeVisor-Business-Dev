// Microsoft Graph delegated Mail.Send; never requests application-wide mail permissions.
// Requires a separate ChargeVisor Postgres DB and an authenticated superadmin.
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
const SCOPE='offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send';
const STATE_TTL_MIN=10;
const sha=v=>createHash('sha256').update(v).digest('hex');
const base=(env)=>env.CV_PUBLIC_URL?.replace(/\/$/,'');
const redirect=(env)=>base(env)+'/api/microsoft/callback';
const text=(v)=>typeof v==='string'?v.trim():'';
const email=(v)=>text(v).toLowerCase();
const configured=(env)=>Boolean(base(env)?.startsWith('https://') &&
  /^[0-9a-f-]{36}$/i.test(env.CV_MS_TENANT_ID||'') &&
  /^[0-9a-f-]{36}$/i.test(env.CV_MS_CLIENT_ID||'') &&
  env.CV_MS_CLIENT_SECRET && env.CV_MS_ALLOWED_SENDER && keyFromEnv(env));
function keyFromEnv(env){
  if(!env.CV_MS_ENCRYPTION_KEY)return null;
  try{const k=Buffer.from(env.CV_MS_ENCRYPTION_KEY,'base64');return k.length===32?k:null;}
  catch{return null;}
}
export function encrypt(value,key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Encryption key not configured');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  const ct=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),ct]).toString('base64url');
}
export function decrypt(value,key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Encryption key not configured');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length<29)throw Error('Encrypted data invalid');
  const nonce=bytes.subarray(0,12),tag=bytes.subarray(12,28);
  const d=createDecipheriv('aes-256-gcm',key,nonce);d.setAuthTag(tag);
  return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');
}
const tokenEndpoint=env=>'https://login.microsoftonline.com/'+env.CV_MS_TENANT_ID+'/oauth2/v2.0/token';
async function exchange(env,body){
  const request=new URLSearchParams({client_id:env.CV_MS_CLIENT_ID,client_secret:env.CV_MS_CLIENT_SECRET,...body});
  const r=await fetch(tokenEndpoint(env),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:request,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Microsoft OAuth token request failed (HTTP '+r.status+')');
  const data=await r.json();
  if(!data.access_token)throw Error('Microsoft access token missing');
  return data;
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function go(res,url){
  res.writeHead(302,{'Location':url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  res.end();
}
export function createMicrosoftApi(env,{pool,getActor}){
  async function handle(req,res,path){
    if(!path.startsWith('/api/microsoft/'))return false;
    const isConnect=path==='/api/microsoft/connect'&&req.method==='GET';
    const isCallback=path==='/api/microsoft/callback'&&req.method==='GET';
    const isStatus=path==='/api/microsoft/status'&&req.method==='GET';
    const isDisconnect=path==='/api/microsoft/disconnect'&&req.method==='POST';
    if(!isConnect&&!isCallback&&!isStatus&&!isDisconnect){json(res,404,{error:'Not found'});return true;}
    if(!pool||!configured(env)){
      if(isCallback)go(res,'/login?mail=not-ready');
      else json(res,503,{error:'Microsoft-Verbindung noch nicht eingerichtet'});
      return true;
    }
    try{
      const actor=await getActor(req);
      if(!actor||actor.role!=='superadmin') {
        if(isCallback)go(res,'/login?mail=unauthorized');
        else json(res,403,{error:'Nur Walectra Superadmin'});
        return true;
      }
      if(isStatus){
        const r=await pool.query('SELECT email,connected_at FROM cv_ms_mail_accounts WHERE id=1');
        json(res,200,{configured:true,connected:!!r.rowCount,
          account:r.rows[0]?.email||null,connectedAt:r.rows[0]?.connected_at||null});
        return true;
      }
      if(isConnect){
        const state=randomBytes(32).toString('base64url');
        const verifier=randomBytes(32).toString('base64url');
        const challenge=createHash('sha256').update(verifier).digest('base64url');
        await pool.query('DELETE FROM cv_ms_oauth_states WHERE expires_at < now()');
        await pool.query("INSERT INTO cv_ms_oauth_states(state_hash,user_id,verifier_cipher,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
          [sha(state),actor.id,encrypt(verifier,keyFromEnv(env))]);
        const params=new URLSearchParams({
          client_id:env.CV_MS_CLIENT_ID,response_type:'code',redirect_uri:redirect(env),
          response_mode:'query',scope:SCOPE,state,
          code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'
        });
        go(res,'https://login.microsoftonline.com/'+env.CV_MS_TENANT_ID+'/oauth2/v2.0/authorize?'+params);
        return true;
      }
      if(isCallback){
        const params=new URL(req.url,'http://localhost').searchParams;
        const state=params.get('state'),code=params.get('code');
        if(!state||!/^[A-Za-z0-9_-]{40,100}$/.test(state)||!code||code.length>4096){
          go(res,'/login?mail=failed');return true;
        }
        const r=await pool.query('DELETE FROM cv_ms_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING verifier_cipher',
          [sha(state),actor.id]);
        if(!r.rowCount){go(res,'/login?mail=failed');return true;}
        const verifier=decrypt(r.rows[0].verifier_cipher,keyFromEnv(env));
        const tokens=await exchange(env,{
          grant_type:'authorization_code',code,redirect_uri:redirect(env),code_verifier:verifier
        });
        if(!tokens.refresh_token)throw Error('No refresh token granted; offline_access required');
        const meResponse=await fetch('https://graph.microsoft.com/v1.0/me',{
          headers:{Authorization:'Bearer '+tokens.access_token},
          signal:AbortSignal.timeout(12000)
        });
        if(!meResponse.ok)throw Error('Microsoft Graph user verification failed');
        const me=await meResponse.json();
        const allowed=email(env.CV_MS_ALLOWED_SENDER);
        if(!me.id||![email(me.userPrincipalName),email(me.mail)].includes(allowed))
          throw Error('Connected Microsoft account does not match allowed sender');
        await pool.query(
          'INSERT INTO cv_ms_mail_accounts(id,microsoft_user_id,email,refresh_token_cipher,connected_by) VALUES(1,$1,$2,$3,$4) '+
          'ON CONFLICT(id) DO UPDATE SET microsoft_user_id=EXCLUDED.microsoft_user_id,email=EXCLUDED.email,refresh_token_cipher=EXCLUDED.refresh_token_cipher,connected_by=EXCLUDED.connected_by,updated_at=now()',
          [me.id,allowed,encrypt(tokens.refresh_token,keyFromEnv(env)),actor.id]);
        go(res,'/login?mail=connected');return true;
      }
      if(isDisconnect){
        if(req.headers.origin!==base(env)){json(res,403,{error:'Ungültige Anfragequelle'});return true;}
        const r=await pool.query('DELETE FROM cv_ms_mail_accounts WHERE id=1');
        json(res,200,{disconnected:!!r.rowCount});return true;
      }
    }catch(err){
      // Never log authorization codes, access tokens, refresh tokens or client secrets.
      console.error('Microsoft integration error:',err.message);
      if(isCallback)go(res,'/login?mail=failed');
      else json(res,502,{error:'Microsoft-Verbindung fehlgeschlagen'});
    }
    return true;
  }
  return {handle};
}
export async function sendMicrosoftMail(env,pool,{to,subject,body,attachments=[]}){
  if(!pool||!configured(env))return {sent:false,reason:'not_configured'};
  const r=await pool.query('SELECT refresh_token_cipher FROM cv_ms_mail_accounts WHERE id=1');
  if(!r.rowCount)return {sent:false,reason:'not_connected'};
  const refresh=decrypt(r.rows[0].refresh_token_cipher,keyFromEnv(env));
  const tokens=await exchange(env,{grant_type:'refresh_token',refresh_token:refresh,scope:SCOPE});
  if(tokens.refresh_token){
    await pool.query('UPDATE cv_ms_mail_accounts SET refresh_token_cipher=$1,updated_at=now() WHERE id=1',
      [encrypt(tokens.refresh_token,keyFromEnv(env))]);
  }
  const files=attachments.map(a=>{
    if(!a?.name||!Buffer.isBuffer(a.data)||a.data.length>2.8*1024*1024)throw Error('Attachment must be a file < 2.8 MB');
    return {'@odata.type':'#microsoft.graph.fileAttachment',name:a.name,contentType:a.contentType||'application/pdf',contentBytes:a.data.toString('base64')};
  });
  const payload={message:{subject,body:{contentType:'Text',content:body},
    toRecipients:[{emailAddress:{address:to}}],attachments:files},saveToSentItems:true};
  const response=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{
    method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
  });
  if(response.status!==202)throw Error('Microsoft Graph sendMail failed: HTTP '+response.status);
  return {sent:true};
}
