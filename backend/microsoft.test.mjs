import test from 'node:test';
import assert from 'node:assert/strict';
import {encrypt,decrypt,createMicrosoftApi} from './microsoft.mjs';

const env={
  CV_PUBLIC_URL:'https://chargevisor-business-demo.onrender.com',
  CV_MS_TENANT_ID:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  CV_MS_CLIENT_ID:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  CV_MS_CLIENT_SECRET:'only-for-local-test',
  CV_MS_ALLOWED_SENDER:'sender@example.com',
  CV_MS_ENCRYPTION_KEY:Buffer.alloc(32,42).toString('base64')
};
function response(){
  const output={status:0,headers:{},body:null};
  return {...output,get status(){return output.status;},get headers(){return output.headers;},get body(){return output.body;},
    writeHead(status,headers){output.status=status;output.headers=headers;},
    end(data){if(data)output.body=JSON.parse(data);}};
}
test('AES-GCM secrets require valid key and authenticate contents',()=>{
  const key=Buffer.alloc(32,42),other=Buffer.alloc(32,43),plaintext='a-fake-refresh-token';
  const first=encrypt(plaintext,key),second=encrypt(plaintext,key);
  assert.notEqual(first,second);
  assert.equal(decrypt(first,key),plaintext);
  assert.throws(()=>decrypt(first,other));
  assert.throws(()=>encrypt(plaintext,Buffer.alloc(16)));
});
test('Microsoft connect is unavailable without private database',async()=>{
  const api=createMicrosoftApi(env,{pool:null,getActor:async()=>({role:'superadmin'})});
  const r=response();
  await api.handle({method:'GET'},r,'/api/microsoft/connect');
  assert.equal(r.status,503);
});
test('Microsoft callback does not exchange a code while database is unavailable',async()=>{
  const api=createMicrosoftApi(env,{pool:null,getActor:async()=>({role:'superadmin'})});
  const r=response();
  await api.handle({method:'GET'},r,'/api/microsoft/callback');
  assert.equal(r.status,302);
  assert.equal(r.headers.Location,'/login?mail=not-ready');
});
test('Tenant administrators cannot connect a Microsoft mailbox',async()=>{
  const api=createMicrosoftApi(env,{pool:{query:async()=>{throw Error('must not touch database')}},getActor:async()=>({role:'admin',id:'x'})});
  const r=response();
  await api.handle({method:'GET'},r,'/api/microsoft/connect');
  assert.equal(r.status,403);
});
test('Valid superadmin OAuth redirects with PKCE, offline access, and delegated Mail.Send',async()=>{
  const queries=[];
  const api=createMicrosoftApi(env,{pool:{query:async(s,values)=>{queries.push({s,values});return {rowCount:1,rows:[]}}},getActor:async()=>({role:'superadmin',id:'a'})});
  const r=response();
  await api.handle({method:'GET'},r,'/api/microsoft/connect');
  assert.equal(r.status,302);
  const url=new URL(r.headers.Location);
  assert.equal(url.pathname,'/'+env.CV_MS_TENANT_ID+'/oauth2/v2.0/authorize');
  assert.match(url.searchParams.get('scope'),/offline_access/);
  assert.match(url.searchParams.get('scope'),/Mail.Send/);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('redirect_uri'),env.CV_PUBLIC_URL+'/api/microsoft/callback');
  assert.ok(queries.find(x=>/INSERT INTO cv_ms_oauth_states/.test(x.s)));
});