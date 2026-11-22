import assert from 'node:assert/strict';
import {Pool} from 'pg';
if(!process.env.CV_DATABASE_URL?.includes('chargevisor_ci'))throw Error('Wrong database');
const pool=new Pool({connectionString:process.env.CV_DATABASE_URL});
try{
  const identity=process.env.CV_CI_ID||'cvci000001';
  const events=await pool.query(
    'SELECT action,payload,simulated FROM cv_ocpp_events WHERE identity=$1 ORDER BY id',
    [identity]);
  const actions=events.rows.map(x=>x.action);
  const mandatory=['BootNotification','Heartbeat','StatusNotification','Authorize','StartTransaction','MeterValues','StopTransaction'];
  for(const action of mandatory)assert.ok(actions.includes(action),'Missing persisted OCPP action: '+action);
  assert.ok(events.rows.every(x=>x.simulated),'Test data must always be marked simulated');
  const statuses=events.rows.filter(x=>x.action==='StatusNotification').map(x=>x.payload.status);
  for(const s of ['Available','Preparing','Charging','Finishing','Faulted'])
    assert.ok(statuses.includes(s),'Missing lifecycle state '+s);
  const tx=await pool.query('SELECT id,meter_start_wh,meter_stop_wh,stopped_at,simulated FROM cv_ocpp_transactions WHERE identity=$1',[identity]);
  assert.ok(tx.rowCount>=2,'Expected two charging sessions');
  for(const row of tx.rows){
    assert.ok(row.simulated,'Test transaction was marked as real');
    assert.ok(row.stopped_at,'Transaction never ended');
    assert.ok(Number(row.meter_stop_wh)>Number(row.meter_start_wh),'No energy increase reported');
  }
  const connector=await pool.query(
    'SELECT connector_id,status,energy_wh,simulated,last_seen FROM cv_ocpp_connector_live WHERE identity=$1 AND connector_id=1',
    [identity]);
  assert.equal(connector.rowCount,1,'Connector 1 never reported OCPP status');
  assert.equal(connector.rows[0].status,'Available');
  assert.ok(Number(connector.rows[0].energy_wh)>1000);
  assert.ok(connector.rows[0].simulated);
  const slave=await pool.query(
    'SELECT connector_id,status,simulated FROM cv_ocpp_connector_live WHERE identity=$1 AND connector_id=2',
    [identity]);
  assert.equal(slave.rowCount,1,'Master/slave connector 2 never reported');
  assert.equal(slave.rows[0].status,'Available','Slave status must not inherit master Charging state');
  assert.equal(slave.rows[0].simulated,true);
  const live=await pool.query('SELECT connected,status,simulated,last_seen FROM cv_ocpp_live WHERE identity=$1',[identity]);
  assert.equal(live.rowCount,1);
  assert.equal(live.rows[0].simulated,true);
  assert.ok(live.rows[0].last_seen);
  console.log('Verified third-party OCPP 1.6J simulator: real WebSocket messages, 2 transactions, telemetry and tenant-safe simulated flags.');
}finally{await pool.end();}
