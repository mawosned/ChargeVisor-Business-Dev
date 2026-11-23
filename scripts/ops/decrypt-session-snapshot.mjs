#!/usr/bin/env node
// Offline authenticated extraction of a .cvcsv archive to a protected local CSV.
// Existing destinations are NEVER overwritten or deleted, even on wrong keys.
import {stat,open,chmod,mkdtemp,rm,link} from 'node:fs/promises';
import {resolve,extname,dirname,join} from 'node:path';
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
  // Stage on the SAME filesystem and link atomically without replacing a file.
  // The generic decrypt helper may clean its own partial output on any error,
  // so NEVER point it directly to a user-supplied existing destination.
  const folder=await mkdtemp(join(dirname(output),'.cv-session-extract-'));
  await chmod(folder,0o700);
  const staged=join(folder,'snapshot.csv');
  try{
    await decryptArchiveToFile(input,staged,key);
    const file=await open(staged,'r');
    try{
      const prefix=Buffer.alloc(3);
      await file.read(prefix,0,3,0);
      if(!prefix.equals(Buffer.from([0xef,0xbb,0xbf])))
        throw Error('Authenticated content is not a ChargeVisor CSV snapshot');
    }finally{await file.close();}
    await chmod(staged,0o600);
    await link(staged,output); // EEXIST is intentional: never overwrite.
    return {bytes:(await stat(output)).size,verified:true};
  }finally{await rm(folder,{recursive:true,force:true});}
}
async function main(){
  if(process.argv.length!==4)throw Error('Usage: encrypted.cvcsv local.csv');
  await extractSessionSnapshot(process.argv[2],process.argv[3],keyFromEnv());
  console.log('Encrypted session snapshot authenticated and extracted to local CSV.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(()=>{console.error('Session extraction FAILED: check archive, key and destination');process.exitCode=1;});
}
