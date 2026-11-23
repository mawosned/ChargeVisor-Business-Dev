// True encrypted backup -> isolated restore -> database comparison.
// Run ONLY in disposable localhost GitHub Actions PostgreSQL 16.
// Never operate on existing Walectra, ChargeVisor customer or Render databases.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {createBackup,verifyArchive,restoreIntoEmptyDatabase} from './database-archive.mjs';

const sourceUrl=process.env.CV_DATABASE_URL||'';
const db=new URL(sourceUrl);
if(process.env.CV_ALLOW_CI_SEED!=='1'||
  !['localhost','127.0.0.1'].includes(db.hostname)||
  db.pathname!=='/chargevisor_ci')
  throw Error('Refusing backup/restore test against non-disposable database');

const src=new pg.Pool({connectionString:sourceUrl,max:1});
const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';
const admin=new pg.Pool({connectionString:adminUrl.toString(),max:1});
const restoreName='chargevisor_restorecheck';
const targetUrl=new URL(sourceUrl);targetUrl.pathname='/'+restoreName;
const key=randomBytes(32);
const dir=await mkdtemp(join(tmpdir(),'chargevisor-backup-ci-'));
const id=randomUUID();
let backup;
try{
  // A genuinely persisted business record must survive backup and restore.
  await src.query(
    "INSERT INTO cv_tenants(id,name,status,contact_email) VALUES($1,$2,'active',$3)",
    [id,'DISPOSABLE-RESTORE-SENTINEL','test-restore@example.invalid']
  );
  backup=await createBackup({databaseUrl:sourceUrl,backupDir:dir,key});
  assert.ok(backup.verified&&backup.encryptedBytes>1000);
  const header=(await readFile(backup.path)).subarray(0,8).toString('ascii');
  assert.equal(header,'CVBKP001');
  const check=await verifyArchive(backup.path,key);
  assert.ok(check.dumpBytes>1000);
  const exist=await admin.query("SELECT 1 FROM pg_database WHERE datname=$1",[restoreName]);
  if(exist.rowCount)throw Error('CI isolated restore database unexpectedly already exists');
  await admin.query('CREATE DATABASE '+restoreName);
  const outcome=await restoreIntoEmptyDatabase({
    backup:backup.path,targetUrl:targetUrl.toString(),key,
    confirm:'RESTORE_TO_EMPTY_ISOLATED_DATABASE'
  });
  assert.equal(outcome.restored,true);
  const restored=new pg.Pool({connectionString:targetUrl.toString(),max:1});
  try{
    const found=await restored.query('SELECT id,name,status,contact_email FROM cv_tenants WHERE id=$1',[id]);
    assert.equal(found.rowCount,1);
    assert.deepEqual(found.rows[0],{
      id,name:'DISPOSABLE-RESTORE-SENTINEL',status:'active',
      contact_email:'test-restore@example.invalid'
    });
    const tables=['cv_tenants','cv_users','cv_sites','cv_stations',
      'cv_chargepoints','cv_ocpp_credentials','cv_ocpp_transactions',
      'cv_ocpp_events','cv_ocpp_connector_live'];
    for(const name of tables){
      const original=await src.query('SELECT COUNT(*)::int AS n FROM '+name);
      const copy=await restored.query('SELECT COUNT(*)::int AS n FROM '+name);
      assert.equal(copy.rows[0].n,original.rows[0].n,name+' mismatched');
    }
    await assert.rejects(()=>restoreIntoEmptyDatabase({
      backup:backup.path,targetUrl:targetUrl.toString(),key,
      confirm:'RESTORE_TO_EMPTY_ISOLATED_DATABASE'
    }),/Refusing to overwrite/, 'Second restore must be refused');
  }finally{await restored.end();}
  const bad=Buffer.from(await readFile(backup.path));
  bad[bad.length-20]^=0x1;
  const corrupt=join(dir,'tampered.cvbak');
  await writeFile(corrupt,bad);
  await assert.rejects(()=>verifyArchive(corrupt,key),/authentication failed/);
  console.log('PASS: actual PostgreSQL pg_dump encrypted+authenticated; '+
    'restore to empty isolated database, real business rows and core-table counts match, '+
    'overwrite and corrupted archive refused.');
}finally{
  await src.end();await admin.end();
  await rm(dir,{recursive:true,force:true});
}
