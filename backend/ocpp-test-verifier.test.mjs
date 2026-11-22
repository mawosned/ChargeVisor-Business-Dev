import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createOcppApi} from './ocpp.mjs';

const tenant='11111111-1111-4111-8111-111111111111';
const token='chargevisor-dev-only-very-long-test-token-'+('A'.repeat(40));
const env={
  CV_OCPP_VERIFIER_TENANT_ID:tenant,
  CV_OCPP_VERIFIER_SHA256:createHash('sha256').update(token).digest('hex'),
  CV_PUBLIC_URL:'http://localhost:10000'
};
const identity='TEST-CHARGER-001';

function makeApi({settings=env,pool}={}){
  return createOcppApi({
    pool:pool||{query:async()=>{throw Error('Database must not be accessed');}},
    getActor:async()=>{throw Error('Normal user auth must not be called on the test token path');},
    bridge:{},port:0,env:settings
  });
}
async function serve(api,fn){
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    api(req,res,path).catch(e=>{res.writeHead(500);res.end(e.message);});
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{return await fn('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}

test('Verifier defaults to 404 when no separately configured permanent credential exists',async()=>{
  await serve(makeApi({settings:{CV_PUBLIC_URL:env.CV_PUBLIC_URL}}),async base=>{
    const r=await fetch(base+'/api/ocpp/test-verification?identity='+identity,{
      headers:{Authorization:'Bearer '+token}
    });
    assert.equal(r.status,404);
    assert.equal(r.headers.get('cache-control'),'no-store');
  });
});

test('Permanent test-only token cannot write, guess another token or read another station',async()=>{
  let queries=0;
  const pool={async query(){queries++;return {rowCount:0,rows:[]};}};
  await serve(makeApi({pool}),async base=>{
    const url=base+'/api/ocpp/test-verification?identity='+identity;
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+'B'.repeat(64)}})).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token},method:'POST'})).status,405);
    assert.equal(queries,0,'Invalid credentials and writes never reach DB');
    assert.equal((await fetch(base+'/api/ocpp/test-verification?identity=../../other',{
      headers:{Authorization:'Bearer '+token}})).status,400);
    assert.equal(queries,0);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status,404);
    assert.equal(queries,1,'Unknown/non-test station is not visible');
  });
});

test('Authenticated read-only verifier returns only explicitly scoped simulated data',async()=>{
  const queries=[];
  const pool={async query(sql,args=[]){
    queries.push({sql,args});
    assert.equal(args[0],identity);
    assert.equal(args[1],tenant);
    if(sql.includes('FROM cv_ocpp_credentials c'))
      return {rowCount:1,rows:[{station_id:'22222222-2222-4222-8222-222222222222'}]};
    if(sql.includes('FROM cv_ocpp_live'))
      return {rowCount:1,rows:[{connected:true,status:'Charging',power_w:11040,simulated:true}]};
    if(sql.includes('FROM cv_ocpp_connector_live'))
      return {rowCount:1,rows:[{connector_id:1,status:'Charging',power_w:11040,error_code:'NoError'}]};
    if(sql.includes('FROM cv_ocpp_transactions'))
      return {rowCount:1,rows:[{id:42,connector_id:1,meter_start_wh:1000,meter_stop_wh:null}]};
    if(sql.includes('FROM cv_ocpp_events'))
      return {rowCount:1,rows:[{action:'StartTransaction',payload:{connectorId:1}}]};
    throw Error('Unexpected SQL');
  }};
  await serve(makeApi({pool}),async base=>{
    const r=await fetch(base+'/api/ocpp/test-verification?identity='+identity+'&limit=25',{
      headers:{Authorization:'Bearer '+token}
    });
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    const data=await r.json();
    assert.equal(data.identity,identity);
    assert.equal(data.live.connected,true);
    assert.equal(data.live.power_w,11040);
    assert.equal(data.connectors[0].status,'Charging');
    assert.equal(data.sessions[0].id,42);
    assert.equal(data.events[0].action,'StartTransaction');
    assert.ok(!('password_hash' in data));
    assert.ok(!('users' in data));
  });
  assert.equal(queries.length,5);
  for(const row of queries.slice(1)){
    assert.ok(row.sql.includes('simulated=true'),'No physical customer records');
    assert.deepEqual(row.args.slice(0,2),[identity,tenant]);
  }
});
