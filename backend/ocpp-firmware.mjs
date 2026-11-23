import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {validateOcppCsmsResponse} from './ocpp-command-catalog.mjs';

/**
 * Firmware V1 is explicitly provisioned and restricted. No untrusted client may
 * provide a firmware URL; only approved operator-configured catalog entries.
 * Sending OCPP UpdateFirmware does NOT prove the charger downloaded, verified,
 * installed, or booted the desired firmware.
 */
const ID=/^[\w.:-]{2,120}$/;
const RELEASE=/^[a-zA-Z0-9_.-]{1,100}$/;
const VERSION=/^[\w.()+:-]{1,120}$/;
const HEX=/^[a-f0-9]{64}$/i;
const finalStates=new Set(['verified','DownloadFailed','InstallationFailed','transport_error']);
const ocppStates=new Set([
  'Idle','Downloading','Downloaded','DownloadFailed',
  'Installing','Installed','InstallationFailed'
]);
function catalogFromEnv(env){
  if(env.CV_FIRMWARE_UPDATES_ENABLED!=='1')return new Map();
  if(!env.CV_FIRMWARE_CATALOG_JSON)throw new Error('Firmware feature requires configured catalog');
  const list=JSON.parse(env.CV_FIRMWARE_CATALOG_JSON);
  if(!Array.isArray(list)||!list.length||list.length>100)
    throw new Error('Invalid firmware catalog');
  const allowedHosts=String(env.CV_FIRMWARE_ALLOWED_HOSTS||'')
    .split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!allowedHosts.length)throw new Error('Firmware download allowlist missing');
  const catalog=new Map();
  for(const row of list){
    if(!row||typeof row!=='object'||!RELEASE.test(row.id||'')||
      typeof row.vendor!=='string'||!row.vendor.trim()||row.vendor.length>120||
      typeof row.model!=='string'||!row.model.trim()||row.model.length>120||
      !VERSION.test(row.version||'')||!HEX.test(row.sha256||''))throw new Error('Invalid firmware release');
    let url;
    try{url=new URL(row.location);}catch{throw new Error('Invalid firmware download URL');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash||
      !allowedHosts.includes(url.hostname.toLowerCase())||url.port)
      throw new Error('Firmware URL must use approved HTTPS host');
    if(catalog.has(row.id))throw new Error('Duplicate firmware release ID');
    catalog.set(row.id,Object.freeze({...row,location:url.toString(),host:url.hostname}));
  }
  return catalog;
}

export async function ensureFirmwareSchema(pool){
  if(!pool)return;
  await pool.query([
    'CREATE TABLE IF NOT EXISTS cv_ocpp_firmware_jobs (',
    'id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cv_tenants(id),',
    'station_id uuid NOT NULL REFERENCES cv_stations(id),',
    'identity text NOT NULL REFERENCES cv_ocpp_credentials(identity),',
    'release_id text NOT NULL,target_version text NOT NULL,',
    'artifact_sha256 text NOT NULL,download_host text NOT NULL,',
    'requested_by uuid NOT NULL REFERENCES cv_users(id),',
    'status text NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),',
    'acknowledged_at timestamptz,last_status_at timestamptz,verified_at timestamptz,',
    'note text)',
    ].join(' '));
  // Multiple commands must not race against the same physical wallbox.
  await pool.query([
    'CREATE UNIQUE INDEX IF NOT EXISTS cv_ocpp_firmware_one_active_idx',
    'ON cv_ocpp_firmware_jobs(identity)',
    "WHERE status IN ('requested','accepted','Downloading','Downloaded','Installing','Installed')"
  ].join(' '));
}

export function createFirmwareManager({pool,env,active,sendCommand,event}){
  const enabled=env.CV_FIRMWARE_UPDATES_ENABLED==='1';
  const catalog=catalogFromEnv(env);
  const allowed=new Set(String(env.CV_FIRMWARE_ALLOWED_IDENTITIES||'').split(',')
    .map(x=>x.trim()).filter(Boolean));
  async function list(actor,tenantId,identity){
    if(!enabled)return {code:404,error:'Firmwareverwaltung deaktiviert'};
    if(actor?.role!=='superadmin')return {code:403,error:'Nur Walectra darf Firmwareupdates verwalten'};
    const {rows}=await pool.query([
      'SELECT id,identity,release_id,target_version,status,requested_at,acknowledged_at,',
      'last_status_at,verified_at,note FROM cv_ocpp_firmware_jobs',
      'WHERE tenant_id=$1 AND identity=$2 ORDER BY requested_at DESC LIMIT 30'
    ].join(' '),[tenantId,identity]);
    return {code:200,jobs:rows,releases:[...catalog.values()].map(x=>({
      id:x.id,vendor:x.vendor,model:x.model,version:x.version
    }))};
  }
  async function request({actor,tenantId,identity,releaseId,confirm}){
    if(!enabled)return {code:404,error:'Firmwareverwaltung deaktiviert'};
    if(actor?.role!=='superadmin')return {code:403,error:'Nur Walectra darf Firmwareupdates anstoßen'};
    if(confirm!=='INSTALL_FIRMWARE'||!ID.test(identity||'')||!RELEASE.test(releaseId||''))
      return {code:400,error:'Gerät, freigegebene Version und Bestätigung erforderlich'};
    const release=catalog.get(releaseId);
    if(!release)return {code:404,error:'Firmwareversion nicht freigegeben'};
    if(!allowed.has(identity))
      return {code:403,error:'Firmwareupdate für diese Wallbox nicht ausdrücklich freigegeben'};
    const station=await pool.query([
      'SELECT c.identity,c.tenant_id,c.station_id,s.is_simulator,l.connected,',
      'l.vendor,l.model,l.firmware',
      'FROM cv_ocpp_credentials c',
      'JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id',
      'JOIN cv_tenants t ON t.id=c.tenant_id',
      'LEFT JOIN cv_ocpp_live l ON l.identity=c.identity AND l.tenant_id=c.tenant_id',
      'WHERE c.identity=$1 AND c.tenant_id=$2 AND t.status=$3 AND t.deleted_at IS NULL'
    ].join(' '),[identity,tenantId,'active']);
    if(!station.rowCount||station.rows[0].is_simulator)
      return {code:404,error:'Physische, aktive Ladestation nicht gefunden'};
    const stationData=station.rows[0];
    if(stationData.vendor!==release.vendor||stationData.model!==release.model)
      return {code:409,error:'Firmware nicht für die gemeldete Geräteversion freigegeben'};
    if(stationData.firmware===release.version)
      return {code:409,error:'Firmwareversion bereits installiert'};
    const ctx=active.get(identity);
    if(!ctx||ctx.simulated||ctx.tenantId!==tenantId||
      ctx.stationId!==stationData.station_id||
      !stationData.connected||ctx.ws.readyState!==WebSocket.OPEN)
      return {code:409,error:'Wallbox ist nicht verbunden'};
    if(ctx.pendingCommand||ctx.controlling||ctx.configuringFreecharge||
      ctx.advancedInProgress||ctx.firmwareInProgress)
      return {code:409,error:'Wallbox verarbeitet bereits einen Befehl'};
    const tx=await pool.query([
      'SELECT id FROM cv_ocpp_transactions',
      'WHERE identity=$1 AND tenant_id=$2 AND simulated=false',
      'AND stopped_at IS NULL LIMIT 1'
    ].join(' '),[identity,tenantId]);
    if(tx.rowCount)return {code:409,error:'Firmwareupdate während eines Ladevorgangs verboten'};
    const connector=await pool.query([
      'SELECT connector_id,status FROM cv_ocpp_connector_live',
      'WHERE identity=$1 AND tenant_id=$2 AND simulated=false'
    ].join(' '),[identity,tenantId]);
    if(!connector.rowCount||connector.rows.some(x=>x.status!=='Available'&&x.status!=='Unavailable'))
      return {code:409,error:'Alle Connectoren müssen sicher bereit oder gesperrt sein'};
    ctx.firmwareInProgress=true;
    const jobId=randomUUID();
    try{
      await pool.query([
        'INSERT INTO cv_ocpp_firmware_jobs',
        '(id,tenant_id,station_id,identity,release_id,target_version,',
        'artifact_sha256,download_host,requested_by,status)',
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
      ].join(' '),[
        jobId,tenantId,stationData.station_id,identity,
        release.id,release.version,release.sha256,release.host,actor.id,'requested'
      ]);
      // OCPP device downloads on its own. No binary is ever sent by CSMS.
      const outcome=await sendCommand(ctx,'UpdateFirmware',{
        location:release.location,retrieveDate:new Date(Date.now()+60000).toISOString()
      },{raw:true});
      if(!outcome.ok||!validateOcppCsmsResponse('UpdateFirmware',outcome.response).ok){
        const error=outcome.error||'Ungültige Firmware-Antwort';
        await pool.query([
          'UPDATE cv_ocpp_firmware_jobs SET status=$2,note=$3',
          "WHERE id=$1 AND status='requested'"
        ].join(' '),[jobId,'transport_error',error]);
        return {code:409,error:'Firmwareauftrag nicht bestätigt: '+error,jobId};
      }
      // Do not overwrite Downloading/Installing if the device reports early.
      await pool.query([
        'UPDATE cv_ocpp_firmware_jobs SET status=$2,acknowledged_at=now()',
        "WHERE id=$1 AND status='requested'"
      ].join(' '),[jobId,'accepted']);
      await event(ctx,'CSMS.UpdateFirmware',{jobId,releaseId:release.id});
      return {code:202,jobId,status:'accepted',
        note:'Nur Auftrag bestätigt. Installation und Firmwareversion noch nicht verifiziert.'};
    }catch(e){
      if(e.code==='23505')return {code:409,error:'Firmwareauftrag für dieses Gerät bereits aktiv'};
      throw e;
    }finally{ctx.firmwareInProgress=false;}
  }
  async function observeStatus(ctx,status){
    if(!enabled||!ocppStates.has(status)||ctx.simulated)return;
    const jobs=await pool.query([
      'SELECT id,status FROM cv_ocpp_firmware_jobs',
      'WHERE identity=$1 AND tenant_id=$2',
      "AND status IN ('requested','accepted','Downloading','Downloaded','Installing','Installed')",
      'ORDER BY requested_at DESC LIMIT 1'
    ].join(' '),[ctx.identity,ctx.tenantId]);
    if(!jobs.rowCount)return;
    const current=jobs.rows[0];
    if(status==='Idle')return; // Idle cannot prove either success or failure.
    if(status==='Installed'&&current.status==='Installed')return;
    if(current.status==='Installed'&&status!=='Installed')return;
    const note=status==='Installed'?'Installation gemeldet; BootNotification mit Zielversion fehlt':null;
    await pool.query([
      'UPDATE cv_ocpp_firmware_jobs SET status=$2,last_status_at=now(),note=$3',
      'WHERE id=$1'
    ].join(' '),[current.id,status,note]);
  }
  async function observeBoot(ctx,version){
    if(!enabled||ctx.simulated||!VERSION.test(version||''))return;
    // Never certify firmware solely from a CALLRESULT or status "Installed".
    await pool.query([
      'UPDATE cv_ocpp_firmware_jobs SET status=$3,verified_at=now(),note=NULL',
      'WHERE identity=$1 AND tenant_id=$2',
      "AND status='Installed' AND target_version=$4"
    ].join(' '),[ctx.identity,ctx.tenantId,'verified',version]);
  }
  return {enabled,list,request,observeStatus,observeBoot};
}
