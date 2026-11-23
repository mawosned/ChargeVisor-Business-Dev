import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptArchive} from './database-archive.mjs';
import {extractSessionSnapshot} from './decrypt-session-snapshot.mjs';

test('authenticated local .cvcsv extraction, no overwrite and no leaked output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cv-csv-extract-test-'));
  const key=randomBytes(32), wrongKey=randomBytes(32);
  const archive=join(dir,'sample.cvcsv'), output=join(dir,'local.csv');
  const plain=Buffer.from('\uFEFF"session_id";"kwh"\r\n"1";"1.25"\r\n','utf8');
  try{
    await encryptArchive(Readable.from([plain]),archive,key);
    const result=await extractSessionSnapshot(archive,output,key);
    assert.equal(result.verified,true);
    assert.deepEqual(await readFile(output),plain);
    await assert.rejects(()=>extractSessionSnapshot(archive,output,key),e=>e.code==='EEXIST');
    assert.deepEqual(await readFile(output),plain);
    const badDest=join(dir,'wrong.csv');
    await assert.rejects(()=>extractSessionSnapshot(archive,badDest,wrongKey),/authentication failed/);
    await assert.rejects(()=>readFile(badDest),'ENOENT');
    const alternate=join(dir,'protected.csv');
    await writeFile(alternate,'DO NOT TOUCH');
    await assert.rejects(()=>extractSessionSnapshot(archive,alternate,key),e=>e.code==='EEXIST');
    assert.equal(await readFile(alternate,'utf8'),'DO NOT TOUCH');
  }finally{await rm(dir,{recursive:true,force:true});}
});
