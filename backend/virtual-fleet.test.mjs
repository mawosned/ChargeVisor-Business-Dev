import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {hashPassword} from './auth.mjs';
import {createOcppBridge} from './ocpp.mjs';
import {createVirtualFleet} from './virtual-fleet.mjs';

const identity='CV-VIRTUAL-FLEET-TEST';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const station='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('A virtual wallbox stays connected through Available -> Charging -> StopTransaction -> Available cycles',async t=>{
  const seen=[],passwordHash=await hashPassword('not-used-simulator-real-password');
  let nextTx=100;
  const pool={async query(sql,args=[]){
    seen.push({sql,args});
    if(sql.includes('SELECT c.identity FROM cv_ocpp_credentials'))
      return {rows:[{identity}],rowCount:1};
    if(sql.includes('SELECT c.tenant_id,c.station_id,c.password_hash'))
      return {rows:[{tenant_id:tenant,station_id:station,password_hash:passwordHash,
        status:'active',is_simulator:true}],rowCount:1};
    if(sql.includes('SELECT id FROM cv_ocpp_transactions'))
      return {rows:[],rowCount:0};
    if(sql.startsWith('INSERT INTO cv_ocpp_transactions')){
      nextTx++;return {rows:[{id:nextTx}],rowCount:1};
    }
    if(sql.startsWith('UPDATE cv_ocpp_transactions'))
      return {rows:[{id:args[1]}],rowCount:1};
    return {rows:[],rowCount:1};
  }};
  const bridge=createOcppBridge(pool);
  const server=createServer((req,res)=>{res.writeHead(404);res.end();});
  server.on('upgrade',(req,socket,head)=>bridge.upgrade(req,socket,head));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fleet=createVirtualFleet({pool,bridge,port:server.address().port,
    config:{idleMs:35,prepareMs:15,chargeMs:65,meterIntervalMs:15,finishMs:15,
      heartbeatMs:35,reconnectMs:25},syncMs:6000});
  try{
    fleet.start();
    const deadline=Date.now()+5000;
    while(Date.now()<deadline && !fleet.status().some(x=>x.cycles>=2)){
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(fleet.status().length,1);
    assert.ok(fleet.status()[0].connected,'WebSocket stays open between charging cycles');
    assert.ok(fleet.status()[0].cycles>=2,'at least 2 complete automated charging sessions');
    const events=seen.filter(x=>x.sql.startsWith('INSERT INTO cv_ocpp_events'))
      .map(x=>({action:x.args[2],data:JSON.parse(x.args[3]),simulated:x.args[4]}));
    const actions=events.map(x=>x.action);
    for(const action of ['BootNotification','Heartbeat','StatusNotification','StartTransaction','MeterValues','StopTransaction'])
      assert.ok(actions.includes(action),'missing actual websocket request '+action);
    const statuses=events.filter(x=>x.action==='StatusNotification').map(x=>x.data.status);
    for(const status of ['Available','Preparing','Charging','Finishing'])
      assert.ok(statuses.includes(status),'missing transition '+status);
    assert.ok(events.every(x=>x.simulated),'never write fake billing data as real');
    const txStarts=seen.filter(x=>x.sql.startsWith('INSERT INTO cv_ocpp_transactions')).length;
    const txStops=seen.filter(x=>x.sql.startsWith('UPDATE cv_ocpp_transactions')).length;
    assert.ok(txStarts>=2&&txStops>=2,'transactions persisted end to end');
    assert.equal(bridge.active.size,1,'simulated charger is continuously connected');
  }finally{
    await fleet.stop();
    await new Promise(resolve=>server.close(resolve));
  }
});
