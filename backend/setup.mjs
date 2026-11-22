// One-time explicit initialization on a NEW dedicated ChargeVisor database.
// Set CV_INIT_DB=1, CV_BOOTSTRAP_EMAIL and CV_BOOTSTRAP_PASSWORD once, then remove.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {hashPassword} from './auth.mjs';
const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v||'');
export async function setup(env=process.env){
  if(env.CV_INIT_DB!=='1')return {initialized:false};
  if(!env.CV_DATABASE_URL)throw new Error('CV_DATABASE_URL must point to a DEDICATED ChargeVisor database');
  const pool=new Pool({connectionString:env.CV_DATABASE_URL,max:2,connectionTimeoutMillis:5000});
  try{
    const sql=await readFile(fileURLToPath(new URL('./schema.sql',import.meta.url)),'utf8');
    await pool.query(sql);
    const found=await pool.query("SELECT id FROM cv_users WHERE role='superadmin' LIMIT 1");
    if(found.rowCount)return {initialized:true,createdSuperadmin:false};
    const mail=(env.CV_BOOTSTRAP_EMAIL||'').trim().toLowerCase();
    const password=env.CV_BOOTSTRAP_PASSWORD;
    if(!validEmail(mail)||!password||password.length<16)
      throw new Error('Initial superadmin requires CV_BOOTSTRAP_EMAIL and a 16+ character CV_BOOTSTRAP_PASSWORD');
    const hash=await hashPassword(password);
    await pool.query("INSERT INTO cv_users(id,email,name,role,password_hash) VALUES($1,$2,$3,'superadmin',$4)",
      [randomUUID(),mail,'Walectra Superadmin',hash]);
    return {initialized:true,createdSuperadmin:true};
  }finally{await pool.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  setup().then(r=>{console.log('ChargeVisor database setup:',JSON.stringify(r));})
    .catch(e=>{console.error('Setup failed:',e.message);process.exitCode=1;});
}
