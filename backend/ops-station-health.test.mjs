import test from 'node:test';
import assert from 'node:assert/strict';
import {readStationHealth} from './ops-station-health.mjs';
import {createOcppApi} from './ocpp.mjs';
const tid='11111111-1111-4111-8111-111111111111';
const sid='22222222-2222-4222-8222-222222222222';
const recent=new Date(Date.now()-60_000).toISOString();
const stale=new Date(Date.now()-500_000).toISOString();
test('Operator monitor counts real connected, stale and disconnected stations, not test devices',async()=>{
  const sql=[];
  const pool={async query(q){
    sql.push(q);
    if(q.includes('FROM cv_ocpp_credentials c'))return {rows:[
      {identity:'CV-ONE',tenant_id:tid,station_id:sid,tenant_name:'WEG',station_name:'Garage A',
        connected:true,last_seen:recent,firmware:'2.1'},
      {identity:'CV-TWO',tenant_id:tid,station_id:sid,tenant_name:'WEG',station_name:'Garage B',
        connected:true,last_seen:stale},
      {identity:'CV-THREE',tenant_id:tid,station_id:sid,tenant_name:'WEG',station_name:'Garage C',
        connected:false,last_seen:recent}
    ]};
    if(q.includes('FROM cv_ocpp_transactions'))return {rows:[
      {identity:'CV-TWO',open_count:2},{identity:'CV-THREE',open_count:1}
    ]};
    throw Error('Unexpected SQL');
  }};
  const data=await readStationHealth(pool,{staleSeconds:180});
  assert.equal(data.online,1);
  assert.equal(data.stale,1);
  assert.equal(data.disconnected,1);
  assert.equal(data.openUnconfirmedSessions,3);
  assert.deepEqual(data.stations.map(x=>x.state),
    ['online','stale_heartbeat','disconnected']);
  assert.equal(data.stations[1].openUnconfirmedSessions,2);
  assert.equal(data.stations[0].firmware,'2.1');
  assert.ok(sql.some(q=>q.includes('s.is_simulator=false')));
  assert.ok(sql.some(q=>q.includes('t.deleted_at IS NULL')));
  assert.ok(sql.some(q=>q.includes('stopped_at IS NULL')));
});
test('Only authenticated superadmin can read operational station list',async()=>{
  const pool={async query(){return {rows:[]}}};
  const api=createOcppApi({pool,bridge:{},env:{},
    getActor:async req=>req.actor});
  async function call(actor,url='/api/ocpp/ops-summary'){
    const res={writeHead(status){this.status=status;},
      end(body){this.body=JSON.parse(body)}};
    await api({actor,url,method:'GET',headers:{}},res,'/api/ocpp/ops-summary');
    return res;
  }
  assert.equal((await call(null)).status,401);
  assert.equal((await call({role:'user',tenant_id:tid})).status,403);
  assert.equal((await call({role:'admin',tenant_id:tid})).status,403);
  const superadmin=await call({role:'superadmin'});
  assert.equal(superadmin.status,200);
  assert.equal(superadmin.body.scanned,0);
  assert.equal((await call({role:'superadmin'},'/api/ocpp/ops-summary?staleSeconds=1')).status,400);
});
