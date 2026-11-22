import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {WebSocket} from 'ws';
import {hashPassword} from './auth.mjs';
import {createOcppApi,createOcppBridge} from './ocpp.mjs';

test('Only Walectra can transfer the saved Freecharge policy to an actual Lumina connection',async()=>{
  const identity='cv-freecharge-test';
  const password='isolated-websocket-test-password';
  const tenantId='12345678-1234-1234-1234-123456789012';
  const pointId='12345678-1234-1234-1234-123456789013';
  const stationId='12345678-1234-1234-1234-123456789014';
  const hash=await hashPassword(password);
  const point={
    tenant_id:tenantId,station_id:stationId,ocpp_identity:identity,
    enabled:true,freecharge_enabled:true,connected:true,mixed_policy:false,
    vendor:'Enelion',model:'Lumina'
  };
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT c.tenant_id,c.station_id,c.password_hash'))
      return {rowCount:1,rows:[{tenant_id:tenantId,station_id:stationId,password_hash:hash,
        status:'active',is_simulator:false}]};
    if(sql.includes('AS mixed_policy')){
      assert.deepEqual(args,[pointId,tenantId]);
      return {rowCount:1,rows:[{...point}]};
    }
    return {rowCount:1,rows:[]};
  }};
  const bridge=createOcppBridge(pool);
  const path='/api/ocpp/freecharge-configuration';
  let api;
  const server=createServer((req,res)=>api(req,res,path));
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host='127.0.0.1:'+server.address().port;
  const origin='http://'+host;
  const env={CV_PUBLIC_URL:origin};
  api=createOcppApi({pool,bridge,env,getActor:async req=>({role:req.headers['x-test-role']||'superadmin'})});
  const request=(overrides={})=>fetch(origin+path,{
    method:'POST',headers:{'Content-Type':'application/json',origin,...overrides},
    body:JSON.stringify({tenantId,pointId})
  });
  let client;
  try{
    assert.equal((await request({'X-Test-Role':'admin'})).status,403);
    assert.equal((await request({origin:'https://somewhere-else.test'})).status,403);
    assert.equal((await request()).status,409);
    client=new WebSocket('ws://'+host+'/ocpp/'+identity,['ocpp1.6'],{
      headers:{Authorization:'Basic '+Buffer.from(identity+':'+password).toString('base64')}
    });
    await once(client,'open',{signal:AbortSignal.timeout(3000)});
    const nextFrame=async()=>{
      const [buffer]=await once(client,'message',{signal:AbortSignal.timeout(3000)});
      return JSON.parse(buffer);
    };
    const reply=(...frame)=>client.send(JSON.stringify(frame));
    const boot=nextFrame();
    reply(2,'boot','BootNotification',{chargePointVendor:'Enelion',chargePointModel:'Lumina'});
    assert.equal((await boot)[2].status,'Accepted');

    point.mixed_policy=true;
    assert.equal((await request()).status,409);
    point.mixed_policy=false;
    point.model='Unverified model';
    assert.equal((await request()).status,422);
    point.model='Lumina';

    const first=nextFrame();
    const enable=request();
    const [firstType,firstId,firstAction,firstPayload]=await first;
    assert.equal(firstType,2);
    assert.equal(firstAction,'ChangeConfiguration');
    assert.deepEqual(firstPayload,{key:'EnelionFreeChargeOcppIdtag',value:'CV-FREECHARGE'});
    reply(3,'unrelated',{status:'Rejected'});
    reply(3);
    assert.equal((await request()).status,409);
    const second=nextFrame();
    reply(3,firstId,{status:'Accepted'});
    const [secondType,secondId,secondAction,secondPayload]=await second;
    assert.equal(secondType,2);
    assert.equal(secondAction,'ChangeConfiguration');
    assert.deepEqual(secondPayload,{key:'EnelionFreeChargeEnabled',value:'true'});
    reply(3,secondId,{status:'RebootRequired'});
    const enabled=await enable;
    assert.equal(enabled.status,200);
    assert.deepEqual(await enabled.json(),{
      status:'RebootRequired',freechargeEnabled:true,results:[
        {key:'EnelionFreeChargeOcppIdtag',status:'Accepted'},
        {key:'EnelionFreeChargeEnabled',status:'RebootRequired'}
      ]
    });

    point.freecharge_enabled=false;
    const disabling=nextFrame();
    const disable=request();
    const [,disableId,,disablePayload]=await disabling;
    assert.deepEqual(disablePayload,{key:'EnelionFreeChargeEnabled',value:'false'});
    reply(4,disableId,'NotSupported','Unsupported key',{});
    const rejected=await disable;
    assert.equal(rejected.status,422);
    assert.equal((await rejected.json()).results[0].status,'NotSupported');

    const beforeClose=nextFrame();
    const interrupted=request();
    await beforeClose;
    client.terminate();
    const disconnected=await interrupted;
    assert.equal(disconnected.status,409);
    assert.equal((await disconnected.json()).results[0].status,'Disconnected');
  }finally{
    client?.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});
