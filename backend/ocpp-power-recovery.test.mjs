import test from 'node:test';
import assert from 'node:assert/strict';
import {createOcppApi} from './ocpp.mjs';
import {getPowerRecoveryStatus} from './ocpp-power-recovery.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const USER='22222222-2222-4222-8222-222222222222';
const TX={transaction_id:123,identity:'CV-PHYSICAL-1',connector_id:1,
  chargepoint_id:'33333333-3333-4333-8333-333333333333',
  started_at:'2026-11-23T08:00:00Z',meter_start_wh:2000,meter_last_wh:2315,
  connected:false,last_connection_event:'2026-11-23T08:05:00Z',
  station_name:'WEG Tiefgarage',point_name:'Platz 1',firmware:'1.0.0'};

test('Power loss is NEVER inferred from OCPP WebSocket disconnect; open session is unbilled',async()=>{
  const queries=[];
  const pool={async query(sql,args){queries.push({sql,args});return {rows:[TX]};}};
  const report=await getPowerRecoveryStatus(pool,{role:'admin',id:USER,tenant_id:TENANT},TENANT);
  assert.equal(report.openSessions.length,1);
  assert.equal(report.openSessions[0].connected,false);
  assert.equal(report.openSessions[0].recovery,'awaiting_stop_transaction');
  assert.equal(report.openSessions[0].billingState,'unconfirmed');
  assert.equal('amount_eur' in report.openSessions[0],false);
  assert.equal('price_per_kwh' in report.openSessions[0],false);
  assert.match(report.note,/nicht zwingend Stromausfall/);
  assert.ok(queries[0].sql.includes('x.stopped_at IS NULL'));
  assert.ok(queries[0].sql.includes('x.simulated=false'));
  assert.ok(queries[0].sql.includes('s.is_simulator=false'));
  assert.ok(queries[0].sql.includes('x.tenant_id=$1'));
  assert.equal(queries[0].args[0],TENANT);
  assert.equal(queries[0].args[1],null);
});

test('User read is restricted to own open transaction, never another tenant',async()=>{
  const reads=[];
  const pool={async query(sql,args){reads.push(args);return {rows:[TX]};}};
  await getPowerRecoveryStatus(pool,{role:'user',id:USER,tenant_id:TENANT},TENANT,{limit:10});
  assert.deepEqual(reads[0],[TENANT,USER,10]);
});

test('Read-only recovery API uses authenticated role tenant and rejects invalid superadmin scope',async()=>{
  const seen=[];
  const pool={async query(sql,args){seen.push(args);return {rows:[TX]};}};
  const api=createOcppApi({pool,bridge:{},getActor:async req=>req.actor,env:{}});
  async function run(actor,url){
    const res={
      writeHead(status){this.status=status;},
      end(body){this.data=JSON.parse(body);}
    };
    await api({method:'GET',url,actor,headers:{}},res,'/api/ocpp/power-recovery');
    return res;
  }
  assert.equal((await run(null,'/api/ocpp/power-recovery')).status,401);
  assert.equal((await run({role:'superadmin'},'/api/ocpp/power-recovery')).status,400);
  assert.equal((await run({role:'admin',tenant_id:TENANT},'/api/ocpp/power-recovery?tenantId=22222222-2222-4222-8222-222222222222')).status,200);
  assert.deepEqual(seen.at(-1),[TENANT,null,100]);
  assert.equal((await run({role:'admin',tenant_id:TENANT},'/api/ocpp/power-recovery?limit=999')).status,400);
});
