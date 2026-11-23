import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMonitorUrl,probeOnce,probeWithRetries,probeStationHealth} from './health-probe.mjs';

const url='https://chargevisor-business-demo.onrender.com/health';
const response=(data,status=200)=>({status,json:async()=>data});
test('Monitoring permits only credential-free /health and protects against HTTP/secret URLs',()=>{
  assert.equal(validateMonitorUrl(url),url);
  assert.equal(validateMonitorUrl('http://127.0.0.1:10000/health'),
    'http://127.0.0.1:10000/health');
  for(const invalid of [
    'http://example.com/health','https://host.invalid/health?token=secret',
    'https://user:password@host.invalid/health',
    'https://host.invalid/admin','file:///etc/passwd','nonsense'
  ])assert.throws(()=>validateMonitorUrl(invalid));
});
test('Demo mode and DB outage both fail health even when HTTP returns 200',async()=>{
  for(const data of [
    {status:'ok',mode:'demo',authReady:false},
    {status:'ok',mode:'auth',authReady:false},
    {status:'unavailable',mode:'auth',authReady:false}
  ]){
    assert.equal((await probeOnce(url,{fetcher:async()=>response(data)})).healthy,false);
  }
  assert.equal((await probeOnce(url,{fetcher:async()=>response({
    status:'ok',mode:'auth',authReady:true
  })})).healthy,true);
});
test('Temporary outage retries, persistent outage fails closed',async()=>{
  let count=0,delays=0;
  const result=await probeWithRetries(url,{
    attempts:3,delayMs:0,sleep:async()=>{delays++;},
    fetcher:async()=>{
      count++;
      return response({status:count>=3?'ok':'unavailable',
        mode:'auth',authReady:count>=3},count===2?503:200);
    }
  });
  assert.deepEqual({healthy:result.healthy,attempts:result.attempts},
    {healthy:true,attempts:3});
  assert.equal(delays,2);
  const down=await probeWithRetries(url,{attempts:2,delayMs:0,sleep:async()=>{},
    fetcher:async()=>{throw Error('No route');}});
  assert.equal(down.healthy,false);
  assert.equal(down.reason,'NETWORK_OR_RESPONSE_ERROR');
});

test('Operator token probes real station count and refuses zero, stale or disconnected chargers',async()=>{
  const token='o'.repeat(50);
  const seen=[];
  const fetcher=async(url,opts)=>{
    seen.push({url,authorization:opts.headers.Authorization});
    return response({status:'ok',stationCounts:{
      scanned:2,online:2,stale:0,disconnected:0
    }});
  };
  const ok=await probeStationHealth(url,token,{fetcher});
  assert.equal(ok.healthy,true);
  assert.ok(seen[0].url.endsWith('/api/ops/health'));
  assert.equal(seen[0].authorization,'Bearer '+token);
  assert.equal((await probeStationHealth(url,'invalid',{fetcher})).healthy,false);
  const stale=await probeStationHealth(url,token,{fetcher:async()=>response({
    status:'ok',stationCounts:{scanned:2,online:1,stale:1,disconnected:0}
  })});
  assert.deepEqual(stale,{healthy:false,reason:'STATIONS_DEGRADED'});
  const empty=await probeStationHealth(url,token,{fetcher:async()=>response({
    status:'ok',stationCounts:{scanned:0,online:0,stale:0,disconnected:0}
  })});
  assert.equal(empty.healthy,false);
  const denied=await probeStationHealth(url,token,{fetcher:async()=>response({},401)});
  assert.deepEqual(denied,{healthy:false,reason:'STATIONS_HTTP_401'});
});
