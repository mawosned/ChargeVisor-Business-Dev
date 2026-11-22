import {createHash,timingSafeEqual} from 'node:crypto';

// Read-only evidence API for explicitly simulator-designated charge stations.
// Never returns customer transactions, RFID UIDs, auth data or wallbox passwords.
// No token expiry: the operator can revoke access by removing/rotating the hash.
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const identity=value=>typeof value==='string'&&/^[\w.:-]{2,120}$/.test(value);
const json=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};
export function createOcppTestVerifier({pool,env}){
  const tenant=env.CV_OCPP_VERIFIER_TENANT_ID||'';
  const key=env.CV_OCPP_VERIFIER_SHA256||'';
  const enabled=!!(pool&&uuid(tenant)&&/^[0-9a-f]{64}$/i.test(key));
  const expected=enabled?Buffer.from(key,'hex'):null;
  return async function handle(req,res){
    if(!enabled)return json(res,404,{error:'Test-Verifikation deaktiviert'});
    if(req.method!=='GET')return json(res,405,{error:'Nur lesender Zugriff erlaubt'});
    const auth=String(req.headers.authorization||'');
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!/^[\w-]{40,200}$/.test(token))return json(res,401,{error:'Test-Verifikation nicht autorisiert'});
    const digest=createHash('sha256').update(token).digest();
    if(!timingSafeEqual(digest,expected))
      return json(res,401,{error:'Test-Verifikation nicht autorisiert'});
    const url=new URL(req.url,'http://localhost');
    const cp=url.searchParams.get('identity');
    if(!identity(cp))return json(res,400,{error:'Test-OCPP-Identität fehlt'});
    const n=Number(url.searchParams.get('limit')||50);
    if(!Number.isInteger(n)||n<1||n>100)
      return json(res,400,{error:'limit muss zwischen 1 und 100 liegen'});
    try{
      const station=await pool.query(
        'SELECT c.station_id FROM cv_ocpp_credentials c '+
        'JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id '+
        "JOIN cv_tenants t ON t.id=c.tenant_id AND t.status='active' AND t.deleted_at IS NULL "+
        'WHERE c.identity=$1 AND c.tenant_id=$2 AND s.is_simulator=true',
        [cp,tenant]);
      if(!station.rowCount)return json(res,404,{error:'Teststation nicht gefunden'});
      const [live,connectors,sessions,events]=await Promise.all([
        pool.query(
          'SELECT connected,status,action,energy_wh,power_w,last_seen,simulated '+
          'FROM cv_ocpp_live WHERE identity=$1 AND tenant_id=$2 AND simulated=true',
          [cp,tenant]),
        pool.query(
          'SELECT connector_id,status,error_code,error_info,energy_wh,power_w, '+
          'last_seen,status_changed_at,power_updated_at FROM cv_ocpp_connector_live '+
          'WHERE identity=$1 AND tenant_id=$2 AND simulated=true ORDER BY connector_id',
          [cp,tenant]),
        pool.query(
          'SELECT id,connector_id,meter_start_wh,meter_stop_wh,started_at,stopped_at '+
          'FROM cv_ocpp_transactions WHERE identity=$1 AND tenant_id=$2 AND simulated=true '+
          'ORDER BY started_at DESC,id DESC LIMIT $3',
          [cp,tenant,n]),
        pool.query(
          'SELECT action,payload,created_at FROM cv_ocpp_events '+
          'WHERE identity=$1 AND tenant_id=$2 AND simulated=true '+
          'ORDER BY created_at DESC,id DESC LIMIT $3',
          [cp,tenant,n])
      ]);
      return json(res,200,{
        identity:cp,observed_at:new Date().toISOString(),
        live:live.rows[0]||null,
        connectors:connectors.rows,
        sessions:sessions.rows,
        events:events.rows
      });
    }catch(e){
      console.error('OCPP test verifier read error:',e.code||e.message);
      return json(res,503,{error:'Test-Verifikation nicht verfügbar'});
    }
  };
}
