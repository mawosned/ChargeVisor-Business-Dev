import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const js=readFileSync(new URL('../app-live.js',import.meta.url),'utf8');
const trailer='  init();\n})();';
assert.ok(js.includes(trailer),'ChargeVisor test hooks must never change production code');
const injected=js.replace(trailer,`  globalThis.testPointControls = function (c){
    const stationId='station-01',identity='CP-TEST-01',id=c.id||'point-01';
    db.stations=[{id:stationId,isSimulator:!!c.isSimulator,topology:'shared'}];
    const point={id,stationId,connectorNumber:c.connector||1,ocppId:identity,disabled:!!c.disabled};
    db.chargers=[point];
    db.ocpp=[{identity,station_id:stationId,connected:c.connected!==false,simulated:false}];
    db.ocppConnectors=[{identity,station_id:stationId,connector_id:point.connectorNumber,status:c.ocppStatus}];
    db.transactions=c.active?[{point_id:id,remote_paused:!!c.paused}]:[];
    state.role='super';account={canControlCharging:true};
    return {status:deviceStatus(point),html:pointControls(point,deviceStatus(point))};
  };
})();`);
const ctx={};
runInNewContext(injected,ctx);
const rendered=c=>ctx.testPointControls(c);
const buttons=html=>[...html.matchAll(/data-ocpp-control="([^"]+)"/g)].map(m=>m[1]);

test('Connected vehicle with no transaction gets Play, including physical Lumina Finishing',()=>{
  for(const status of ['Preparing','SuspendedEV','SuspendedEVSE','Finishing']){
    const r=rendered({ocppStatus:status});
    assert.deepEqual(buttons(r.html),['start'],status);
  }
});

test('Charging shows ONLY Pause; not Stop or Play, even if remote_paused DB flag is stale',()=>{
  for(const paused of [false,true]){
    const r=rendered({ocppStatus:'Charging',active:true,paused});
    assert.equal(r.status,'Lädt');
    assert.deepEqual(buttons(r.html),['pause']);
  }
});

test('Backend-paused suspended transaction shows Play and Stop, never Pause',()=>{
  for(const status of ['SuspendedEV','SuspendedEVSE']){
    const r=rendered({ocppStatus:status,active:true,paused:true});
    assert.equal(r.status,'Pausiert');
    assert.deepEqual(buttons(r.html),['start','stop']);
  }
});

test('EV-suspended but not remotely paused session cannot show a fake Play',()=>{
  for(const status of ['SuspendedEV','SuspendedEVSE','Preparing']){
    assert.deepEqual(buttons(rendered({ocppStatus:status,active:true}).html),['pause']);
  }
});

test('Available, disconnected, disabled or simulation-only points have no controls',()=>{
  for(const c of [{ocppStatus:'Available'},{ocppStatus:'Preparing',connected:false},
    {ocppStatus:'Preparing',disabled:true},{ocppStatus:'Preparing',isSimulator:true}]){
    assert.deepEqual(buttons(rendered(c).html),[],JSON.stringify(c));
  }
});

test('An inconsistent active transaction still has an explicit safe Stop recovery',()=>{
  assert.deepEqual(buttons(rendered({ocppStatus:'Finishing',active:true}).html),['stop']);
});

test('Read-only diagnostic is an explicit Superadmin action and never runs from pollLive',()=>{
  assert.match(js,/data-read-composite/);
  assert.match(js,/state\.role!=='super'/);
  assert.match(js,/\/api\/ocpp\/composite-schedule/);
  const poll=js.substring(js.indexOf('async function pollLive()'),js.indexOf('async function init()'));
  assert.doesNotMatch(poll,/readCompositeSchedule|composite-schedule/);
});
