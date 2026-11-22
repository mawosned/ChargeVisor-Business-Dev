export const FREECHARGE_TAG='CV-FREECHARGE';

export async function freechargeGrant(client,ctx,connectorId=null,{lock=false}={}){
  if(ctx.simulated)return null;
  // Match the configuration API's tenant-before-point lock order.
  if(lock){
    const tenant=await client.query(
      "SELECT id FROM cv_tenants WHERE id=$1 AND status='active' AND deleted_at IS NULL FOR SHARE",
      [ctx.tenantId]);
    if(!tenant.rowCount)return null;
  }
  const result=await client.query(`
    SELECT p.id AS point_id
    FROM cv_chargepoints p
    JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id
    JOIN cv_tenants t ON t.id=p.tenant_id AND t.status='active' AND t.deleted_at IS NULL
    WHERE p.tenant_id=$1 AND p.station_id=$2 AND p.ocpp_identity=$3
      AND NOT s.is_simulator AND p.enabled AND p.freecharge_enabled
      AND ($4::integer IS NULL OR p.connector_number=$4)
    ORDER BY p.connector_number LIMIT 1${lock?' FOR SHARE OF p,s':''}`,
    [ctx.tenantId,ctx.stationId,ctx.identity,connectorId]);
  if(!result.rowCount)return null;
  return {point_id:result.rows[0].point_id,user_id:null,card_id:null};
}

const ENABLED_KEY='EnelionFreeChargeEnabled';
const TAG_KEY='EnelionFreeChargeOcppIdtag';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export async function applyLuminaFreecharge(enabled,sendCommand){
  const settings=enabled?[[TAG_KEY,FREECHARGE_TAG],[ENABLED_KEY,'true']]:[[ENABLED_KEY,'false']];
  const results=[];
  for(const [key,value] of settings){
    const status=await sendCommand('ChangeConfiguration',{key,value});
    results.push({key,status});
    if(status==='Accepted'||status==='RebootRequired')continue;
    const explanation={
      NotSupported:'Die Wallbox unterstützt diese OCPP-Einstellung nicht.',
      Rejected:'Die Wallbox hat die Einstellung abgelehnt.',
      Timeout:'Die Wallbox hat nicht rechtzeitig geantwortet.',
      Disconnected:'Die OCPP-Verbindung wurde unterbrochen.',
      InvalidResponse:'Die Wallbox hat eine ungültige OCPP-Antwort gesendet.'
    }[status]||'Die Wallbox konnte die OCPP-Einstellung nicht bestätigen.';
    const code=status==='Timeout'?504:status==='Disconnected'?409:422;
    return {code,body:{error:explanation,results}};
  }
  const status=results.some(result=>result.status==='RebootRequired')?'RebootRequired':'Accepted';
  return {code:200,body:{status,freechargeEnabled:enabled,results}};
}

export async function handleFreechargeConfiguration({pool,actor,req,origin,send,configure}){
  if(actor.role!=='superadmin')return send(403,{error:'Nur Walectra darf die Wallbox konfigurieren'});
  if(req.method!=='POST')return send(405,{error:'Methode nicht erlaubt'});
  if(!origin||req.headers.origin!==origin||
      (req.headers['content-type']||'').split(';')[0]!=='application/json')
    return send(403,{error:'Ungültige Anfrage'});
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>4096)return send(413,{error:'Anfrage zu groß'});
    chunks.push(chunk);
  }
  let input;
  try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{
    return send(400,{error:'Ungültige Anfrage'});
  }
  const {tenantId,pointId}=input||{};
  if(!uuid(tenantId)||!uuid(pointId))return send(400,{error:'Kunde und Ladepunkt auswählen'});
  const {rows:[point]}=await pool.query(`
    SELECT p.tenant_id,p.station_id,p.ocpp_identity,p.enabled,p.freecharge_enabled,
      l.vendor,l.model,l.connected,
      EXISTS (
        SELECT 1 FROM cv_chargepoints other
        WHERE other.tenant_id=p.tenant_id AND other.station_id=p.station_id
          AND other.ocpp_identity=p.ocpp_identity AND other.freecharge_enabled<>p.freecharge_enabled
      ) AS mixed_policy
    FROM cv_chargepoints p
    JOIN cv_tenants t ON t.id=p.tenant_id AND t.status='active' AND t.deleted_at IS NULL
    JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id AND NOT s.is_simulator
    JOIN cv_ocpp_credentials c ON c.identity=p.ocpp_identity AND c.tenant_id=p.tenant_id AND c.station_id=p.station_id
    LEFT JOIN cv_ocpp_live l ON l.identity=c.identity AND l.tenant_id=c.tenant_id
      AND l.station_id=c.station_id AND NOT l.simulated
    WHERE p.id=$1 AND p.tenant_id=$2`,[pointId,tenantId]);
  if(!point)return send(404,{error:'Physischer OCPP-Ladepunkt nicht gefunden'});
  if(point.mixed_policy)
    return send(409,{error:'Diese OCPP-Verbindung hat Ladepunkte mit unterschiedlichen Freecharge-Einstellungen. Stell sie direkt an der jeweiligen Wallbox ein.'});
  if(!point.enabled&&point.freecharge_enabled)
    return send(409,{error:'Den Ladepunkt zuerst aktivieren'});
  if(!point.connected)return send(409,{error:'Die Wallbox ist nicht mit ChargeVisor verbunden'});
  if(!/\benelion\b/i.test(point.vendor||'')||!/\blumina\b/i.test(point.model||''))
    return send(422,{error:'Die Wallbox hat sich nicht als Enelion Lumina ausgewiesen'});
  const result=await configure(point);
  return send(result.code,result.body);
}
