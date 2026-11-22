import test from 'node:test';
import assert from 'node:assert/strict';
import {createOcppApi} from './ocpp.mjs';

// Regression guards for EXISTING read-only APIs. These tests intentionally
// require neither live database credentials nor an external ChargeVisor server.
const TENANT_A='11111111-1111-4111-8111-111111111111';
const TENANT_B='22222222-2222-4222-8222-222222222222';
const USER='33333333-3333-4333-8333-333333333333';
const ENV={CV_PUBLIC_URL:'https://chargevisor-business-demo.onrender.com'};

function request(url,method='GET'){
  return {url,method,headers:{origin:ENV.CV_PUBLIC_URL}};
}
function response(){
  return {
    code:null,body:null,headers:null,
    writeHead(code,headers){this.code=code;this.headers=headers;},
    end(payload){this.body=payload?JSON.parse(payload):null;}
  };
}
async function invoke({actor,path,url=path,pool={query:async()=>({rows:[]})},bridge={}}){
  const getActor=async()=>actor;
  const api=createOcppApi({pool,getActor,bridge,port:0,env:ENV});
  const res=response();
  await api(request(url),res,path);
  return res;
}

test('OCPP live requires authenticated user; do not leak data to guests',async()=>{
  const res=await invoke({actor:null,path:'/api/ocpp/live'});
  assert.equal(res.code,401);
  assert.equal(res.body?.error,'Nicht angemeldet');
});

test('Superadmin live API requires an explicit tenant (no unscoped read)',async()=>{
  const res=await invoke({actor:{role:'superadmin'},path:'/api/ocpp/live'});
  assert.equal(res.code,400);
  assert.equal(res.body?.error,'Kunde auswählen');
});

test('Admin live reads stay within own tenant even with a forged tenantId',async()=>{
  const queries=[];
  const pool={async query(sql,params){
    queries.push({sql,params});
    if(sql.includes('FROM cv_ocpp_live'))return {rows:[{
      identity:'CP-A',station_id:'S-A',connected:true,status:'Available'
    }]};
    if(sql.includes('FROM cv_ocpp_connector_live'))return {rows:[{
      identity:'CP-A',connector_id:1,status:'Available',error_code:'NoError',
      power_w:11040,energy_wh:12345
    }]};
    if(sql.includes('FROM cv_ocpp_transactions'))return {rows:[]};
    throw new Error('Unexpected read: '+sql.slice(0,120));
  }};
  const res=await invoke({
    actor:{role:'admin',tenant_id:TENANT_A},
    path:'/api/ocpp/live',
    url:'/api/ocpp/live?tenantId='+TENANT_B,
    pool
  });
  assert.equal(res.code,200);
  assert.equal(queries.length,3);
  for(const query of queries){
    assert.equal(query.params[0],TENANT_A,'tenant must come from actor, not URL');
    assert.ok(!query.params.includes(TENANT_B),'foreign tenant parameter forbidden');
  }
  assert.equal(res.body.live[0].connected,true);
  assert.equal(res.body.connectors[0].power_w,11040);
});

test('User live response never exposes raw OCPP identities or master action',async()=>{
  const pool={async query(sql,params){
    assert.equal(params[0],TENANT_A);
    if(sql.includes('FROM cv_ocpp_live'))return {rows:[{
      identity:'SECRET-CP-ID',point_id:'P-A',status:'Available',action:'MeterValues',
      energy_wh:45,power_w:3000,connected:true,station_id:'S-A'
    }]};
    if(sql.includes('FROM cv_ocpp_connector_live'))return {rows:[{
      identity:'SECRET-CP-ID',point_id:'P-A',connector_id:1,
      status:'Charging',energy_wh:45,power_w:3000
    }]};
    if(sql.includes('FROM cv_ocpp_transactions'))return {rows:[{
      point_id:'P-A',remote_paused:false
    }]};
    throw new Error('Unexpected read');
  }};
  const res=await invoke({
    actor:{role:'user',tenant_id:TENANT_A,id:USER},
    path:'/api/ocpp/live',pool
  });
  assert.equal(res.code,200);
  assert.ok(res.body.live.length>0);
  assert.equal('identity' in res.body.live[0],false);
  assert.equal('identity' in res.body.connectors[0],false);
  assert.equal('action' in res.body.live[0],false);
  assert.equal(res.body.connectors[0].status,'Charging');
});

test('Physical charging session history is scoped to logged-in tenant',async()=>{
  let observedTenant=null;
  const bridge={physical:{async history(actor,tenantId,filters){
    observedTenant=tenantId;
    assert.equal(actor.role,'admin');
    assert.equal(filters.siteId,'44444444-4444-4444-8444-444444444444');
    return [{id:123,connector_id:1,energy_wh:500}];
  }}};
  const res=await invoke({
    actor:{role:'admin',tenant_id:TENANT_A},
    path:'/api/ocpp/sessions',
    url:'/api/ocpp/sessions?tenantId='+TENANT_B+
      '&siteId=44444444-4444-4444-8444-444444444444',
    bridge
  });
  assert.equal(res.code,200);
  assert.equal(observedTenant,TENANT_A);
  assert.equal(res.body.sessions[0].id,123);
});
