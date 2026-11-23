#!/usr/bin/env node
// Offline extraction of an encrypted session snapshot for an authorized operator.
// No network access; destination must not exist, and must be on an operator-only drive.
// Example: CV_BACKUP_KEY_HEX=... node scripts/ops/decrypt-session-snapshot.mjs file.cvcsv local.csv
import {stat,open,unlink,chmod} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptArchiveToFile,keyFromEnv} from './database-archive.mjs';

export async function extractSessionSnapshot(encrypted,destination,key){
  const input=resolve(encrypted),output=resolve(destination);
  if(input===output)throw Error('Input and output must be different');
  if(extname(input)!=='.cvcsv'||extname(output)!=='.csv')
    throw Error('Only encrypted .cvcsv to local .csv extraction is supported');
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Valid backup key required');
  const archive=await stat(input);
  if(!archive.isFile()||archive.size<=36)throw Error('Encrypted archive is too small');
  try{
    await decryptArchiveToFile(input,output,key);
    const file=await open(output,'r');
    try{
      const prefix=Buffer.alloc(3);
      await file.read(prefix,0,3,0);
      if(!prefix.equals(Buffer.from([0xef,0xbb,0xbf])))
        throw Error('Authenticated content is not a ChargeVisor CSV snapshot');
    }finally{await file.close();}
    await chmod(output,0o600);
    return {bytes:(await stat(output)).size,verified:true};
  }catch(error){
    // Avoid deleting a pre-existing target on a refusal (decrypt uses wx).
    if(error.message.includes('Authenticated content'))
      await unlink(output).catch(()=>{});
    throw error;
  }
}
async function main(){
  if(process.argv.length!==4)throw Error('Usage: encrypted.cvcsv local.csv');
  await extractSessionSnapshot(process.argv[2],process.argv[3],keyFromEnv());
  console.log('Encrypted session snapshot authenticated and extracted to local CSV.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(()=>{console.error('Session extraction FAILED: check archive, key and destination');process.exitCode=1;});
}
