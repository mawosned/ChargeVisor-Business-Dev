// ChargeVisor: stable, portable semicolon CSV of completed physical transactions.
// Snapshots are read-only; this module does not contain any DB credentials.
export const CSV_COLUMNS=[
  'session_id','tenant_id','ocpp_identity','connector_id',
  'started_at_utc','stopped_at_utc','meter_start_wh','meter_stop_wh',
  'energy_kwh','stop_reason','signed_meter'
];
export function csvCell(value){
  let s=value==null?'':String(value);
  // Excel formula injection: protect values potentially supplied by a device/operator.
  // Original database text stays untouched and is preserved in full SQL backups.
  if(/^\s*[=+@-]/u.test(s)||s.startsWith('\t')||s.startsWith('\r'))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csvHeader(){
  return '\uFEFF'+CSV_COLUMNS.map(csvCell).join(';')+'\r\n';
}
export function csvTransaction(r){
  const cols=[
    r.id,r.tenant_id,r.identity,r.connector_id,
    r.started_at,r.stopped_at,r.meter_start_wh,r.meter_stop_wh,
    r.energy_kwh,r.stop_reason,r.signed_meter
  ];
  return cols.map(csvCell).join(';')+'\r\n';
}
