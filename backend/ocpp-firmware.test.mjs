import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirmwareManager} from './ocpp-firmware.mjs';
import {createOcppApi} from './ocpp.mjs';
import {WebSocket} from 'ws';

const TENANT='11111111-1111-4111-8111-111111111111';
const STATION='22222222-2222-4222-8222-222222222222';
const ACTOR='33333333-3333-4333-8333-333333333333';
const ID='CV-FW-PHYSICAL-01';
const firmwareURL='https://updates.example.com/lumina/v2.0.0.bin';
const release={id:'lumina-2',vendor:'Enelion',model:'Lumina',
  version:'2.0.0',location:firmwareURL,sha256:'a'.repeat(64)};
const actor={role:'superadmin',id:ACTOR,tenant_id:null};
const config={
  CV_FIRMWARE_UPDATES_ENABLED:'1',
  CV_FIRMWARE_ALLOWED_IDENTITIES:ID,
  CV_FIRMWARE_ALLOWED_HOSTS:'updates.example.com',
  CV_FIRMWARE_CATALOG_JSON:JSON.stringify([release])
};
function fixture({overrides={},activeTx=false,connected=true,model='Lumina',statuses=['Available']}={}){
  const calls=[],jobs=[];
  const pool={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('FROM cv_ocpp_credentials c')&&sql.includes('l.vendor'))
      return {rowCount:1,rows:[{
        identity:ID,tenant_id:TENANT,station_id:STATION,is_simulator:false,
        connected,vendor:'Enelion',model,firmware:'1.0.0'
      }]};
    if(sql.includes('FROM cv_ocpp_transactions'))
      return {rowCount:activeTx?1:0,rows:activeTx?[{id:8}]:[]};
    if(sql.includes('FROM cv_ocpp_connector_live'))
      return {rowCount:statuses.length,rows:statuses.map((status,i)=>({
        connector_id:i+1,status
      }))};
    if(sql.startsWith('INSERT INTO cv_ocpp_firmware_jobs')){
      jobs.push({id:args[0],status:args[9],identity:args[3],releaseId:args[4]});
      return {rowCount:1,rows:[]};
    }
    if(sql.startsWith('UPDATE cv_ocpp_firmware_jobs')){
      if(jobs[0])jobs[0].status=args[1]||args[2];
      return {rowCount:1,rows:[]};
    }
    if(sql.includes('SELECT id,status FROM cv_ocpp_firmware_jobs'))
      return {rowCount:jobs.length,rows:jobs.map(j=>({id:j.id,status:j.status}))};
    if(sql.includes('SELECT id,identity,release_id,target_version,status'))
      return {rowCount:jobs.length,rows:jobs.map(j=>({id:j.id,status:j.status}))};
    throw Error('Unexpected firmware query: '+sql.slice(0,180));
  }};
  const sent=[];
  const ctx={identity:ID,tenantId:TENANT,stationId:STATION,simulated:false,
    ws:{readyState:WebSocket.OPEN}};
  const active=new Map([[ID,ctx]]);
  const manager=createFirmwareManager({
    pool,env:{...config,...overrides},active,
    async sendCommand(target,action,payload,options){
      sent.push({action,payload,options,target});
      return {ok:true,response:{}};
    },
    async event(){}
  });
  return {manager,pool,calls,jobs,ctx,sent};
}

test('Firmware V1 disabled by default, invalid catalog and non-HTTPS hosts fail closed',async()=>{
  const manager=createFirmwareManager({
    pool:{},env:{},active:new Map(),sendCommand:async()=>{},event:async()=>{}
  });
  assert.equal((await manager.request({
    actor,tenantId:TENANT,identity:ID,releaseId:'lumina-2',confirm:'INSTALL_FIRMWARE'
  })).code,404);
  assert.throws(()=>fixture({overrides:{
    CV_FIRMWARE_CATALOG_JSON:JSON.stringify([{...release,location:'http://updates.example.com/fw'}])
  }}),/HTTPS/);
  assert.throws(()=>fixture({overrides:{
    CV_FIRMWARE_CATALOG_JSON:JSON.stringify([{...release,location:'https://evil.example/fw'}])
  }}),/HTTPS/);
});

test('Updates require superadmin, explicit confirmation, matching vendor/model, no active session and safe connector status',async()=>{
  for(const [changes,expected] of [
    [{},202],
    [{model:'Different'},409],
    [{connected:false},409],
    [{activeTx:true},409],
    [{statuses:['Charging']},409],
    [{statuses:['SuspendedEVSE']},409],
    [{statuses:[]},409],
    [{overrides:{CV_FIRMWARE_ALLOWED_IDENTITIES:'other-station'}},403]
  ]){
    const {manager,sent}=fixture(changes);
    const data=await manager.request({
      actor,tenantId:TENANT,identity:ID,releaseId:'lumina-2',confirm:'INSTALL_FIRMWARE'
    });
    assert.equal(data.code,expected,JSON.stringify(changes));
    assert.equal(sent.length,expected===202?1:0,'No firmware command on blocked station');
  }
  const {manager,sent}=fixture();
  assert.equal((await manager.request({
    actor:{role:'admin',id:ACTOR},tenantId:TENANT,identity:ID,releaseId:'lumina-2',
    confirm:'INSTALL_FIRMWARE'
  })).code,403);
  assert.equal((await manager.request({
    actor,tenantId:TENANT,identity:ID,releaseId:'lumina-2',confirm:'YES'
  })).code,400);
  assert.equal(sent.length,0);
});

test('Accepted firmware command is only a job ACK; it is not installation success',async()=>{
  const {manager,sent,jobs,ctx,calls}=fixture();
  const result=await manager.request({
    actor,tenantId:TENANT,identity:ID,releaseId:'lumina-2',confirm:'INSTALL_FIRMWARE'
  });
  assert.equal(result.code,202);
  assert.equal(result.status,'accepted');
  assert.match(result.note,/noch nicht verifiziert/);
  assert.equal(sent.length,1);
  assert.equal(sent[0].action,'UpdateFirmware');
  assert.equal(sent[0].payload.location,firmwareURL);
  assert.equal(sent[0].options.raw,true);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].status,'accepted');
  assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO cv_ocpp_firmware_jobs')&&
    x.args[6]==='a'.repeat(64)),'Approved SHA-256 metadata must be preserved');
  await manager.observeStatus(ctx,'Downloading');
  assert.equal(jobs[0].status,'Downloading');
  await manager.observeStatus(ctx,'Installed');
  assert.equal(jobs[0].status,'Installed');
  await manager.observeBoot(ctx,'1.0.0');
  assert.ok(calls.some(x=>x.sql.includes("AND status='Installed' AND target_version=$4")&&
    x.args[3]==='1.0.0'));
  await manager.observeBoot(ctx,'2.0.0');
  assert.ok(calls.some(x=>x.sql.includes("AND status='Installed' AND target_version=$4")&&
    x.args[3]==='2.0.0'));
});

test('Firmware API is role-scoped, disabled by default and validates original browser origin',async()=>{
  const env={CV_PUBLIC_URL:'https://chargevisor-dev.example'};
  const bridge={firmware:{
    list:async()=>({code:200,jobs:[]}),
    request:async()=>({code:202,status:'accepted'})
  }};
  const api=createOcppApi({pool:{query:async()=>({rows:[]})},
    getActor:async req=>req.actor,bridge,env});
  async function request(method,actor,{origin='https://chargevisor-dev.example',
    body,identity=ID}={}){
    const path='/api/ocpp/firmware';
    const url=path+'?tenantId='+TENANT+'&identity='+identity;
    const res={writeHead(code){this.code=code;},end(data){this.data=JSON.parse(data)}};
    const req={method,url,actor,
      headers:{origin,'content-type':'application/json'},
      async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}
    };
    await api(req,res,path);return res;
  }
  assert.equal((await request('GET',null)).code,401);
  assert.equal((await request('POST',{role:'user',tenant_id:TENANT})).code,403);
  assert.equal((await request('GET',{role:'superadmin'})).code,200);
  assert.equal((await request('POST',actor,{origin:'https://evil.example'})).code,403);
  assert.equal((await request('POST',actor,{body:{
    tenantId:TENANT,identity:ID,releaseId:'lumina-2',confirm:'INSTALL_FIRMWARE'
  }})).code,202);
});
