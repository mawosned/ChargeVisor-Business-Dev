// ChargeVisor Business disaster recovery: locally encrypted PostgreSQL backups.
// No production data is ever uploaded to GitHub, Render build artifacts or logs.
// Requires pg_dump / pg_restore (matching or newer major version than server).
// BACKUP: node scripts/ops/database-archive.mjs backup /private/backups
// VERIFY: node scripts/ops/database-archive.mjs verify /private/backups/<file>.cvbak
// RESTORE: CV_RESTORE_CONFIRM=RESTORE_TO_EMPTY_ISOLATED_DATABASE \
//          CV_RESTORE_TARGET_URL=postgresql://.../chargevisor_restorecheck \
//          node scripts/ops/database-archive.mjs restore /private/backups/<file>.cvbak
// Restore refuses real/customer DB names, refuses populated databases,
// and cannot automatically mutate the production database.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,stat,mkdir,chmod,unlink,mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const MAGIC=Buffer.from('CVBKP001','ascii');
const IV_LENGTH=12;
const TAG_LENGTH=16;
const HEADER_LENGTH=MAGIC.length+IV_LENGTH;
const HEX=/^[0-9a-f]{64}$/i;
const RESTORE_DB=/^chargevisor_restorecheck(?:_[a-z0-9_]{1,36})?$/;

export function keyFromEnv(env=process.env){
  if(!HEX.test(env.CV_BACKUP_KEY_HEX||''))
    throw Error('CV_BACKUP_KEY_HEX must be an operator-held 32-byte hexadecimal secret');
  return Buffer.from(env.CV_BACKUP_KEY_HEX,'hex');
}
export function pgConnectionEnv(value,baseEnv=process.env){
  if(!value)throw Error('Database URL is required');
  let u;
  try{u=new URL(value);}catch{throw Error('Invalid database URL');}
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||
     !u.pathname||u.pathname==='/')throw Error('PostgreSQL URL with a database name required');
  const sslmode=u.searchParams.get('sslmode');
  if(sslmode&&!['require','verify-ca','verify-full','disable','prefer'].includes(sslmode))
    throw Error('Invalid PostgreSQL SSL mode');
  const dbname=decodeURIComponent(u.pathname.slice(1));
  if(!/^[a-zA-Z0-9_-]{1,63}$/.test(dbname))
    throw Error('Invalid database name');
  const env={...baseEnv,
    PGHOST:u.hostname,PGPORT:u.port||'5432',
    PGDATABASE:dbname,PGUSER:decodeURIComponent(u.username||''),
    PGPASSWORD:decodeURIComponent(u.password||'')
  };
  if(sslmode)env.PGSSLMODE=sslmode;
  // URL including credentials is never used as a subprocess argument.
  return {env,dbname,host:u.hostname,port:u.port||'5432'};
}
async function runClient(binary,args,env,{stdout,stderrLimit=1024}={}){
  const child=spawn(binary,args,{env,stdio:['ignore',stdout?'pipe':'ignore','pipe']});
  let stderr='';
  child.stderr.on('data',x=>{stderr=(stderr+x.toString('utf8')).slice(-stderrLimit);});
  const result=new Promise((resolve,reject)=>{
    child.once('error',e=>reject(Error(binary+' could not launch: '+e.code)));
    child.once('close',code=>code===0?resolve():
      reject(Error(binary+' returned exit code '+code+
        (stderr.includes('permission denied')?' (permissions)':''))));
  });
  if(stdout){
    try{await pipeline(child.stdout,stdout);}
    catch(e){child.kill('SIGKILL');await result.catch(()=>{});throw e;}
  }
  await result;
}
export async function encryptArchive(inputStream,destination,key,iv=randomBytes(IV_LENGTH)){
  if(iv.length!==IV_LENGTH)throw Error('Invalid initialization vector');
  const file=await open(destination,'wx',0o600);
  try{await file.write(Buffer.concat([MAGIC,iv]));}
  finally{await file.close();}
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  await pipeline(inputStream,cipher,createWriteStream(destination,{flags:'a'}));
  const fd=await open(destination,'a');
  try{await fd.write(cipher.getAuthTag());await fd.sync();}
  finally{await fd.close();}
  await chmod(destination,0o600);
}
export async function decryptArchiveToFile(source,dest,key){
  const fd=await open(source,'r');
  let size,header,tag;
  try{
    const details=await fd.stat();
    size=details.size;
    if(size<=HEADER_LENGTH+TAG_LENGTH)throw Error('Backup truncated');
    header=Buffer.alloc(HEADER_LENGTH);tag=Buffer.alloc(TAG_LENGTH);
    if((await fd.read(header,0,HEADER_LENGTH,0)).bytesRead!==HEADER_LENGTH||
       (await fd.read(tag,0,TAG_LENGTH,size-TAG_LENGTH)).bytesRead!==TAG_LENGTH)
      throw Error('Backup incomplete');
  }finally{await fd.close();}
  if(!header.subarray(0,MAGIC.length).equals(MAGIC))
    throw Error('Unrecognized ChargeVisor backup format');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  try{
    // File must be absent before use. The caller supplies a private temp path.
    await pipeline(
      createReadStream(source,{start:HEADER_LENGTH,end:size-TAG_LENGTH-1}),
      decipher,createWriteStream(dest,{flags:'wx',mode:0o600})
    );
  }catch{
    await unlink(dest).catch(()=>{});
    throw Error('Backup authentication failed: wrong key or modified/corrupted archive');
  }
  return size;
}
export async function verifyArchive(archive,key){
  const temp=await mkdtemp(join(tmpdir(),'cv-backup-verify-'));
  await chmod(temp,0o700);
  try{
    const plain=join(temp,'verified.dump');
    const length=await decryptArchiveToFile(archive,plain,key);
    const stats=await stat(plain);
    if(stats.size<100)throw Error('Archive contains no PostgreSQL custom dump');
    const fd=await open(plain,'r');
    let first=Buffer.alloc(5);
    try{await fd.read(first,0,5,0);}finally{await fd.close();}
    if(first.toString('ascii')!=='PGDMP')throw Error('Decrypted content is not a pg_dump custom archive');
    return {archiveBytes:length,dumpBytes:stats.size};
  }finally{await rm(temp,{recursive:true,force:true});}
}
export async function createBackup({
  databaseUrl,backupDir,key,pgDumpBinary='pg_dump',env=process.env
}){
  const db=pgConnectionEnv(databaseUrl,env);
  const base=resolve(backupDir);
  await mkdir(base,{recursive:true,mode:0o700});
  const dir=await stat(base);
  if(!dir.isDirectory())throw Error('Backup destination must be a private directory');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=join(base,'cv-'+stamp+'-'+randomBytes(5).toString('hex')+'.cvbak');
  const child=spawn(pgDumpBinary,['--format=custom','--no-owner','--no-acl'],
    {env:db.env,stdio:['ignore','pipe','pipe']});
  let stderr='';
  child.stderr.on('data',x=>{stderr=(stderr+x.toString('utf8')).slice(-2000);});
  const proc=new Promise((ok,fail)=>{
    child.once('error',e=>fail(Error('pg_dump unavailable: '+e.code)));
    child.once('close',code=>code===0?ok():fail(Error('pg_dump failed with exit '+code)));
  });
  try{
    await encryptArchive(child.stdout,backup,key);
    await proc;
    await verifyArchive(backup,key); // read back and authenticate before PASS
    const bytes=(await stat(backup)).size;
    return {path:backup,encryptedBytes:bytes,createdAt:new Date().toISOString(),verified:true};
  }catch(e){
    child.kill('SIGKILL');
    await proc.catch(()=>{});
    await unlink(backup).catch(()=>{});
    throw e;
  }
}
export async function restoreIntoEmptyDatabase({
  backup,targetUrl,key,confirm,pgRestoreBinary='pg_restore',env=process.env
}){
  if(confirm!=='RESTORE_TO_EMPTY_ISOLATED_DATABASE')
    throw Error('Restore requires explicit isolated-database confirmation');
  const target=pgConnectionEnv(targetUrl,env);
  if(!RESTORE_DB.test(target.dbname))
    throw Error('Refusing to restore to anything except chargevisor_restorecheck[_name]');
  if(!['localhost','127.0.0.1','::1'].includes(target.host))
    throw Error('Only local disposable restore databases permitted in this tested command');
  const pool=new pg.Pool({connectionString:targetUrl,max:1,connectionTimeoutMillis:5000});
  try{
    const check=await pool.query(
      "SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')"
    );
    if(check.rows[0].n!==0)throw Error('Refusing to overwrite an existing populated database');
  }finally{await pool.end();}
  const dir=await mkdtemp(join(tmpdir(),'cv-restore-'));
  await chmod(dir,0o700);
  const plain=join(dir,'verified.dump');
  try{
    await decryptArchiveToFile(backup,plain,key);
    await runClient(pgRestoreBinary,
      ['--exit-on-error','--single-transaction','--no-owner','--no-acl',
       '--dbname='+target.dbname,plain],
      target.env);
    return {restored:true,database:target.dbname};
  }finally{await rm(dir,{recursive:true,force:true});}
}
async function main(){
  const [action,arg]=process.argv.slice(2);
  const key=keyFromEnv();
  if(action==='backup'){
    if(!arg)throw Error('Usage: backup <private-directory>');
    const result=await createBackup({
      databaseUrl:process.env.CV_DATABASE_URL,backupDir:arg,key
    });
    console.log(JSON.stringify({action,status:'PASS',verified:true,
      file:basename(result.path),encryptedBytes:result.encryptedBytes}));
  }else if(action==='verify'){
    if(!arg)throw Error('Usage: verify <encrypted-archive>');
    console.log(JSON.stringify({action,status:'PASS',...(await verifyArchive(arg,key))}));
  }else if(action==='restore'){
    if(!arg)throw Error('Usage: restore <encrypted-archive>');
    const out=await restoreIntoEmptyDatabase({
      backup:arg,targetUrl:process.env.CV_RESTORE_TARGET_URL,key,
      confirm:process.env.CV_RESTORE_CONFIRM
    });
    console.log(JSON.stringify({action,status:'PASS',...out}));
  }else throw Error('Usage: backup|verify|restore <directory-or-archive>');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(e=>{console.error('ChargeVisor backup/restore FAILED:',e.message);process.exitCode=1;});
}
