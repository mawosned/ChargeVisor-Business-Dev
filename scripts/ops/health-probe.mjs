// Independent HTTP availability probe. Run OUTSIDE the ChargeVisor process.
// A 200 /health in "demo" mode is NOT operationally healthy.
// Never pass credentials, API tokens or client identifiers in the URL.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function validateMonitorUrl(value){
  let u;
  try{u=new URL(value);}catch{throw Error('Invalid monitor URL');}
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if((u.protocol!=='https:'&&!local)||u.username||u.password||
     u.search||u.hash||u.pathname!=='/health')
    throw Error('Monitor requires credential-free https://.../health (or local test HTTP)');
  return u.toString();
}
export async function probeOnce(url,{fetcher=globalThis.fetch,timeoutMs=30_000}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetcher(url,{
      method:'GET',signal:controller.signal,redirect:'error',
      headers:{Accept:'application/json'},cache:'no-store'
    });
    if(res.status!==200)return {healthy:false,reason:'HTTP_'+res.status};
    const data=await res.json();
    if(!data||data.status!=='ok'||data.authReady!==true||data.mode!=='auth')
      return {healthy:false,reason:'NOT_AUTH_READY'};
    return {healthy:true,reason:'READY'};
  }catch(e){
    return {healthy:false,reason:e.name==='AbortError'?'TIMEOUT':'NETWORK_OR_RESPONSE_ERROR'};
  }finally{clearTimeout(timeout);}
}
export async function probeWithRetries(url,{fetcher=globalThis.fetch,
  attempts=3,delayMs=10_000,timeoutMs=30_000,sleep=(ms)=>new Promise(r=>setTimeout(r,ms))}={}){
  if(!Number.isInteger(attempts)||attempts<1||attempts>6)throw Error('Invalid retry count');
  const checkedUrl=validateMonitorUrl(url);
  let result={healthy:false,reason:'NOT_CHECKED'};
  for(let n=1;n<=attempts;n++){
    result=await probeOnce(checkedUrl,{fetcher,timeoutMs});
    if(result.healthy)return {...result,attempts:n};
    if(n<attempts)await sleep(delayMs);
  }
  return {...result,attempts};
}
export async function probeStationHealth(url,token,{fetcher=globalThis.fetch,timeoutMs=30_000}={}){
  const healthUrl=validateMonitorUrl(url);
  if(!/^[a-zA-Z0-9_-]{40,200}$/.test(token||''))
    return {healthy:false,reason:'OPS_MONITOR_TOKEN_MISSING'};
  const endpoint=new URL('/api/ops/health',healthUrl).toString();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetcher(endpoint,{method:'GET',
      signal:controller.signal,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
    if(response.status!==200)return {healthy:false,reason:'STATIONS_HTTP_'+response.status};
    const body=await response.json();
    if(body?.status!=='ok'||!body.stationCounts||
       !Number.isInteger(body.stationCounts.scanned)||
       !Number.isInteger(body.stationCounts.online)||
       body.stationCounts.stale!==0||body.stationCounts.disconnected!==0)
      return {healthy:false,reason:'STATIONS_DEGRADED'};
    return {healthy:true,reason:'STATIONS_OK'};
  }catch(e){
    return {healthy:false,reason:e.name==='AbortError'?'STATIONS_TIMEOUT':'STATIONS_NETWORK_ERROR'};
  }finally{clearTimeout(timeout);}
}
async function main(){
  const url=process.env.CV_MONITOR_TARGET_URL||'';
  const result=await probeWithRetries(url);
  let stations={healthy:true,reason:'STATIONS_NOT_CONFIGURED'};
  if(process.env.CV_MONITOR_REQUIRE_OPS==='1'){
    stations=await probeStationHealth(url,process.env.CV_MONITOR_TOKEN||'');
    if(!stations.healthy){
      // Short transient retries for station monitoring, without changing data.
      for(let n=0;n<2&&!stations.healthy;n++){
        await new Promise(resolve=>setTimeout(resolve,10_000));
        stations=await probeStationHealth(url,process.env.CV_MONITOR_TOKEN||'');
      }
    }
  }
  const healthy=result.healthy&&stations.healthy;
  console.log(JSON.stringify({time:new Date().toISOString(),status:healthy?'PASS':'FAIL',
    attempts:result.attempts,reason:!result.healthy?result.reason:stations.reason}));
  if(!healthy)process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(e=>{console.error('Monitor configuration failure:',e.message);process.exitCode=1;});
}
