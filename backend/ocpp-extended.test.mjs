import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {hashPassword} from './auth.mjs';
import {createOcppBridge,createOcppApi} from './ocpp.mjs';
import {OCPP_CSMS_ACTIONS,validateOcppCsmsCommand,validateOcppCsmsResponse} from './ocpp-command-catalog.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const STATION='22222222-2222-4222-8222-222222222222';
const IDENTITY='DEV-ONLY-CP-1';
const URL='https://dev.chargevisor.test';
const TODAY='2026-11-22T18:30:00Z';
const PROFILE={
  chargingProfileId:1,stackLevel:0,chargingProfilePurpose:'TxDefaultProfile',
  chargingProfileKind:'Absolute',chargingSchedule:{
    chargingRateUnit:'A',chargingSchedulePeriod:[{startPeriod:0,limit:16,numberPhases:3}]
  }
};
const commands={
  CancelReservation:{reservationId:1},
  ChangeAvailability:{connectorId:1,type:'Inoperative'},
  ChangeConfiguration:{key:'MeterValueSampleInterval',value:'30'},
  ClearCache:{},
  ClearChargingProfile:{},
  DataTransfer:{vendorId:'example.test',messageId:'test'},
  GetCompositeSchedule:{connectorId:1,duration:600},
  GetConfiguration:{key:['HeartbeatInterval']},
  GetDiagnostics:{location:'https://test.example.com/diagnostics'},
  GetLocalListVersion:{},
  RemoteStartTransaction:{idTag:'TEST-USER',connectorId:1},
  RemoteStopTransaction:{transactionId:42},
  ReserveNow:{connectorId:1,expiryDate:TODAY,idTag:'TEST-USER',reservationId:4},
  Reset:{type:'Soft'},
  SendLocalList:{listVersion:1,updateType:'Full',localAuthorizationList:[{
    idTag:'TEST-USER',idTagInfo:{status:'Accepted'}}]},
  SetChargingProfile:{connectorId:1,csChargingProfiles:PROFILE},
  TriggerMessage:{requestedMessage:'StatusNotification',connectorId:1},
  UnlockConnector:{connectorId:1},
  UpdateFirmware:{location:'https://test.example.com/firmware',retrieveDate:TODAY}
};

test('All 19 CSMS command names are explicit and have strictly validated example payloads',()=>{
  assert.equal(OCPP_CSMS_ACTIONS.length,19);
  assert.equal(new Set(OCPP_CSMS_ACTIONS).size,19);
  assert.deepEqual(Object.keys(commands).sort(),[...OCPP_CSMS_ACTIONS].sort());
  for(const [action,payload] of Object.entries(commands)){
    assert.equal(validateOcppCsmsCommand(action,payload).ok,true,action);
    assert.equal(validateOcppCsmsCommand(action,null).ok,false);
  }
  assert.equal(validateOcppCsmsCommand('__proto__',{}).ok,false);
  assert.equal(validateOcppCsmsCommand('Reset',{type:'RestartEverything'}).ok,false);
  assert.equal(validateOcppCsmsCommand('ChangeAvailability',{connectorId:-1,type:'Operative'}).ok,false);
  assert.equal(validateOcppCsmsCommand('SendLocalList',{listVersion:1,updateType:'Full',localAuthorizationList:[]}).ok,true);
  assert.equal(validateOcppCsmsCommand('GetConfiguration',{}).ok,true);
  assert.equal(validateOcppCsmsCommand('UpdateFirmware',{location:'file:///etc/passwd',retrieveDate:TODAY}).ok,false);
});

function makeReq(path,body,actor={role:'superadmin'}){
  return {
    method:'POST',url:path,actor,headers:{origin:URL,'content-type':'application/json'},
    async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}
  };
}
function makeRes(){
  return {
    code:null,payload:null,
    writeHead(status){this.code=status;},
    end(body){this.payload=body?JSON.parse(body):null;}
  };
}

test('Valid CALLRESULT is action-specific; malformed replies cannot earn PASS',()=>{
  for(const action of OCPP_CSMS_ACTIONS){
    let response={status:'Accepted'};
    if(action==='GetConfiguration')response={configurationKey:[],unknownKey:[]};
    if(action==='GetDiagnostics')response={fileName:'diagnostic-test.log'};
    if(action==='GetLocalListVersion')response={listVersion:1};
    if(action==='UnlockConnector')response={status:'Unlocked'};
    if(action==='UpdateFirmware')response={};
    assert.equal(validateOcppCsmsResponse(action,response).ok,true,action);
  }
  for(const action of OCPP_CSMS_ACTIONS){
    assert.equal(validateOcppCsmsResponse(action,null).ok,false,action);
  }
  assert.equal(validateOcppCsmsResponse('Reset',{}).ok,false);
  assert.equal(validateOcppCsmsResponse('UnlockConnector',{status:'Accepted'}).ok,false);
  assert.equal(validateOcppCsmsResponse('GetLocalListVersion',{status:'Accepted'}).ok,false);
  assert.equal(validateOcppCsmsResponse('UpdateFirmware',{status:'Accepted'}).ok,false);
  assert.equal(validateOcppCsmsResponse('GetConfiguration',{configurationKey:[{key:'x'}]}).ok,false);
  assert.equal(validateOcppCsmsResponse('GetDiagnostics',{fileName:'log.txt'}).ok,true);
});

test('Existing WebSocket: firmware, diagnostics and proprietary data messages are safely handled',async()=>{
  const password='test-only-credential-value-2026';
  const hash=await hashPassword(password);
  const recorded=[];
  const pool={async query(sql,args=[]){
    if(sql.startsWith('SELECT c.tenant_id,c.station_id,c.password_hash'))
      return {rowCount:1,rows:[{tenant_id:TENANT,station_id:STATION,
        password_hash:hash,status:'active',is_simulator:true}]};
    if(sql.startsWith('INSERT INTO cv_ocpp_events'))recorded.push({sql,args});
    return {rowCount:1,rows:[]};
  }};
  const bridge=createOcppBridge(pool);
  const server=createServer();
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head).catch(()=>socket.destroy()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const socket=new WebSocket('ws://127.0.0.1:'+server.address().port+'/ocpp/'+IDENTITY,['ocpp1.6'],{
    headers:{Authorization:'Basic '+Buffer.from(IDENTITY+':'+password).toString('base64')},
    handshakeTimeout:3000
  });
  try{
    await once(socket,'open');
    let id=0;
    async function call(action,payload){
      const current='in'+(++id);
      const incoming=once(socket,'message',{signal:AbortSignal.timeout(3500)});
      socket.send(JSON.stringify([2,current,action,payload]));
      const [raw]=await incoming;
      const frame=JSON.parse(raw);
      assert.equal(frame[1],current);
      return frame;
    }
    assert.deepEqual(await call('DiagnosticsStatusNotification',{status:'Uploaded'}),[3,'in1',{}]);
    assert.deepEqual(await call('FirmwareStatusNotification',{status:'Installed'}),[3,'in2',{}]);
    assert.deepEqual(await call('DataTransfer',{
      vendorId:'Vendor-Unknown',messageId:'sensitive',data:'DO-NOT-STORE-SECRET'
    }),[3,'in3',{status:'UnknownVendorId'}]);
    const bad=await call('FirmwareStatusNotification',{status:'Imaginary'});
    assert.equal(bad[0],4);
    assert.equal(bad[2],'PropertyConstraintViolation');
    assert.deepEqual(recorded.map(x=>x.args[2]),
      ['DiagnosticsStatusNotification','FirmwareStatusNotification','DataTransfer']);
    assert.ok(!recorded.some(x=>JSON.stringify(x).includes('DO-NOT-STORE-SECRET')));
  }finally{
    socket.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('Opt-in CSMS command API sends all 19 actions on an authenticated TEST station only',async()=>{
  const password='dedicated-test-chargepoint-password';
  const hash=await hashPassword(password);
  const seen=[];
  const pool={async query(sql,args=[]){
    if(sql.startsWith('SELECT c.tenant_id,c.station_id,c.password_hash'))
      return {rowCount:1,rows:[{tenant_id:TENANT,station_id:STATION,
        password_hash:hash,status:'active',is_simulator:true}]};
    if(sql.includes('FROM cv_ocpp_credentials c')&&sql.includes('WHERE c.identity=$1 AND c.tenant_id=$2')){
      assert.deepEqual(args,[IDENTITY,TENANT]);
      return {rowCount:1,rows:[{identity:IDENTITY,station_id:STATION,tenant_id:TENANT}]};
    }
    return {rowCount:1,rows:[]};
  }};
  const bridge=createOcppBridge(pool);
  const api=createOcppApi({
    pool,getActor:async req=>req.actor,bridge,port:0,
    env:{CV_PUBLIC_URL:URL,CV_OCPP_TEST_COMMANDS:'1'}
  });
  const server=createServer();
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head).catch(()=>socket.destroy()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const socket=new WebSocket('ws://127.0.0.1:'+server.address().port+'/ocpp/'+IDENTITY,['ocpp1.6'],{
    headers:{Authorization:'Basic '+Buffer.from(IDENTITY+':'+password).toString('base64')},
    handshakeTimeout:3000
  });
  socket.on('message',raw=>{
    const frame=JSON.parse(raw.toString());
    if(frame[0]!==2)return;
    seen.push({action:frame[2],payload:frame[3]});
    let response={status:'Accepted'};
    if(frame[2]==='GetConfiguration')response={configurationKey:[],unknownKey:[]};
    if(frame[2]==='GetLocalListVersion')response={listVersion:3};
    if(frame[2]==='GetDiagnostics')response={fileName:'test-logs.txt'};
    if(frame[2]==='UnlockConnector')response={status:'Unlocked'};
    if(frame[2]==='UpdateFirmware')response={};
    socket.send(JSON.stringify([3,frame[1],response]));
  });
  try{
    await once(socket,'open');
    for(const [action,payload] of Object.entries(commands)){
      const req=makeReq('/api/ocpp/test-command',{tenantId:TENANT,identity:IDENTITY,action,payload});
      const res=makeRes();
      await api(req,res,'/api/ocpp/test-command');
      assert.equal(res.code,200,action+': '+JSON.stringify(res.payload));
      assert.equal(res.payload.action,action);
      assert.ok(res.payload.response&&typeof res.payload.response==='object');
    }
    assert.deepEqual(seen.map(x=>x.action),OCPP_CSMS_ACTIONS);
    assert.deepEqual(seen.find(x=>x.action==='SetChargingProfile').payload,commands.SetChargingProfile);

    const notAdmin=makeRes();
    await api(makeReq('/api/ocpp/test-command',{tenantId:TENANT,identity:IDENTITY,
      action:'Reset',payload:{type:'Hard'}},{role:'admin',tenant_id:TENANT}),notAdmin,'/api/ocpp/test-command');
    assert.equal(notAdmin.code,403);
    assert.equal(seen.length,19,'Unauthorized request must never reach station');

    const bad=makeRes();
    await api(makeReq('/api/ocpp/test-command',{tenantId:TENANT,identity:IDENTITY,
      action:'Reset',payload:{type:'Fire'}}),bad,'/api/ocpp/test-command');
    assert.equal(bad.code,400);
    assert.equal(seen.length,19,'Invalid input must never reach station');
  }finally{
    socket.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('Test command endpoint is absent when the feature flag is off',async()=>{
  let queried=false;
  const api=createOcppApi({
    pool:{async query(){queried=true;throw Error('Never query DB');}},
    getActor:async()=>({role:'superadmin'}),
    bridge:{},port:0,env:{CV_PUBLIC_URL:URL}
  });
  const res=makeRes();
  await api(makeReq('/api/ocpp/test-command',{tenantId:TENANT,identity:IDENTITY,action:'Reset',
    payload:{type:'Soft'}}),res,'/api/ocpp/test-command');
  assert.equal(res.code,404);
  assert.equal(queried,false);
});
