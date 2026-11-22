import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {hashPassword} from './auth.mjs';
import {parseOcppCall,createOcppBridge,createOcppApi} from './ocpp.mjs';

const ID='CV-VIRTUAL-TEST1',TENANT='11111111-1111-4111-8111-111111111111',STATION='22222222-2222-4222-8222-222222222222';
test('OCPP only parses valid CALL frame structure',()=>{
  assert.deepEqual(parseOcppCall('[2,"1","Heartbeat",{}]'),{id:'1',action:'Heartbeat',payload:{}});
  for(const input of ['[3,"1",{}]','[2,1,"Heartbeat",{}]','invalid','[2,"1","BootNotification",null]'])
    assert.equal(parseOcppCall(input),null);
});
test('Virtual charging station uses a genuine authenticated WebSocket and persists OCPP messages',async()=>{
  const password='test-password-which-does-not-leak',hash=await hashPassword(password),seen=[];
  const pool={query:async(sql,args=[])=>{
    if(sql.startsWith('SELECT c.tenant_id,c.station_id,c.password_hash'))return {rowCount:1,rows:[{tenant_id:TENANT,station_id:STATION,password_hash:hash,status:'active',is_simulator:true}]};
    seen.push({sql,args});return {rowCount:1,rows:[]};
  }};
  const bridge=createOcppBridge(pool);
  const server=createServer((req,res)=>{res.writeHead(404);res.end();});
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head).catch(()=>socket.destroy()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const result=await bridge.simulate(ID,server.address().port);
    assert.equal(result.ok,true);
    assert.equal(result.simulated,true);
    assert.deepEqual(result.results.map(x=>x.action),['BootNotification','Heartbeat','StatusNotification','MeterValues']);
    assert.equal(result.results[0].reply.status,'Accepted');
    assert.ok(seen.some(x=>x.sql.includes('cv_ocpp_live')));
    assert.ok(seen.some(x=>x.sql.includes('cv_ocpp_events')&&x.args[2]==='BootNotification'));
    assert.ok(seen.some(x=>x.sql.includes('cv_ocpp_events')&&x.args[2]==='MeterValues'));
    assert.ok(seen.some(x=>x.sql.includes('cv_ocpp_events')&&x.args[4]===true));
    const forbidden=new WebSocket('ws://127.0.0.1:'+server.address().port+'/ocpp/'+ID,['ocpp1.6'],{headers:{Authorization:'Basic '+Buffer.from(ID+':wrong').toString('base64')}});
    const outcome=await Promise.race([
      new Promise(resolve=>{forbidden.once('unexpected-response',(_,res)=>{res.resume();resolve(res.statusCode);});forbidden.once('error',()=>resolve('closed'));}),
      new Promise(resolve=>setTimeout(()=>resolve('timeout'),1500))
    ]);
    assert.notEqual(outcome,101,'Incorrect password must not upgrade');
  }finally{
    await new Promise(resolve=>setTimeout(resolve,120));
    await new Promise(resolve=>server.close(resolve));
  }
});
test('A repeated wallbox identity preserves the authenticated OCPP 1.6 connection',async()=>{
  const password='local-test-wallbox-password';
  const hash=await hashPassword(password);
  const bootIdentities=[];
  const credentialIdentities=[];
  const pool={query:async(sql,args=[])=>{
    if(sql.startsWith('SELECT c.tenant_id,c.station_id,c.password_hash')){
      credentialIdentities.push(args[0]);
      if(args[0]!==ID)return {rowCount:0,rows:[]};
      return {rowCount:1,rows:[{tenant_id:TENANT,station_id:STATION,password_hash:hash,status:'active',is_simulator:false}]};
    }
    if(sql.startsWith('INSERT INTO cv_ocpp_events')&&args[2]==='BootNotification')bootIdentities.push(args[0]);
    return {rowCount:1,rows:[]};
  }};
  const bridge=createOcppBridge(pool);
  const server=createServer();
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head).catch(()=>socket.destroy()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='ws://127.0.0.1:'+server.address().port;
  const clients=new Set();
  function connect(path,protocols=['ocpp1.6'],login=ID,secret=password){
    const client=new WebSocket(origin+path,protocols,{
      headers:{Authorization:'Basic '+Buffer.from(login+':'+secret).toString('base64')},
      handshakeTimeout:3000
    });
    clients.add(client);
    client.once('close',()=>clients.delete(client));
    const status=new Promise((resolve,reject)=>{
      client.once('open',()=>resolve(101));
      client.once('error',reject);
      client.once('unexpected-response',(_,response)=>{
        response.resume();
        resolve(response.statusCode);
        client.terminate();
      });
    });
    return {client,status};
  }
  const canonical='/ocpp/'+ID;
  const repeated=canonical+'/'+ID;
  try{
    for(const path of [canonical,repeated]){
      const {client,status}=connect(path);
      assert.equal(await status,101);
      assert.equal(client.protocol,'ocpp1.6');
      const boot=once(client,'message',{signal:AbortSignal.timeout(3000)});
      client.send(JSON.stringify([2,'boot','BootNotification',{chargePointVendor:'Test',chargePointModel:'Wallbox'}]));
      const [message]=await boot;
      const [frame,id,result]=JSON.parse(message);
      assert.equal(frame,3);
      assert.equal(id,'boot');
      assert.equal(result.status,'Accepted');
      const clientClosed=once(client,'close');
      const serverClosed=once(bridge.active.get(ID).ws,'close');
      client.close();
      await Promise.all([clientClosed,serverClosed]);
      // Let the in-memory registry finish its disconnect cleanup before reconnecting.
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.deepEqual(bootIdentities,[ID,ID]);
    assert.equal(await connect(canonical+'/DIFFERENT-ID').status,400);
    assert.equal(await connect(repeated+'/'+ID).status,400);
    assert.equal(await connect(repeated,[]).status,400);
    assert.equal(await connect(repeated,['ocpp1.6'],'DIFFERENT-ID').status,401);
    assert.equal(await connect(repeated,['ocpp1.6'],ID,'wrong-password').status,401);
    assert.deepEqual(credentialIdentities,[ID,ID,ID]);
  }finally{
    for(const client of clients)client.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});
test('Customer admin cannot launch a simulator and users do not get OCPP identities',async()=>{
  const pool={query:async()=>({rowCount:1,rows:[{identity:ID,station_id:STATION,connected:false,status:'Available',simulated:true}]})};
  const makeRes=()=>({status:null,payload:null,writeHead(code){this.status=code;},end(body){this.payload=JSON.parse(body);}});
  const buildReq=(method,url,data)=>({method,url,headers:{origin:'https://example.test','content-type':'application/json'},
    async *[Symbol.asyncIterator](){if(data)yield Buffer.from(JSON.stringify(data));}});
  const bridge={simulate:async()=>({ok:true})};
  const getActor=async req=>req.actor;
  const api=createOcppApi({pool,getActor,bridge,port:10000,env:{CV_PUBLIC_URL:'https://example.test'}});
  const denied=makeRes(),r1=buildReq('POST','/api/ocpp/simulate',{tenantId:TENANT,stationId:STATION});
  r1.actor={role:'admin',tenant_id:TENANT};
  await api(r1,denied,'/api/ocpp/simulate');assert.equal(denied.status,403);
  const allowed=makeRes(),r2=buildReq('GET','/api/ocpp/live');
  r2.actor={role:'user',id:'33333333-3333-4333-8333-333333333333',tenant_id:TENANT};
  await api(r2,allowed,'/api/ocpp/live');
  assert.equal(allowed.status,200);
  assert.equal(allowed.payload.live[0].identity,undefined);
});
