import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOpsMonitorEndpoint} from './ops-monitor-endpoint.mjs';
const token='V1-health-monitor-test-credential-'+('A'.repeat(45));
const hash=createHash('sha256').update(token).digest('hex');
const physical=()=>({
  async query(sql){
    if(sql.includes('FROM cv_ocpp_credentials c'))
      return {rows:[{identity:'DO-NOT-LEAK',tenant_id:'t',station_id:'s',
        tenant_name:'PRIVATE CUSTOMER NAME',station_name:'PRIVATE GARAGE',
        connected:true,last_seen:new Date().toISOString()}]};
    if(sql.includes('FROM cv_ocpp_transactions'))
      return {rows:[{identity:'DO-NOT-LEAK',open_count:1}]};
    throw Error('Unexpected query');
  }
});
async function run(api,auth,method='GET'){
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},
    end(body){this.data=JSON.parse(body);}};
  await api({method,headers:{authorization:auth}},res);
  return res;
}
test('Machine monitor defaults OFF and has no DB access without configured hash',async()=>{
  let touched=false;
  const api=createOpsMonitorEndpoint({pool:{async query(){touched=true;}},env:{}});
  const out=await run(api,'Bearer '+token);
  assert.equal(out.status,404);
  assert.equal(touched,false);
});
test('External monitoring rejects writes and invalid or guessed bearer before querying DB',async()=>{
  let queries=0;
  const pool={async query(){queries++;throw Error('No DB for unauthorized');}};
  const api=createOpsMonitorEndpoint({
    pool,env:{CV_OPS_MONITOR_TOKEN_SHA256:hash,CV_OPS_EXPECT_STATIONS:'1'}});
  assert.equal((await run(api,'')).status,401);
  assert.equal((await run(api,'Bearer '+('B'.repeat(60)))).status,401);
  assert.equal((await run(api,'Bearer '+token,'POST')).status,405);
  assert.equal(queries,0);
});
test('Authenticated monitor gives counts, not customer identities, with no-store headers',async()=>{
  const api=createOpsMonitorEndpoint({
    pool:physical(),env:{CV_OPS_MONITOR_TOKEN_SHA256:hash,CV_OPS_EXPECT_STATIONS:'1'}});
  const out=await run(api,'Bearer '+token);
  assert.equal(out.status,200);
  assert.equal(out.data.status,'ok');
  assert.equal(out.data.stationCounts.online,1);
  assert.equal(out.data.openUnconfirmedSessions,1);
  assert.equal(out.headers['Cache-Control'],'no-store');
  const body=JSON.stringify(out.data);
  assert.ok(!body.includes('PRIVATE'));
  assert.ok(!body.includes('DO-NOT-LEAK'));
});
test('Missing expected station or stale heartbeat returns degraded HTTP 503, never false OK',async()=>{
  const pool={async query(sql){
    if(sql.includes('FROM cv_ocpp_credentials c'))return {rows:[]};
    return {rows:[]};
  }};
  const api=createOpsMonitorEndpoint({
    pool,env:{CV_OPS_MONITOR_TOKEN_SHA256:hash,CV_OPS_EXPECT_STATIONS:'2'}});
  const out=await run(api,'Bearer '+token);
  assert.equal(out.status,503);
  assert.equal(out.data.status,'degraded');
});
