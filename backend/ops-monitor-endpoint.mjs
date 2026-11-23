// Credential-scoped machine-readable OCPP availability, no customer metadata.
// This is ONLY an optional read-only monitoring route, not a charging API.
// Token SHA-256 is configured separately and can be revoked by deleting it.
import {createHash,timingSafeEqual} from 'node:crypto';
import {readStationHealth} from './ops-station-health.mjs';
const json=(res,status,payload)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
};
export function createOpsMonitorEndpoint({pool,env}){
  const hash=String(env.CV_OPS_MONITOR_TOKEN_SHA256||'');
  const enabled=!!(pool&&/^[0-9a-f]{64}$/i.test(hash));
  const expected=enabled?Buffer.from(hash,'hex'):null;
  const minStations=Number(env.CV_OPS_EXPECT_STATIONS||0);
  if(enabled&&(!Number.isInteger(minStations)||minStations<0||minStations>2000))
    throw Error('Invalid CV_OPS_EXPECT_STATIONS');
  return async(req,res)=>{
    if(!enabled)return json(res,404,{error:'Operational monitoring not configured'});
    if(req.method!=='GET')return json(res,405,{error:'Read-only endpoint'});
    const value=String(req.headers.authorization||'');
    const token=value.startsWith('Bearer ')?value.slice(7):'';
    if(!/^[a-zA-Z0-9_-]{40,200}$/.test(token))
      return json(res,401,{error:'Unauthorized monitoring identity'});
    const got=createHash('sha256').update(token).digest();
    if(!timingSafeEqual(got,expected))
      return json(res,401,{error:'Unauthorized monitoring identity'});
    try{
      const report=await readStationHealth(pool);
      const degraded=report.disconnected>0||report.stale>0||
        report.scanned<minStations;
      return json(res,degraded?503:200,{
        status:degraded?'degraded':'ok',
        checkedAt:report.evaluatedAt,
        stationCounts:{
          scanned:report.scanned,online:report.online,
          disconnected:report.disconnected,stale:report.stale
        },
        // Open sessions are informative, not a failure by themselves.
        openUnconfirmedSessions:report.openUnconfirmedSessions,
        // No station names, IDs, customer data, RFID tokens or private URIs.
        estimatedHealthOnly:true
      });
    }catch(e){
      console.error('ChargeVisor ops monitor failure:',e.code||e.message);
      return json(res,503,{status:'degraded',error:'Monitor storage unavailable'});
    }
  };
}
