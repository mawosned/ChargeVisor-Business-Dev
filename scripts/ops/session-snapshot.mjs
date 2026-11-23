// Read-only full snapshot of completed REAL charging sessions.
// Full database restore remains the primary recovery path.
// CSV archive uses the existing authenticated AES-256-GCM CVBKP001 format,
// with distinct .cvcsv extension. Do not treat it as a PostgreSQL dump.
import {createReadStream,createWriteStream} from 'node:fs';
import {stat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {join} from 'node:path';
import {encryptArchive,decryptArchiveToFile} from './database-archive.mjs';
import {csvHeader,csvTransaction} from './csv-session-format.mjs';

export const SESSION_PAGE_SQL=`
SELECT t.id::text AS id,t.tenant_id::text AS tenant_id,t.identity,
       t.connector_id::text AS connector_id,
       to_char(t.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
       to_char(t.stopped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS stopped_at,
       t.meter_start_wh::text AS meter_start_wh,t.meter_stop_wh::text AS meter_stop_wh,
       CASE WHEN t.meter_stop_wh>=t.meter_start_wh
         THEN round((t.meter_stop_wh-t.meter_start_wh)/1000,3)::text
         ELSE NULL END AS energy_kwh,
       t.stop_reason, t.signed_meter::text AS signed_meter
FROM cv_ocpp_transactions t
WHERE t.simulated IS FALSE AND t.stopped_at IS NOT NULL AND t.id>$1::bigint
ORDER BY t.id ASC LIMIT $2::int`;

async function writeChunk(stream,text){
  if(!stream.write(text))await once(stream,'drain');
}
export async function writeCompletedSessionsCSV(pool,path,{pageSize=1000}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>10000)
    throw Error('Invalid page size');
  const client=await pool.connect();
  let started=false;
  const output=createWriteStream(path,{flags:'wx',mode:0o600});
  let records=0,lastId='0';
  try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started=true;
    await writeChunk(output,csvHeader());
    for(;;){
      const result=await client.query(SESSION_PAGE_SQL,[lastId,pageSize]);
      if(!Array.isArray(result.rows))throw Error('Unexpected PostgreSQL result');
      for(const row of result.rows){
        if(!/^\d+$/.test(String(row.id)) || BigInt(row.id)<=BigInt(lastId))
          throw Error('Session cursor did not advance');
        await writeChunk(output,csvTransaction(row));
        lastId=String(row.id);
        records++;
      }
      if(result.rows.length<pageSize)break;
    }
    output.end();
    await finished(output);
    await client.query('COMMIT');
    started=false;
    return {records,lastId};
  }catch(error){
    output.destroy();
    if(started)await client.query('ROLLBACK').catch(()=>{});
    await unlink(path).catch(()=>{});
    throw error;
  }finally{client.release();}
}
async function sha256File(filename){
  const hash=createHash('sha256');
  for await(const part of createReadStream(filename))hash.update(part);
  return hash.digest('hex');
}
export async function createEncryptedSessionSnapshot({pool,privateDir,key}){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Missing 32-byte archive key');
  const id=new Date().toISOString().replace(/[:.]/g,'-');
  const raw=join(privateDir,'chargevisor-sessions-'+id+'.csv');
  const output=join(privateDir,'chargevisor-sessions-'+id+'.cvcsv');
  const check=join(privateDir,'chargevisor-sessions-check-'+id+'.csv');
  try{
    const stats=await writeCompletedSessionsCSV(pool,raw);
    await encryptArchive(createReadStream(raw),output,key);
    await decryptArchiveToFile(output,check,key);
    const [originalHash,checkHash]=await Promise.all([sha256File(raw),sha256File(check)]);
    if(originalHash!==checkHash)throw Error('Encrypted session snapshot failed read-back check');
    return {file:output,rows:stats.records,bytes:(await stat(output)).size,verified:true};
  }catch(e){
    await unlink(output).catch(()=>{});
    throw e;
  }finally{
    await unlink(raw).catch(()=>{});
    await unlink(check).catch(()=>{});
  }
}
