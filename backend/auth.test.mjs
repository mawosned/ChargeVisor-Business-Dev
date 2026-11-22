import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,createAuthApi,updateUserPointAccess} from './auth.mjs';

test('scrypt hash uses random salts and verifies correctly',async()=>{
  const password='Test-Password-Change-Me-2026!';
  const first=await hashPassword(password);
  const second=await hashPassword(password);
  assert.notEqual(first,second);
  assert.equal(await verifyPassword(password,first),true);
  assert.equal(await verifyPassword('not-the-password',first),false);
  assert.equal(await verifyPassword(password,'invalid'),false);
});
test('short passwords rejected',async()=>{
  await assert.rejects(hashPassword('123456789'),/12 Zeichen/);
});
function makeResponse(){
  const result={status:null,body:null,headers:null};
  return {result,writeHead(status,headers){result.status=status;result.headers=headers;},
    end(value){result.body=JSON.parse(value);}};
}
test('missing database disables login (no fake success)',async()=>{
  const api=await createAuthApi({});
  assert.equal(api.ready(),false);
  const r1=makeResponse();
  await api.handle({method:'GET',headers:{}},r1,'/api/auth/status');
  assert.equal(r1.result.status,200);
  assert.equal(r1.result.body.ready,false);
  const r2=makeResponse();
  await api.handle({method:'POST',headers:{}},r2,'/api/auth/login');
  assert.equal(r2.result.status,503);
  await api.close();
});
const tenant='44444444-4444-4444-8444-444444444444';
const uid='55555555-5555-4555-8555-555555555555';
const p1='11111111-1111-4111-8111-111111111111';
const p2='22222222-2222-4222-8222-222222222222';
function accessDb(){
  const points=new Map([[p1,'Stellplatz 1'],[p2,'Stellplatz 2']]);
  const assigned=new Set([p1]), queries=[];
  return {assigned,points,queries,async query(sql,params=[]){
    queries.push({sql,params});
    if(sql.startsWith('SELECT id,name FROM cv_chargepoints')){
      const rows=(params[1]??[...points.keys()]).filter(id=>points.has(id)&&params[0]===tenant)
        .map(id=>({id,name:points.get(id)}));
      return {rows,rowCount:rows.length};
    }
    if(sql.startsWith('INSERT INTO cv_point_access')){
      const rows=[];
      for(const id of params[2])if(!assigned.has(id)&&points.has(id)&&params[1]===tenant){
        assigned.add(id);rows.push({chargepoint_id:id});
      }
      return {rows,rowCount:rows.length};
    }
    if(sql.startsWith('DELETE FROM cv_point_access')){
      const rows=[];
      for(const id of [...assigned])if(!params[2].includes(id)){assigned.delete(id);rows.push({chargepoint_id:id});}
      return {rows,rowCount:rows.length};
    }
    throw Error('Unexpected SQL '+sql);
  }};
}
test('A registered user can receive another point without losing the existing one',async()=>{
  const db=accessDb();
  const result=await updateUserPointAccess(db,{tenantId:tenant,userId:uid,pointIds:[p2],replace:false});
  assert.deepEqual([...db.assigned].sort(),[p1,p2].sort());
  assert.equal(result.added,1);
  assert.deepEqual(result.addedNames,['Stellplatz 2']);
  assert.equal(result.removed,0);
  assert.equal(db.queries.some(x=>x.sql.startsWith('DELETE FROM cv_point_access')),false);
});
test('Repeated assignment is idempotent, so no duplicate email notification is needed',async()=>{
  const db=accessDb();
  const result=await updateUserPointAccess(db,{tenantId:tenant,userId:uid,pointIds:[p1],replace:false});
  assert.equal(result.added,0);
  assert.deepEqual(result.addedNames,[]);
  assert.equal(db.assigned.size,1);
});
test('Batch management replaces point access and can revoke assignments',async()=>{
  const db=accessDb();
  const result=await updateUserPointAccess(db,{tenantId:tenant,userId:uid,pointIds:[p2],replace:true});
  assert.equal(result.added,1);
  assert.equal(result.removed,1);
  assert.deepEqual([...db.assigned],[p2]);
});
test('Cross-tenant point ID is rejected rather than assigned',async()=>{
  const db=accessDb();
  await assert.rejects(updateUserPointAccess(db,{
    tenantId:'99999999-9999-4999-8999-999999999999',userId:uid,pointIds:[p1],replace:false
  }),/gehört nicht zu diesem Kunden/);
  assert.equal(db.assigned.has(p1),true);
  assert.equal(db.queries.some(x=>x.sql.startsWith('INSERT INTO cv_point_access')),false);
});
test('Invalid or repeated point IDs never grant access',async()=>{
  const db=accessDb();
  await assert.rejects(updateUserPointAccess(db,{tenantId:tenant,userId:uid,pointIds:[p2,p2]}),/Ungültige|gültigen Ladepunkt/);
  await assert.rejects(updateUserPointAccess(db,{tenantId:tenant,userId:uid,pointIds:['not-a-uuid']}),/Ungültige|gültigen Ladepunkt/);
});
test('All points snapshots enabled tenant points without the explicit selection limit',async()=>{
  const db=accessDb();
  for(let index=3;index<=60;index++){
    const id='00000000-0000-4000-8000-'+String(index).padStart(12,'0');
    db.points.set(id,'Stellplatz '+index);
  }
  const result=await updateUserPointAccess(db,{tenantId:tenant,userId:uid,allPoints:true,replace:true});
  assert.equal(result.added,59);
  assert.equal(db.assigned.size,60);
  const allPointsQuery=db.queries.find(x=>x.sql.startsWith('SELECT id,name FROM cv_chargepoints'));
  assert.match(allPointsQuery.sql,/tenant_id=\$1 AND enabled=true/);
  assert.deepEqual(allPointsQuery.params,[tenant]);
  const later='00000000-0000-4000-8000-000000000061';
  db.points.set(later,'Neuer Stellplatz');
  assert.equal(db.assigned.has(later),false);
});
