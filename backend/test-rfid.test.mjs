import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {hashPassword} from './auth.mjs';
import {createOcppApi,createOcppBridge} from './ocpp.mjs';

const origin = 'https://chargevisor.test';
const identity = 'test-box';
const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '22222222-2222-4222-8222-222222222222';

test('Test RFID rejects unauthorized roles and foreign-origin writes before accessing the database', async () => {
  const pool = {
    query() {
      assert.fail('Unauthorized test RFID requests must not reach the database');
    },
  };
  const api = createOcppApi({pool,getActor:async req => req.actor,env:{CV_PUBLIC_URL:origin}});
  const path = '/api/ocpp/test-rfid';
  async function request(role, method, requestOrigin) {
    const req = {
      actor:{role,tenant_id:tenantId},
      method,
      url:path + '?' + new URLSearchParams({tenantId,stationId,identity}),
      headers:{origin:requestOrigin,'content-type':'application/json'},
    };
    let status;
    await api(req,{writeHead(code){status=code;},end(){}},path);
    return status;
  }
  assert.equal(await request('admin','GET',origin),403);
  assert.equal(await request('user','POST',origin),403);
  assert.equal(await request('superadmin','POST','https://foreign.test'),403);
});

test('Physical stations cannot authorize or start a transaction with test cards', {timeout:5000}, async () => {
  const password = 'ephemeral-test-password';
  const audit = [];
  const pool = {
    async query(_query, bindings) {
      // The upgrade looks up the authenticated station by its identity.
      if (bindings.length === 1) {
        assert.deepEqual(bindings,[identity]);
        return {rowCount:1,rows:[{
          tenant_id:tenantId,station_id:stationId,password_hash:passwordHash,
          status:'active',is_simulator:false,
        }]};
      }
      if (bindings[2] === 'Authorize') audit.push(JSON.parse(bindings[3]));
      return {rowCount:1,rows:[]};
    },
  };
  const passwordHash = await hashPassword(password);
  const bridge = createOcppBridge(pool);
  const server = createServer();
  server.on('upgrade',bridge.upgrade);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const url = 'ws://127.0.0.1:' + server.address().port + '/ocpp/' + identity;
  const auth = Buffer.from(identity + ':' + password).toString('base64');
  const ws = new WebSocket(url,['ocpp1.6'],{headers:{Authorization:'Basic ' + auth}});
  try {
    await once(ws,'open');
    const testClient = new WebSocket(url,['ocpp1.6'],{headers:{
      Authorization:'Basic ' + auth,
      'X-ChargeVisor-Test-Wallbox':'1',
    }});
    const status = await new Promise((resolve,reject) => {
      testClient.once('unexpected-response',(_,response) => {
        response.resume();
        resolve(response.statusCode);
      });
      testClient.once('open',() => {
        testClient.terminate();
        resolve(101);
      });
      testClient.once('error',reject);
    });
    assert.equal(status,403);

    let nextId = 0;
    async function call(action, payload) {
      const id = String(++nextId);
      const reply = once(ws,'message');
      ws.send(JSON.stringify([2,id,action,payload]));
      const [data] = await reply;
      const [type,receivedId,result] = JSON.parse(String(data));
      assert.equal(type,3);
      assert.equal(receivedId,id);
      return result;
    }
    for (const idTag of ['CV-SIM-TEST','SIM-RFID']) {
      const authorization = await call('Authorize',{idTag});
      assert.equal(authorization.idTagInfo.status,'Invalid');
      const start = await call('StartTransaction',{idTag,connectorId:1,meterStart:1000,timestamp:new Date().toISOString()});
      assert.deepEqual(start,{transactionId:0,idTagInfo:{status:'Invalid'}});
    }
    assert.deepEqual(audit,[{authorized:false},{authorized:false}]);
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
      await once(ws,'close');
    }
    await new Promise(resolve => server.close(resolve));
  }
});
