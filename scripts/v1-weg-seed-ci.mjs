// V1 WEG verification: seed exactly 10 simulated connectors on ONE OCPP identity.
// Only runs against an explicitly disposable localhost GitHub Actions database.
// No customer/production database can pass the preflight.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

const connection=process.env.CV_DATABASE_URL;
if(process.env.CV_ALLOW_CI_SEED!=='1'||!connection)
  throw Error('CI seed authorization or database URL missing');
const address=new URL(connection);
if(!['127.0.0.1','localhost'].includes(address.hostname)||
   address.pathname!=='/chargevisor_ci')
  throw Error('Refusing to seed any database other than localhost/chargevisor_ci');

const identity=process.env.CV_CI_ID||'cvci000001';
const pool=new Pool({connectionString:connection});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  const station=await client.query(
    'SELECT c.tenant_id,c.station_id,s.is_simulator '+
    'FROM cv_ocpp_credentials c JOIN cv_stations s '+
    'ON c.station_id=s.id AND c.tenant_id=s.tenant_id WHERE c.identity=$1',
    [identity]);
  assert.equal(station.rowCount,1,'CI identity not provisioned');
  assert.equal(station.rows[0].is_simulator,true,'Must be simulated');
  const {tenant_id,station_id}=station.rows[0];
  const points=await client.query(
    'SELECT connector_number FROM cv_chargepoints '+
    'WHERE tenant_id=$1 AND station_id=$2 AND ocpp_identity=$3 ORDER BY connector_number',
    [tenant_id,station_id,identity]);
  assert.deepEqual(points.rows.map(x=>x.connector_number),[1,2],
    'Start from original two-connector CI seed; never modify other stations');
  for(let connector=3;connector<=10;connector++){
    await client.query(
      'INSERT INTO cv_chargepoints(id,tenant_id,station_id,name,ocpp_identity,connector_number,enabled) '+
      'VALUES($1,$2,$3,$4,$5,$6,true)',
      [randomUUID(),tenant_id,station_id,'WEG CI Stellplatz '+connector,identity,connector]);
  }
  await client.query('COMMIT');
  console.log('Created exactly 10 isolated ChargeVisor CI connectors, one OCPP identity');
}catch(e){
  await client.query('ROLLBACK');
  throw e;
}finally{
  client.release();
  await pool.end();
}
