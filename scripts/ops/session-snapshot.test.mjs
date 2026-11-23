import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEncryptedSessionSnapshot,SESSION_PAGE_SQL} from './session-snapshot.mjs';
import {decryptArchiveToFile} from './database-archive.mjs';

function fakePool(rows){
  const calls=[];
  const client={
    async query(sql,args){
      calls.push({sql,args});
      if(sql===SESSION_PAGE_SQL){
        const start=BigInt(args[0]);
        return {rows:rows.filter(r=>BigInt(r.id)>start).slice(0,args[1])};
      }
      return {rows:[]};
    },
    release(){calls.push({sql:'RELEASE'});}
  };
  return {calls,connect:async()=>client};
}
test('session SQL is read only and excludes open and simulator transactions',()=>{
  assert.match(SESSION_PAGE_SQL,/simulated IS FALSE/);
  assert.match(SESSION_PAGE_SQL,/stopped_at IS NOT NULL/);
  assert.match(SESSION_PAGE_SQL,/ORDER BY t.id ASC/);
  assert.doesNotMatch(SESSION_PAGE_SQL,/\bDELETE\b|\bUPDATE\b|\bINSERT\b/i);
});
test('encrypts complete stable snapshot, checks GCM and never writes production DB',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cv-session-ops-'));
  const key=randomBytes(32);
  const p=fakePool([
    {id:'1',tenant_id:'t1',identity:'station-A',connector_id:'1',
      started_at:'2026-11-23T10:00:00.000Z',stopped_at:'2026-11-23T11:00:00.000Z',
      meter_start_wh:'1000',meter_stop_wh:'21000',energy_kwh:'20.000',
      stop_reason:'EVDisconnected',signed_meter:'false'},
    {id:'3',tenant_id:'t2',identity:'station-B',connector_id:'2',
      started_at:'2026-11-23T12:00:00.000Z',stopped_at:'2026-11-23T13:00:00.000Z',
      meter_start_wh:'1000',meter_stop_wh:'2000',energy_kwh:'1.000',
      stop_reason:'PowerLoss',signed_meter:'true'}
  ]);
  try{
    const o=await createEncryptedSessionSnapshot({pool:p,privateDir:dir,key});
    assert.equal(o.rows,2);
    assert.ok(o.file.endsWith('.cvcsv'));
    assert.equal(o.verified,true);
    const encrypted=await readFile(o.file);
    assert.equal(encrypted.subarray(0,8).toString(),'CVBKP001');
    assert.ok(!encrypted.includes(Buffer.from('station-A')));
    const raw=join(dir,'verify.csv');
    await decryptArchiveToFile(o.file,raw,key);
    const csv=await readFile(raw,'utf8');
    assert.ok(csv.includes('station-A'));
    assert.ok(csv.includes('station-B'));
    assert.ok(csv.includes('20.000'));
    assert.equal((csv.match(/\r\n/g)||[]).length,3);
    assert.ok(p.calls.some(x=>x.sql.includes('REPEATABLE READ READ ONLY')));
    assert.ok(p.calls.some(x=>x.sql==='COMMIT'));
    assert.ok(p.calls.some(x=>x.sql==='RELEASE'));
    assert.equal(p.calls.filter(x=>x.sql===SESSION_PAGE_SQL).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects missing encryption key without querying database',async()=>{
  const p=fakePool([]);
  await assert.rejects(()=>createEncryptedSessionSnapshot({
    pool:p,privateDir:'/tmp',key:Buffer.alloc(1)
  }),/Missing 32-byte/);
  assert.equal(p.calls.length,0);
});
