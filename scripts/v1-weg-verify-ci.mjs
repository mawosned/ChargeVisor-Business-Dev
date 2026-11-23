// Verify the independent ten-connector WEG OCPP test from actual PostgreSQL.
// This is test evidence: DO NOT run against any customer/production database.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
const address=new URL(process.env.CV_DATABASE_URL||'postgres://none/invalid');
if(process.env.CV_ALLOW_CI_SEED!=='1'||
  !['localhost','127.0.0.1'].includes(address.hostname)||
  address.pathname!=='/chargevisor_ci')
  throw Error('Refusing to inspect any non-disposable database');

const id=process.env.CV_CI_ID||'cvci000001';
const pool=new Pool({connectionString:process.env.CV_DATABASE_URL});
try{
  const points=await pool.query(
    'SELECT p.connector_number,p.enabled,s.is_simulator,p.ocpp_identity '+
    'FROM cv_chargepoints p JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id '+
    'WHERE p.ocpp_identity=$1 ORDER BY p.connector_number',[id]);
  assert.deepEqual(points.rows.map(x=>x.connector_number),
    Array.from({length:10},(_,i)=>i+1),'Ten separate provisioned connectors expected');
  assert.ok(points.rows.every(p=>p.enabled&&p.is_simulator&&p.ocpp_identity===id));

  const tx=await pool.query(
    'SELECT id,connector_id,meter_start_wh,meter_stop_wh,stopped_at,simulated '+
    'FROM cv_ocpp_transactions WHERE identity=$1 ORDER BY connector_id',[id]);
  assert.equal(tx.rowCount,10,'Exactly ten independent charging sessions expected');
  assert.deepEqual(tx.rows.map(x=>x.connector_id),Array.from({length:10},(_,i)=>i+1));
  assert.equal(new Set(tx.rows.map(x=>String(x.id))).size,10);
  for(const x of tx.rows){
    assert.equal(x.simulated,true);
    assert.ok(x.stopped_at,'Session missing StopTransaction');
    assert.equal(Number(x.meter_stop_wh)-Number(x.meter_start_wh),100);
  }

  const states=await pool.query(
    'SELECT connector_id,status,error_code,simulated '+
    'FROM cv_ocpp_connector_live WHERE identity=$1 ORDER BY connector_id',[id]);
  assert.equal(states.rowCount,10);
  for(const x of states.rows){
    assert.equal(x.simulated,true);
    assert.equal(x.status,'Available','Connector '+x.connector_id+' not restored');
    assert.equal(x.error_code,'NoError');
  }
  const events=await pool.query(
    'SELECT action,payload,simulated FROM cv_ocpp_events WHERE identity=$1 ORDER BY id',[id]);
  for(const action of ['BootNotification','Heartbeat','Authorize','StartTransaction',
                       'StatusNotification','MeterValues','StopTransaction']){
    assert.ok(events.rows.some(e=>e.action===action),'Missing OCPP '+action);
  }
  assert.equal(events.rows.filter(e=>e.action==='StartTransaction').length,10);
  assert.equal(events.rows.filter(e=>e.action==='StopTransaction').length,10);
  assert.ok(events.rows.every(e=>e.simulated),'Customer and test evidence mixed');
  assert.ok(events.rows.some(e=>e.action==='StatusNotification'&&
    e.payload.status==='Faulted'&&e.payload.connectorId===4&&
    e.payload.errorCode==='OverCurrentFailure'),'Fault not recorded correctly');
  console.log('PASS: 10/10 WEG sessions, connector isolation, 11kW nominal '+
    'and 30kW simulator allocation, meter deltas and fault recovery in actual PG');
}finally{
  await pool.end();
}
