#!/usr/bin/env node
// Execution entrypoint for an explicitly approved PRIVATE backup scheduler.
// No production secrets in the public development repository or CI.
// Usage: node scripts/ops/cloud-archive-runner.mjs database|sessions
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createBackup,keyFromEnv} from './database-archive.mjs';
import {createEncryptedSessionSnapshot} from './session-snapshot.mjs';

function postgresUrl(){
  const value=process.env.CV_DATABASE_URL||process.env.NEON_DATABASE_URL;
  if(!value)throw Error('Missing ChargeVisor database environment secret');
  return value;
}
function runUploader(filepath){
  return new Promise((done,reject)=>{
    const child=spawn(process.env.CV_PYTHON_BINARY||'python3',
      ['scripts/ops/sharepoint-uploader.py'],{
        cwd:resolve(process.cwd()),env:{...process.env,BACKUP_FILE:filepath},
        stdio:['ignore','pipe','pipe']
      });
    let output='',error='';
    child.stdout.on('data',buf=>output=(output+buf.toString()).slice(-1000));
    child.stderr.on('data',buf=>error=(error+buf.toString()).slice(-500));
    child.once('error',()=>reject(Error('SharePoint uploader could not start')));
    child.once('close',code=>{
      if(code!==0)reject(Error('SharePoint upload failed; inspect restricted job log'));
      else done(output.trim());
    });
  });
}
export async function runApprovedArchive(action,{poolFactory}={}){
  if(!['database','sessions'].includes(action))
    throw Error('Specify database or sessions, never both implicitly');
  // Check the key before contacting a database or external service.
  const key=keyFromEnv();
  const dir=await mkdtemp(join(tmpdir(),'chargevisor-secure-archive-'));
  await chmod(dir,0o700);
  let pool=null;
  try{
    let result;
    if(action==='database'){
      result=await createBackup({
        databaseUrl:postgresUrl(),backupDir:dir,key,
        pgDumpBinary:process.env.CV_PG_DUMP_BINARY||'pg_dump'
      });
    }else{
      if(poolFactory)pool=await poolFactory(postgresUrl());
      else {
        const pg=(await import('pg')).default;
        pool=new pg.Pool({connectionString:postgresUrl(),max:1,
          connectionTimeoutMillis:10000});
      }
      result=await createEncryptedSessionSnapshot({pool,privateDir:dir,key});
    }
    const file=action==='database'?result.path:result.file;
    // Client checks suffix + encrypted magic and Graph confirms exact byte size.
    await runUploader(file);
    return {action,confirmed:true,bytes:result.encryptedBytes||result.bytes,
      rows:result.rows??null,encrypted:true};
  }finally{
    if(pool)await pool.end().catch(()=>{});
    await rm(dir,{recursive:true,force:true});
  }
}
async function main(){
  const result=await runApprovedArchive(process.argv[2]);
  console.log(JSON.stringify({status:'PASS',...result}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(()=>{console.error('Encrypted SharePoint archive failed: see restricted log');process.exitCode=1;});
}
