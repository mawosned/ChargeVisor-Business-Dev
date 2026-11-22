import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createStructureApi} from './structure.mjs';
import {verifyPassword} from './auth.mjs';

const TENANT='44444444-4444-4444-4444-444444444444';
const OTHER='99999999-9999-9999-9999-999999999999';
const SITE='33333333-3333-4333-8333-333333333333';
const env={CV_PUBLIC_URL:'https://chargevisor-business-demo.onrender.com'};
function makeRequest(method,path,body){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=path;
  req.headers={origin:env.CV_PUBLIC_URL,'content-type':'application/json'};
  return req;
}
function makeResponse(){
  return {
    status:null,payload:null,
    writeHead(status){this.status=status;},
    end(data){this.payload=data?JSON.parse(data):null;}
  };
}
function fakePool(fn){
  return {query:fn,connect:async()=>({
    query:fn,release(){}
  })};
}
async function call(role,path,method='GET',body,pool){
  const actor={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tenant_id:TENANT,role};
  const api=createStructureApi(env,{pool:pool||fakePool(async()=>{throw Error('Unexpected DB query');}),getActor:async()=>actor});
  const res=makeResponse();
  await api.handle(makeRequest(method,path,body),res,path.split('?')[0]);
  return res;
}
test('Normal users have no access to tenant management',async()=>{
  const r=await call('user','/api/structure/overview?tenantId='+TENANT);
  assert.equal(r.status,403);
});
test('Superadmin must specify a customer (no unscoped overview)',async()=>{
  const r=await call('superadmin','/api/structure/overview');
  assert.equal(r.status,400);
});
test('Customer admin cannot switch tenants through URL query',async()=>{
  const seen=[];
  const pool=fakePool(async(sql,params)=>{
    seen.push(params);
    if(sql.startsWith('SELECT id,name,status,licensed_points FROM cv_tenants'))
      return {rowCount:1,rows:[{id:TENANT,name:'Eigener Kunde',status:'active',licensed_points:2}]};
    return {rows:[],rowCount:0};
  });
  const res=await call('admin','/api/structure/overview?tenantId='+OTHER,'GET',undefined,pool);
  assert.equal(res.status,200);
  assert.equal(res.payload.tenant.id,TENANT);
  assert.equal(seen.length,5);
  for(const p of seen)assert.deepEqual(p,[TENANT]);
});
test('Duplicate physical connector identities are rejected before write',async()=>{
  const res=await call('superadmin','/api/structure/stations','POST',{
    tenantId:TENANT,siteId:SITE,name:'Ladeanlage',topology:'individual',
    pointSpecs:[{name:'A',ocppIdentity:'WAL-01'},{name:'B',ocppIdentity:'WAL-01'}]
  });
  assert.equal(res.status,409);
});
test('Inactive tenants cannot create a site',async()=>{
  const queries=[];
  const pool=fakePool(async(sql,params)=>{
    queries.push(sql);
    if(sql.startsWith('SELECT status FROM cv_tenants'))
      return {rowCount:1,rows:[{status:'pending'}]};
    return {rowCount:0,rows:[]};
  });
  const r=await call('superadmin','/api/structure/sites','POST',{tenantId:TENANT,name:'Tiefgarage',address:'München'},pool);
  assert.equal(r.status,403);
  assert.ok(queries.includes('ROLLBACK'));
});


test('Customer admin cannot create a new site',async()=>{
  const r=await call('admin','/api/structure/sites','POST',{name:'Unauthorized location'});
  assert.equal(r.status,403);
});
test('Customer admin cannot create stations or assign physical OCPP identities',async()=>{
  const r=await call('admin','/api/structure/stations','POST',{
    siteId:SITE,name:'Wallbox group',topology:'individual',
    pointSpecs:[{name:'Point A',ocppIdentity:'WAL-TEST-001'}]
  });
  assert.equal(r.status,403);
});
test('Customer admin cannot enable, disable or rename physical points',async()=>{
  const r=await call('admin','/api/structure/points/22222222-2222-4222-8222-222222222222',
    'PATCH',{enabled:false,name:'Hacked'});
  assert.equal(r.status,403);
});

test('Only Walectra can retrieve or rotate OCPP provisioning credentials',async()=>{
  const station='11111111-1111-4111-8111-111111111111';
  const get=await call('admin','/api/structure/stations/'+station+'/credentials?tenantId='+TENANT);
  const provision=await call('admin','/api/structure/stations/'+station+'/credentials/provision','POST',{tenantId:TENANT});
  const rotate=await call('admin','/api/structure/stations/'+station+'/credentials/CV-DEVICE001/rotate','POST',{tenantId:TENANT});
  assert.equal(get.status,403);
  assert.equal(provision.status,403);
  assert.equal(rotate.status,403);
});
function stationPool(status='active'){
  const inserted=[],calls=[];
  const pool=fakePool(async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT status FROM cv_tenants'))return {rowCount:1,rows:[{status}]};
    if(sql.startsWith('SELECT id FROM cv_sites'))return {rowCount:1,rows:[{id:SITE}]};
    if(sql.startsWith('SELECT COUNT(*)'))return {rowCount:1,rows:[{n:0}]};
    if(sql.startsWith('INSERT INTO cv_ocpp_credentials'))inserted.push(params);
    return {rowCount:1,rows:[]};
  });
  return {pool,inserted,calls};
}
test('Shared OCPP station provisions exactly one hashed credential for many connectors',async()=>{
  const {pool,inserted}=stationPool();
  const result=await call('superadmin','/api/structure/stations','POST',{
    tenantId:TENANT,siteId:SITE,name:'Master Slave Anlage',topology:'shared',
    pointSpecs:[{name:'Stellplatz 1'},{name:'Stellplatz 2'}]
  },pool);
  assert.equal(result.status,201);
  assert.equal(result.payload.points.length,2);
  assert.equal(result.payload.credentials.length,1);
  assert.equal(inserted.length,1);
  const secret=result.payload.credentials[0];
  assert.match(secret.identity,/^cv[0-9a-hjkmnp-tv-z]{8}$/);
  assert.match(secret.password,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
  assert.equal(secret.password.length,16);
  assert.equal(secret.identity,secret.username);
  assert.equal(secret.identity,result.payload.points[0].ocppIdentity);
  assert.equal(secret.identity,result.payload.points[1].ocppIdentity);
  assert.equal(result.payload.points[0].connectorNumber,1);
  assert.equal(result.payload.points[1].connectorNumber,2);
  assert.equal(secret.wssUrl,null);
  assert.equal(result.payload.connectionReady,false);
  assert.notEqual(inserted[0][3],secret.password);
  assert.ok(await verifyPassword(secret.password,inserted[0][3]));
});
test('Individual wallboxes get separate unique OCPP credentials',async()=>{
  const {pool,inserted}=stationPool();
  const result=await call('superadmin','/api/structure/stations','POST',{
    tenantId:TENANT,siteId:SITE,name:'Separate Wallboxen',topology:'individual',
    pointSpecs:[{name:'Stellplatz A'},{name:'Stellplatz B'}]
  },pool);
  assert.equal(result.status,201);
  assert.equal(result.payload.credentials.length,2);
  assert.equal(new Set(result.payload.credentials.map(x=>x.identity)).size,2);
  assert.equal(inserted.length,2);
  for(let i=0;i<2;i++){
    assert.equal(result.payload.points[i].connectorNumber,1);
    assert.match(result.payload.credentials[i].password,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    assert.ok(await verifyPassword(result.payload.credentials[i].password,inserted[i][3]));
  }
});
test('OCPP credential listing never returns password or password hash',async()=>{
  const station='11111111-1111-4111-8111-111111111111';
  const pool=fakePool(async(sql)=>{
    if(sql.startsWith('SELECT id,topology FROM cv_stations'))return {rowCount:1,rows:[{id:station,topology:'shared'}]};
    if(sql.startsWith('SELECT identity,created_at'))return {rowCount:1,rows:[{
      identity:'CV-DEVICE-TEST',created_at:'2026-11-19T11:11:00.000Z',
      password_hash:'PRIVATE',rotated_at:null,last_connected_at:null
    }]};
    throw Error('Unexpected query: '+sql);
  });
  const r=await call('superadmin','/api/structure/stations/'+station+'/credentials?tenantId='+TENANT,'GET',undefined,pool);
  assert.equal(r.status,200);
  assert.equal(r.payload.credentials[0].identity,'CV-DEVICE-TEST');
  assert.equal(r.payload.credentials[0].wssUrl,null);
  assert.ok(!JSON.stringify(r.payload).includes('PRIVATE'));
  assert.ok(!JSON.stringify(r.payload).includes('password_hash'));
});

test('Walectra provisions chargepoints without a purchased point quota',async()=>{
  const {pool,calls}=stationPool('active');
  const result=await call('superadmin','/api/structure/stations','POST',{
    tenantId:TENANT,siteId:SITE,name:'Anlage ohne Lizenzgrenze',topology:'shared',
    pointSpecs:[{name:'Ladepunkt A'},{name:'Ladepunkt B'},{name:'Ladepunkt C'}]
  },pool);
  assert.equal(result.status,201);
  assert.equal(result.payload.points.length,3);
  assert.ok(!calls.some(x=>x.sql.includes('licensed_points')));
});
test('Customer admin cannot edit the complete location address',async()=>{
  const r=await call('admin','/api/structure/sites/'+SITE,'PATCH',{
    name:'Falsche Adresse',street:'Falschweg',houseNumber:'1',postalCode:'10000',city:'Berlin',country:'Deutschland'
  });
  assert.equal(r.status,403);
});

test('OCPP password reset generates a short readable password and stores only a hash',async()=>{
  const station='11111111-1111-4111-8111-111111111111';
  const identity='cv12345678';let hash='';
  const pool=fakePool(async(sql,params=[])=>{
    if(sql.startsWith('UPDATE cv_ocpp_credentials SET password_hash=')){
      hash=params[0];return {rowCount:1,rows:[{identity}]};
    }
    return {rowCount:1,rows:[]};
  });
  const r=await call('superadmin',
    '/api/structure/stations/'+station+'/credentials/'+identity+'/rotate',
    'POST',{tenantId:TENANT},pool);
  assert.equal(r.status,200);
  assert.equal(r.payload.identity,identity);
  assert.match(r.payload.password,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
  assert.notEqual(hash,r.payload.password);
  assert.ok(await verifyPassword(r.payload.password,hash));
});
