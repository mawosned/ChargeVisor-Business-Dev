/**
 * Non-destructive status of charging transactions after a wallbox loses power,
 * drops network, or restarts. A disconnect does NOT prove electrical power loss.
 * Never automatically close or bill an unconfirmed transaction.
 */
export async function getPowerRecoveryStatus(pool,actor,tenantId,{limit=100}={}){
  if(!actor||!tenantId)throw new Error('Authenticated tenant required');
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid limit');
  const userId=actor.role==='user'?actor.id:null;
  const sql=[
    'SELECT x.id AS transaction_id,x.identity,x.connector_id,x.chargepoint_id,',
    'x.started_at,x.meter_start_wh,x.meter_last_wh,',
    'l.connected,l.last_seen AS last_connection_event,l.firmware,',
    's.name AS station_name,p.name AS point_name',
    'FROM cv_ocpp_transactions x',
    'JOIN cv_ocpp_credentials c ON c.identity=x.identity AND c.tenant_id=x.tenant_id',
    'JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id',
    'JOIN cv_chargepoints p ON p.station_id=s.id AND p.tenant_id=x.tenant_id',
    'AND p.ocpp_identity=x.identity AND p.connector_number=x.connector_id',
    'LEFT JOIN cv_ocpp_live l ON l.identity=x.identity AND l.tenant_id=x.tenant_id',
    'WHERE x.tenant_id=$1 AND x.simulated=false AND x.stopped_at IS NULL',
    'AND s.is_simulator=false',
    'AND ($2::uuid IS NULL OR x.user_id=$2)',
    'ORDER BY x.started_at ASC,x.id ASC LIMIT $3'
  ].join(' ');
  const {rows}=await pool.query(sql,[tenantId,userId,limit]);
  return {
    evaluatedAt:new Date().toISOString(),
    note:'Offline bedeutet Verbindungsverlust, nicht zwingend Stromausfall. Offene Transaktionen werden nicht automatisch beendet oder abgerechnet.',
    openSessions:rows.map(x=>({
      transactionId:x.transaction_id,
      identity:x.identity,
      connectorId:x.connector_id,
      pointId:x.chargepoint_id,
      stationName:x.station_name,
      pointName:x.point_name,
      startedAt:x.started_at,
      lastMeterWh:x.meter_last_wh,
      meterStartWh:x.meter_start_wh,
      connected:x.connected===true,
      lastConnectionEvent:x.last_connection_event,
      firmware:x.firmware,
      recovery:'awaiting_stop_transaction',
      // No tariff or billed amount: a missing StopTransaction is not an invoice.
      billingState:'unconfirmed'
    }))
  };
}
