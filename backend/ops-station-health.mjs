// Operator-only operational read API. No changes to existing UI or charging state.
// A missing heartbeat does not prove a power failure. Return "suspected stale"
// rather than inventing a cause, and keep existing open transactions untouched.
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function readStationHealth(pool,{staleSeconds=180}={}){
  if(!Number.isInteger(staleSeconds)||staleSeconds<120||staleSeconds>3600)
    throw Error('Invalid heartbeat age threshold');
  const [stations,sessions]=await Promise.all([
    pool.query([
      'SELECT c.identity,c.tenant_id,c.station_id,',
      's.name AS station_name,t.name AS tenant_name,',
      'l.connected,l.last_seen,l.firmware,l.status AS last_action_status',
      'FROM cv_ocpp_credentials c',
      'JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id',
      'JOIN cv_tenants t ON t.id=c.tenant_id',
      'LEFT JOIN cv_ocpp_live l ON l.identity=c.identity AND l.tenant_id=c.tenant_id',
      "WHERE s.is_simulator=false AND t.status='active' AND t.deleted_at IS NULL",
      'ORDER BY t.name,s.name,c.identity LIMIT 2001'
    ].join(' ')),
    pool.query([
      'SELECT identity,COUNT(*)::int AS open_count',
      'FROM cv_ocpp_transactions WHERE simulated=false AND stopped_at IS NULL',
      'GROUP BY identity'
    ].join(' '))
  ]);
  // Fail closed rather than silently reporting a partial station inventory as healthy.
  if(stations.rows.length>2000)throw Error('Station inventory exceeds V1 monitoring limit');
  const openCounts=new Map(sessions.rows.map(x=>[x.identity,Number(x.open_count)]));
  const evaluatedAt=new Date().toISOString(),now=Date.now();
  const rows=stations.rows.map(row=>{
    const lastSeenMs=row.last_seen?Date.parse(row.last_seen):NaN;
    const ageSeconds=Number.isFinite(lastSeenMs)?Math.max(0,Math.floor((now-lastSeenMs)/1000)):null;
    const connected=row.connected===true;
    const state=!connected?'disconnected':
      (ageSeconds===null||ageSeconds>staleSeconds)?'stale_heartbeat':'online';
    return {
      identity:row.identity,tenantId:row.tenant_id,stationId:row.station_id,
      tenantName:row.tenant_name,stationName:row.station_name,
      connected,state,lastSeen:row.last_seen,heartbeatAgeSeconds:ageSeconds,
      openUnconfirmedSessions:openCounts.get(row.identity)||0,
      firmware:row.firmware||null
    };
  });
  return {
    evaluatedAt,staleSeconds,scanned:rows.length,
    online:rows.filter(x=>x.state==='online').length,
    disconnected:rows.filter(x=>x.state==='disconnected').length,
    stale:rows.filter(x=>x.state==='stale_heartbeat').length,
    openUnconfirmedSessions:rows.reduce((n,x)=>n+x.openUnconfirmedSessions,0),
    stations:rows,
    limitations:'OCPP heartbeat/connection loss cannot determine whether wallbox, internet or power failed.'
  };
}
