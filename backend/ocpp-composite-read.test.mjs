import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCompositeSchedule} from './ocpp-composite-read.mjs';
import {createOcppApi} from './ocpp.mjs';
import {readFileSync} from 'node:fs';

const TENANT='11111111-1111-4111-8111-111111111111';
const POINT='22222222-2222-4222-8222-222222222222';
const ORIGIN='https://chargevisor.dev.example';
const endpoint='/api/ocpp/composite-schedule';

test('A reported 12 A schedule is exposed as a measured limit, NOT its origin',()=>{
  const r=summarizeCompositeSchedule({
    status:'Accepted',duration:300,scheduleStart:'2026-11-23T19:00:00Z',
    chargingSchedule:{chargingRateUnit:'A',chargingSchedulePeriod:[
      {startPeriod:0,limit:12,numberPhases:1},
      {startPeriod:120,limit:16,numberPhases:1}
    ]}
  });
  assert.equal(r.status,'Accepted');
  assert.equal(r.reported,true);
  assert.equal(r.unit,'A');
  assert.deepEqual(r.periods.map(x=>x.limit),[12,16]);
  assert.match(r.note,/nicht bewiesen/);
});

test('Rejected or empty composite replies do not fabricate 16A',()=>{
  for(const r of [{status:'Rejected'},{status:'Accepted'}]){
    const data=summarizeCompositeSchedule(r);
    assert.equal(data.reported,false);
    assert.equal(data.periods.length,0);
  }
});

test('Watt schedules must be preserved without assuming voltage or phases',()=>{
  const r=summarizeCompositeSchedule({status:'Accepted',
    chargingSchedule:{chargingRateUnit:'W',
      chargingSchedulePeriod:[{startPeriod:0,limit:2800}]}});
  assert.equal(r.unit,'W');
  assert.equal(r.periods[0].limit,2800);
  assert.equal(r.periods[0].numberPhases,null);
});

test('Unsafe or malformed schedule values are rejected',()=>{
  for(const limit of [-1,NaN,'12',1000001]){
    assert.throws(()=>summarizeCompositeSchedule({status:'Accepted',
      chargingSchedule:{chargingRateUnit:'A',chargingSchedulePeriod:[{startPeriod:0,limit}]}}));
  }
});

function request(actor,body,{origin=ORIGIN,method='POST'}={}){
  const pool={
    reads:[],
    async query(sql,args){
      this.reads.push({sql,args});
      if(sql.includes('SELECT p.* FROM cv_chargepoints'))
        return {rows:[{id:POINT,tenant_id:TENANT,connector_number:1,ocpp_identity:'CV-REAL-LUMINA',
          station_id:'33333333-3333-4333-8333-333333333333'}],rowCount:1};
      throw Error('Unexpected SQL: '+sql);
    }
  };
  let calls=0;
  const bridge={
    async readCompositeSchedule(point){
      calls+=1;
      return {code:200,connectorId:point.connector_number,
        diagnostic:{status:'Accepted',reported:true,unit:'A',
        periods:[{startSecond:0,limit:12,numberPhases:1}]}};
    }
  };
  const api=createOcppApi({pool,getActor:async()=>actor,bridge,
    env:{CV_PUBLIC_URL:ORIGIN}});
  const req={
    method,url:endpoint,actor,
    headers:{origin,'content-type':'application/json'},
    async *[Symbol.asyncIterator](){
      if(body!==undefined)yield Buffer.from(JSON.stringify(body));
    }
  };
  const res={status:null,payload:null,
    writeHead(status){this.status=status;},
    end(text){this.payload=text?JSON.parse(text):null;}};
  return {call:async()=>{await api(req,res,endpoint);return {res,calls,reads:pool.reads};}};
}

test('Read-only schedule requires superadmin, valid selected point and same origin',async()=>{
  const input={tenantId:TENANT,pointId:POINT};
  let {res,calls,reads}=await request({role:'admin',tenant_id:TENANT},input).call();
  assert.equal(res.status,403);assert.equal(calls,0);assert.equal(reads.length,0);
  ({res,calls}=await request({role:'superadmin'},input,{origin:'https://evil.test'}).call());
  assert.equal(res.status,403);assert.equal(calls,0);
  ({res,calls}=await request({role:'superadmin'},{tenantId:TENANT,pointId:'bad'}).call());
  assert.equal(res.status,400);assert.equal(calls,0);
  ({res,calls,reads}=await request({role:'superadmin'},input).call());
  assert.equal(res.status,200);assert.equal(calls,1);
  assert.equal(res.payload.diagnostic.periods[0].limit,12);
  assert.equal(reads.length,1);
  assert.match(reads[0].sql,/NOT s\.is_simulator/);
});

test('Diagnostic OCPP path never calls SetChargingProfile, ClearChargingProfile or changes data',()=>{
  const code=readFileSync(new URL('./ocpp.mjs',import.meta.url),'utf8');
  const section=code.substring(code.indexOf('  async function readCompositeSchedule('),
    code.indexOf('  async function control('));
  assert.match(section,/sendCommand\(ctx,'GetCompositeSchedule'/);
  assert.doesNotMatch(section,/SetChargingProfile|ClearChargingProfile|UPDATE |INSERT |DELETE /);
  assert.match(code,/\['Preparing','SuspendedEV','SuspendedEVSE','Finishing'\]/);
  assert.match(code,/command==='pause'&&tx/);
});
