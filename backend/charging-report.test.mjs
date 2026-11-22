import test from 'node:test';
import assert from 'node:assert/strict';
import {createOcppApi} from './ocpp.mjs';

test('PDF charging reports require a current grant and contain only the selected customer’s real charging data', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const reads = [];
  const real = {
    started_at: '2026-11-21T12:00:00Z', stopped_at: '2026-11-21T13:00:00Z',
    site_name: 'Parkhaus Test', point_name: 'Stellplatz 1', connector_id: 1, energy_wh: 3200,
    authorization_kind: 'freecharge'
  };
  const api = createOcppApi({
    pool: {query: async (_, params) => {
      reads.push(params[0]);
      return {rows: [{name: 'Kunde Test'}]};
    }},
    bridge: {physical: {history: async (_, scope) => {
      reads.push(scope);
      return [real, {...real, point_name: 'Simulierter Platz', simulated: true}];
    }}},
    getActor: async req => req.actor,
    env: {}
  });
  const path = '/api/ocpp/reports/charging.pdf';
  async function download(actor, selected=other) {
    const res = {
      writeHead(status, headers) {this.status = status; this.headers = headers;},
      end(body) {this.body = body;}
    };
    await api({method: 'GET', url: path + '?tenantId=' + selected, actor}, res, path);
    return res;
  }
  assert.equal((await download(null)).status, 401);
  assert.equal((await download({role: 'admin', tenant_id: tenantId})).status, 403);
  assert.equal((await download({role: 'user', tenant_id: tenantId, can_download_pdf: true})).status, 403);
  assert.deepEqual(reads, []);
  const granted = await download({role: 'admin', tenant_id: tenantId, can_download_pdf: true});
  assert.equal(granted.status, 200);
  assert.equal(granted.headers['Content-Type'], 'application/pdf');
  assert.match(granted.headers['Content-Disposition'], /attachment/);
  assert.deepEqual(reads, [tenantId, tenantId]);
  const pdf = granted.body.toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Parkhaus Test/);
  assert.match(pdf, /Freecharge/);
  assert.doesNotMatch(pdf, /Simulierter Platz|DEMO|BERECHNETER BETRAG/);
  assert.equal((await download({role: 'superadmin'}, tenantId)).status, 200);
});
