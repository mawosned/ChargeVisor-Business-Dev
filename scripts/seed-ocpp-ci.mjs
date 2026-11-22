// Ephemeral GitHub Actions PostgreSQL only. Never run against production Neon.
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {hashPassword} from '../backend/auth.mjs';
if(process.env.CV_ALLOW_CI_SEED!=='1'||!process.env.CV_DATABASE_URL?.includes('chargevisor_ci'))
  throw Error('Refusing to seed anything except dedicated ephemeral chargevisor_ci database');
const pool=new Pool({connectionString:process.env.CV_DATABASE_URL});
const tenant=process.env.CV_OCPP_VERIFIER_TENANT_ID||randomUUID(),site=randomUUID(),station=randomUUID(),point=randomUUID();
const identity=process.env.CV_CI_ID||'cvci000001';
const password=process.env.CV_CI_PASSWORD||'K7M4R8T2V9H3P6WA';
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query("INSERT INTO cv_tenants(id,name,status) VALUES($1,'OCPP CI Automation','active')",[tenant]);
  await client.query("INSERT INTO cv_sites(id,tenant_id,name,address) VALUES($1,$2,'CI Standort','CI Test')",[site,tenant]);
  await client.query("INSERT INTO cv_stations(id,tenant_id,site_id,name,topology,is_simulator) VALUES($1,$2,$3,'Independent Python Simulator','shared',true)",[station,tenant,site]);
  await client.query("INSERT INTO cv_chargepoints(id,tenant_id,station_id,name,ocpp_identity,connector_number,enabled) VALUES($1,$2,$3,'CI Ladepunkt',$4,1,true)",[point,tenant,station,identity]);
  await client.query("INSERT INTO cv_chargepoints(id,tenant_id,station_id,name,ocpp_identity,connector_number,enabled) VALUES($1,$2,$3,'CI Slave Ladepunkt',$4,2,true)",[randomUUID(),tenant,station,identity]);
  await client.query('INSERT INTO cv_ocpp_credentials(identity,tenant_id,station_id,password_hash) VALUES($1,$2,$3,$4)',[identity,tenant,station,await hashPassword(password)]);
  await client.query('COMMIT');
  console.log('Seeded an isolated virtual CI wallbox without exposing secrets');
}catch(e){await client.query('ROLLBACK');throw e;}
finally{client.release();await pool.end();}
