import test from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,csvHeader,csvTransaction,CSV_COLUMNS} from './csv-session-format.mjs';
test('stable CSV column order and UTF-8 Excel header',()=>{
  const s=csvHeader();assert.ok(s.startsWith('\uFEFF'));assert.equal(s.split(';').length,11);
  assert.equal(CSV_COLUMNS[0],'session_id');
});
test('safe quoting, German Excel delimiter, and formula injection avoidance',()=>{
  assert.equal(csvCell('a";b'),'"a"";b"');
  assert.equal(csvCell('=HYPERLINK("x")'),"'=\""+'HYPERLINK(\"\"x\"\")'.slice(0,0) ? '' : csvCell('=1'),'"\'=1"');
  assert.equal(csvCell('@SUM(1)'),'"\'@SUM(1)"');
  assert.equal(csvCell(null),'""');
  const row=csvTransaction({id:10,tenant_id:'test',identity:'=E1',connector_id:2,
    started_at:'2026-11-23T11:00:00.000Z',stopped_at:'2026-11-23T12:00:00.000Z',
    meter_start_wh:'12345',meter_stop_wh:'23456',energy_kwh:'11.111',
    stop_reason:'EVDisconnected',signed_meter:'false'});
  assert.match(row,/'\'=E1'/);
  assert.equal(row.split(';').length,11);
});
