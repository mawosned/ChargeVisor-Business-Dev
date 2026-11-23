import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  keyFromEnv,pgConnectionEnv,encryptArchive,verifyArchive,
  decryptArchiveToFile,restoreIntoEmptyDatabase
} from './database-archive.mjs';

test('Backup secret must be independently supplied; never fall back to empty or weak key',()=>{
  assert.throws(()=>keyFromEnv({}),/32-byte/);
  assert.throws(()=>keyFromEnv({CV_BACKUP_KEY_HEX:'abc123'}),/32-byte/);
  assert.equal(keyFromEnv({CV_BACKUP_KEY_HEX:'b'.repeat(64)}).length,32);
});
test('Postgres subprocess receives credentials by environment, not argv',()=>{
  assert.throws(()=>pgConnectionEnv('https://wrong/any'),/PostgreSQL/);
  assert.throws(()=>pgConnectionEnv('postgresql://u:p@host/'),/database name/);
  const c=pgConnectionEnv('postgresql://testuser:secret@localhost:5432/chargevisor_ci?sslmode=require',{});
  assert.equal(c.env.PGUSER,'testuser');
  assert.equal(c.env.PGPASSWORD,'secret');
  assert.equal(c.env.PGHOST,'localhost');
  assert.equal(c.env.PGDATABASE,'chargevisor_ci');
  assert.equal(c.env.PGSSLMODE,'require');
  assert.equal(c.dbname,'chargevisor_ci');
});
test('Authenticated GCM archive rejects bit flip, missing tag, and wrong operator key',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chargevisor-ops-unit-'));
  const key=randomBytes(32),bad=randomBytes(32),filename=join(dir,'sample.cvbak');
  const raw=Buffer.concat([Buffer.from('PGDMP'),randomBytes(8192)]);
  try{
    await encryptArchive(Readable.from([raw]),filename,key);
    const stats=await verifyArchive(filename,key);
    assert.equal(stats.dumpBytes,raw.length);
    const destination=join(dir,'restored.dump');
    await decryptArchiveToFile(filename,destination,key);
    assert.deepEqual(await readFile(destination),raw);
    assert.rejects(()=>restoreIntoEmptyDatabase({
      backup:filename,targetUrl:'postgresql://u:p@127.0.0.1/customer_production',
      key,confirm:'RESTORE_TO_EMPTY_ISOLATED_DATABASE'
    }),/Refusing/);
    assert.rejects(()=>restoreIntoEmptyDatabase({
      backup:filename,targetUrl:'postgresql://u:p@localhost/chargevisor_restorecheck',
      key,confirm:'YES'
    }),/explicit/);
    await assert.rejects(()=>verifyArchive(filename,bad),/authentication failed/);
    const bytes=await readFile(filename);
    bytes[Math.floor(bytes.length/2)]^=0x01;
    const corrupted=join(dir,'corrupted.cvbak');
    await writeFile(corrupted,bytes);
    await assert.rejects(()=>verifyArchive(corrupted,key),/authentication failed/);
    const incomplete=join(dir,'short.cvbak');
    await writeFile(incomplete,bytes.subarray(0,23));
    await assert.rejects(()=>verifyArchive(incomplete,key),/truncated/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
