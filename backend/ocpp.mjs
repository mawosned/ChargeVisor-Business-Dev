import {randomBytes,randomUUID} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {verifyPassword} from './auth.mjs';
import {allowsTestRfid,captureTestRfid,ensureTestRfidSchema,handleTestRfid,validUuid} from './test-rfid.mjs';
import {createPhysicalOcpp,ensurePhysicalOcppSchema} from './physical-ocpp.mjs';
import {chargingReport} from './charging-report.mjs';
import {applyLuminaFreecharge,handleFreechargeConfiguration} from './freecharge.mjs';
import {validateOcppCsmsCommand} from './ocpp-command-catalog.mjs';
import {createOcppTestVerifier} from './ocpp-test-verifier.mjs';

const now=()=>new Date().toISOString();
const validId=id=>typeof id==='string'&&/^[-\w.:]{2,120}$/.test(id);
const sendJSON=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const reject=(socket,status=401)=>{
  if(socket.destroyed)return;
  socket.end('HTTP/1.1 '+status+' Reject\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
};
function parseFrame(text){
  try{return JSON.parse(String(text));}catch{return null;}
}
export function parseOcppCall(text){
  return asCall(parseFrame(text));
}
function asCall(a){
  if(!Array.isArray(a)||a.length!==4||a[0]!==2||typeof a[1]!=='string'||
    a[1].length<1||a[1].length>100||typeof a[2]!=='string'||!a[3]||
    typeof a[3]!=='object'||Array.isArray(a[3]))return null;
  return {id:a[1],action:a[2],payload:a[3]};
}
export async function ensureOcppSchema(pool){
  if(!pool)return;
  await pool.query('ALTER TABLE cv_stations ADD COLUMN IF NOT EXISTS is_simulator boolean NOT NULL DEFAULT false');
  await pool.query('CREATE TABLE IF NOT EXISTS cv_ocpp_live (identity text PRIMARY KEY REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE, tenant_id uuid NOT NULL, station_id uuid NOT NULL, connected boolean NOT NULL DEFAULT false, status text, action text, vendor text, model text, firmware text, energy_wh numeric, power_w numeric, simulated boolean NOT NULL DEFAULT false, last_seen timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE IF NOT EXISTS cv_ocpp_events (id bigserial PRIMARY KEY, identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE, tenant_id uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL, simulated boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE INDEX IF NOT EXISTS cv_ocpp_events_lookup_idx ON cv_ocpp_events(identity,created_at DESC)');
  await pool.query('CREATE TABLE IF NOT EXISTS cv_ocpp_transactions (id bigserial PRIMARY KEY,identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,tenant_id uuid NOT NULL,connector_id integer NOT NULL,meter_start_wh numeric NOT NULL DEFAULT 0,meter_stop_wh numeric,started_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz,simulated boolean NOT NULL DEFAULT false)');
  await pool.query('CREATE TABLE IF NOT EXISTS cv_ocpp_connector_live (identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE, tenant_id uuid NOT NULL,station_id uuid NOT NULL,connector_id integer NOT NULL,status text,energy_wh numeric,power_w numeric,simulated boolean NOT NULL DEFAULT false,last_seen timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(identity,connector_id))');
  await pool.query('CREATE INDEX IF NOT EXISTS cv_ocpp_connector_tenant_idx ON cv_ocpp_connector_live(tenant_id,station_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS cv_ocpp_transactions_station_idx ON cv_ocpp_transactions(identity,started_at DESC)');
  await ensureTestRfidSchema(pool);
  await ensurePhysicalOcppSchema(pool);
  await pool.query(`ALTER TABLE cv_ocpp_connector_live
    ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
    ADD COLUMN IF NOT EXISTS error_code text,
    ADD COLUMN IF NOT EXISTS error_info text`);
  await pool.query(`CREATE INDEX IF NOT EXISTS cv_ocpp_power_history_idx
    ON cv_ocpp_events(tenant_id,created_at DESC)
    WHERE NOT simulated AND action IN ('MeterValues','StatusNotification')`);
  await pool.query('UPDATE cv_ocpp_live SET connected=false WHERE connected=true');
}
function parseBasic(value){
  if(!value?.startsWith('Basic '))return null;
  try{const decoded=Buffer.from(value.slice(6),'base64').toString('utf8'),i=decoded.indexOf(':');return i>0?{id:decoded.slice(0,i),password:decoded.slice(i+1)}:null;}catch{return null;}
}
export function createOcppBridge(pool,env=process.env){
  const wss=new WebSocketServer({noServer:true,maxPayload:65536,clientTracking:false,
    handleProtocols:()=> 'ocpp1.6'});
  const physical=createPhysicalOcpp(pool,env);
  const active=new Map(),virtualTokens=new Map();
  async function state(ctx,update){
    const v=[ctx.identity,ctx.tenantId,ctx.stationId,
      update.connected??true,update.status??null,update.action??null,
      update.vendor??null,update.model??null,update.firmware??null,
      update.energyWh??null,update.powerW??null,ctx.simulated];
    await pool.query('INSERT INTO cv_ocpp_live(identity,tenant_id,station_id,connected,status,action,vendor,model,firmware,energy_wh,power_w,simulated,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) ON CONFLICT(identity) DO UPDATE SET connected=EXCLUDED.connected,status=COALESCE(EXCLUDED.status,cv_ocpp_live.status),action=EXCLUDED.action,vendor=COALESCE(EXCLUDED.vendor,cv_ocpp_live.vendor),model=COALESCE(EXCLUDED.model,cv_ocpp_live.model),firmware=COALESCE(EXCLUDED.firmware,cv_ocpp_live.firmware),energy_wh=COALESCE(EXCLUDED.energy_wh,cv_ocpp_live.energy_wh),power_w=COALESCE(EXCLUDED.power_w,cv_ocpp_live.power_w),simulated=EXCLUDED.simulated,last_seen=now()',v);
  }
  async function connectorState(ctx,connectorId,update={}){
    await pool.query(
      'INSERT INTO cv_ocpp_connector_live(identity,tenant_id,station_id,connector_id,status,energy_wh,power_w,simulated,last_seen,power_updated_at,status_changed_at,error_code,error_info) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),CASE WHEN $7::numeric IS NOT NULL THEN now() END,CASE WHEN $5::text IS NOT NULL THEN now() END,$9,$10) '+
      'ON CONFLICT(identity,connector_id) DO UPDATE SET '+
      'status=COALESCE(EXCLUDED.status,cv_ocpp_connector_live.status),'+
      'energy_wh=COALESCE(EXCLUDED.energy_wh,cv_ocpp_connector_live.energy_wh),'+
      'power_w=COALESCE(EXCLUDED.power_w,cv_ocpp_connector_live.power_w),'+
      "power_updated_at=CASE WHEN EXCLUDED.status IS NOT NULL AND EXCLUDED.status<>'Charging' AND EXCLUDED.status IS DISTINCT FROM cv_ocpp_connector_live.status THEN NULL "+
        'ELSE COALESCE(EXCLUDED.power_updated_at,cv_ocpp_connector_live.power_updated_at) END,'+
      'status_changed_at=CASE WHEN EXCLUDED.status IS NOT NULL AND (EXCLUDED.status IS DISTINCT FROM cv_ocpp_connector_live.status '+
        'OR EXCLUDED.error_code IS DISTINCT FROM cv_ocpp_connector_live.error_code) THEN EXCLUDED.status_changed_at '+
        'ELSE COALESCE(cv_ocpp_connector_live.status_changed_at,EXCLUDED.status_changed_at) END,'+
      'error_code=CASE WHEN EXCLUDED.status IS NULL THEN cv_ocpp_connector_live.error_code ELSE EXCLUDED.error_code END,'+
      'error_info=CASE WHEN EXCLUDED.status IS NULL THEN cv_ocpp_connector_live.error_info ELSE EXCLUDED.error_info END,'+
      'simulated=EXCLUDED.simulated,last_seen=now()',
      [ctx.identity,ctx.tenantId,ctx.stationId,connectorId,
        update.status??null,update.energyWh??null,update.powerW??null,ctx.simulated,update.errorCode??null,update.errorInfo??null]);
  }
  async function event(ctx,action,data){
    await pool.query('INSERT INTO cv_ocpp_events(identity,tenant_id,action,payload,simulated) VALUES($1,$2,$3,$4,$5)',
      [ctx.identity,ctx.tenantId,action,JSON.stringify(data),ctx.simulated]);
  }
  async function process(ctx,frame){
    const c=asCall(frame);
    if(!c){ctx.ws.close(1002,'OCPP 1.6J Format erwartet');return;}
    const reply=payload=>{if(ctx.ws.readyState===WebSocket.OPEN)ctx.ws.send(JSON.stringify([3,c.id,payload]));};
    const fail=(code,msg)=>{if(ctx.ws.readyState===WebSocket.OPEN)ctx.ws.send(JSON.stringify([4,c.id,code,msg,{}]));};
    try{
      const p=c.payload;
      switch(c.action){
      case 'BootNotification': {
        if(!p.chargePointVendor||!p.chargePointModel){fail('FormationViolation','Hersteller oder Modell fehlen');return;}
        const vendor=String(p.chargePointVendor).slice(0,120),model=String(p.chargePointModel).slice(0,120),firmware=String(p.firmwareVersion||'').slice(0,120);
        await state(ctx,{action:c.action,vendor,model,firmware});await event(ctx,c.action,{vendor,model,firmware});
        reply({status:'Accepted',currentTime:now(),interval:60});return;
      }
      case 'Heartbeat':
        await state(ctx,{action:c.action});await event(ctx,c.action,{});reply({currentTime:now()});return;
      case 'StatusNotification': {
        const valid=['Available','Preparing','Charging','SuspendedEVSE','SuspendedEV','Finishing','Reserved','Unavailable','Faulted'];
        const connectorId=Number(p.connectorId);
        if(!valid.includes(p.status)||!Number.isInteger(connectorId)||connectorId<0||connectorId>128){fail('PropertyConstraintViolation','Ungültiger Status');return;}
        await state(ctx,{status:p.status,action:c.action});
        const errorCode=typeof p.errorCode==='string'?p.errorCode.slice(0,100):null;
        const errorInfo=typeof p.info==='string'?p.info.slice(0,180):null;
        if(connectorId>0)await connectorState(ctx,connectorId,{status:p.status,errorCode,errorInfo});
        await event(ctx,c.action,{status:p.status,connectorId,errorCode});
        reply({});return;
      }
      case 'MeterValues': {
        const connectorId=Number(p.connectorId);
        if(!Number.isInteger(connectorId)||connectorId<0||connectorId>128){fail('PropertyConstraintViolation','Ungültiger Connector');return;}
        let energyWh=null,powerW=null;
        for(const row of (Array.isArray(p.meterValue)?p.meterValue:[]).slice(-3)){
          let reportedPower=null;
          const phasePower=new Map();
          for(const s of (Array.isArray(row?.sampledValue)?row.sampledValue:[]).slice(0,16)){
            if(!s||typeof s.value!=='string'||!s.value.trim()||s.format==='SignedData')continue;
            const n=Number(s.value);
            if(!Number.isFinite(n)||n<0)continue;
            if(!s.phase&&(s.measurand||'Energy.Active.Import.Register')==='Energy.Active.Import.Register'&&['Wh','kWh'].includes(s.unit||'Wh'))
              energyWh=(s.unit||'Wh')==='kWh'?n*1000:n;
            if(s.measurand==='Power.Active.Import'&&['W','kW'].includes(s.unit||'W')){
              const watts=s.unit==='kW'?n*1000:n;
              if(!Number.isFinite(watts))continue;
              if(!s.phase)reportedPower=watts;
              else if(['L1','L2','L3'].includes(s.phase))phasePower.set(s.phase,watts);
            }
          }
          if(reportedPower!==null)powerW=reportedPower;
          else if(phasePower.size===3){
            const sum=[...phasePower.values()].reduce((total,watts)=>total+watts,0);
            if(Number.isFinite(sum))powerW=sum;
          }
        }
        if(!ctx.simulated&&!await physical.sample(ctx,p,energyWh)){
          fail('PropertyConstraintViolation','Unbekannte Transaktion für diesen Connector');return;
        }
        await state(ctx,{action:c.action,energyWh,powerW});
        if(connectorId>0)await connectorState(ctx,connectorId,{energyWh,powerW});
        await event(ctx,c.action,{connectorId,energyWh,powerW});
        reply({});return;
      }
      case 'Authorize': {
        const allowed=ctx.simulated
          ?p.idTag==='CV-SIM-TEST'||await allowsTestRfid(pool,ctx,p.idTag)
          :await physical.authorize(ctx,p.idTag);
        if(ctx.simulated&&!allowed)await captureTestRfid(pool,ctx,p.idTag);
        // Keep audit evidence for the independent OCPP suite, never log a real RFID UID.
        await event(ctx,c.action,{authorized:allowed});
        reply({idTagInfo:{status:allowed?'Accepted':'Invalid'}});return;
      }
      case 'StartTransaction': {
        if(!ctx.simulated){
          const result=await physical.start(ctx,p);
          if(result.error){fail('PropertyConstraintViolation',result.error);return;}
          if(result.transactionId&&!result.replayed)
            await event(ctx,c.action,{transactionId:result.transactionId,connectorId:p.connectorId,meterStart:p.meterStart});
          reply({transactionId:result.transactionId,idTagInfo:{status:result.transactionId?'Accepted':'Invalid'}});return;
        }
        const connectorId=Number(p.connectorId),meterStart=Number(p.meterStart);
        if(!Number.isInteger(connectorId)||connectorId<1||connectorId>128||
           !Number.isFinite(meterStart)||meterStart<0){fail('PropertyConstraintViolation','Ungültige Transaktionswerte');return;}
        if(p.idTag!=='CV-SIM-TEST'&&!await allowsTestRfid(pool,ctx,p.idTag,connectorId)){
          reply({transactionId:0,idTagInfo:{status:'Invalid'}});return;
        }
        const existing=await pool.query(
          'SELECT id FROM cv_ocpp_transactions WHERE identity=$1 AND connector_id=$2 AND stopped_at IS NULL LIMIT 1',
          [ctx.identity,connectorId]);
        if(existing.rowCount){fail('OccurenceConstraintViolation','Transaktion bereits aktiv');return;}
        const tx=await pool.query(
          'INSERT INTO cv_ocpp_transactions(identity,tenant_id,connector_id,meter_start_wh,simulated) VALUES($1,$2,$3,$4,true) RETURNING id',
          [ctx.identity,ctx.tenantId,connectorId,meterStart]);
        if(!tx.rowCount)throw Error('transaction ID unavailable');
        await event(ctx,c.action,{transactionId:Number(tx.rows[0].id),connectorId,meterStart});
        reply({transactionId:Number(tx.rows[0].id),idTagInfo:{status:'Accepted'}});return;
      }
      case 'StopTransaction': {
        if(!ctx.simulated){
          const result=await physical.stop(ctx,p);
          if(result.error){fail('PropertyConstraintViolation',result.error);return;}
          if(!result.replayed)await event(ctx,c.action,{transactionId:p.transactionId,meterStop:p.meterStop});
          reply({});return;
        }
        const id=Number(p.transactionId),meterStop=Number(p.meterStop);
        if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(meterStop)||meterStop<0){
          fail('PropertyConstraintViolation','Ungültiges Transaktionsende');return;
        }
        const closed=await pool.query(
          'UPDATE cv_ocpp_transactions SET meter_stop_wh=$1,stopped_at=now() '+
          'WHERE id=$2 AND identity=$3 AND tenant_id=$4 AND stopped_at IS NULL RETURNING id',
          [meterStop,id,ctx.identity,ctx.tenantId]);
        if(closed.rowCount){
          await event(ctx,c.action,{transactionId:id,meterStop});
        }else{
          const previous=await pool.query(
            'SELECT id FROM cv_ocpp_transactions WHERE id=$1 AND identity=$2 AND tenant_id=$3 AND stopped_at IS NOT NULL AND meter_stop_wh=$4',
            [id,ctx.identity,ctx.tenantId,meterStop]);
          if(!previous.rowCount){fail('PropertyConstraintViolation','Unbekannte Transaktion');return;}
        }
        reply({idTagInfo:{status:'Accepted'}});return;
      }
      case 'DiagnosticsStatusNotification': {
        if(!['Idle','Uploaded','UploadFailed','Uploading'].includes(p.status)){
          fail('PropertyConstraintViolation','Ungültiger Diagnose-Status');return;
        }
        await event(ctx,c.action,{status:p.status});reply({});return;
      }
      case 'FirmwareStatusNotification': {
        if(!['Downloaded','DownloadFailed','Downloading','Idle','InstallationFailed','Installing','Installed'].includes(p.status)){
          fail('PropertyConstraintViolation','Ungültiger Firmware-Status');return;
        }
        await event(ctx,c.action,{status:p.status});reply({});return;
      }
      case 'DataTransfer': {
        if(typeof p.vendorId!=='string'||!p.vendorId.trim()||p.vendorId.length>255||
           (p.messageId!==undefined&&(typeof p.messageId!=='string'||p.messageId.length>50))){
          fail('PropertyConstraintViolation','Ungültige Hersteller-Nachricht');return;
        }
        // No proprietary vendor behavior is presumed to be supported.
        // Never store arbitrary vendor data (which can contain secrets).
        await event(ctx,c.action,{vendorId:p.vendorId,messageId:p.messageId||null,status:'UnknownVendorId'});
        reply({status:'UnknownVendorId'});return;
      }
      default:fail('NotSupported','OCPP-Aktion noch nicht implementiert');
      }
    }catch(e){console.error('ChargeVisor OCPP processing error:',e.code||e.message);fail('InternalError','Interner Fehler');}
  }
  function sendCommand(ctx,action,payload,{raw=false}={}){
    if(ctx.ws.readyState!==WebSocket.OPEN)
      return Promise.resolve(raw?{ok:false,error:'Disconnected'}:'Disconnected');
    return new Promise(resolve=>{
      const id=randomUUID();
      const timer=setTimeout(()=>finish(raw?{ok:false,error:'Timeout'}:'Timeout'),6000);
      function finish(status){
        if(ctx.pendingCommand?.id!==id)return;
        ctx.pendingCommand=null;
        clearTimeout(timer);
        resolve(status);
      }
      ctx.pendingCommand={id,finish,raw};
      ctx.ws.send(JSON.stringify([2,id,action,payload]),error=>{
        if(error)finish(raw?{ok:false,error:'Disconnected'}:'Disconnected');
      });
    });
  }
  function handleCommandResponse(ctx,frame){
    const pending=ctx.pendingCommand;
    if(!pending||pending.id!==frame[1])return;
    if(frame[0]===4){
      const known=frame.length===5&&['NotSupported','NotImplemented'].includes(frame[2]);
      if(pending.raw)pending.finish({ok:false,error:known?'NotSupported':'CommandError',
        errorCode:typeof frame[2]==='string'?frame[2]:null});
      else pending.finish(known?'NotSupported':'CommandError');
      return;
    }
    if(pending.raw){
      const response=frame[2];
      if(frame.length!==3||!response||typeof response!=='object'||Array.isArray(response))
        pending.finish({ok:false,error:'InvalidResponse'});
      else pending.finish({ok:true,response});
      return;
    }
    const status=frame[2]?.status;
    const valid=frame.length===3&&['Accepted','Rejected','RebootRequired','NotSupported'].includes(status);
    pending.finish(valid?status:'InvalidResponse');
  }
  async function advancedCommand(station,action,payload){
    const validation=validateOcppCsmsCommand(action,payload);
    if(!validation.ok)return {code:400,error:validation.error};
    const ctx=active.get(station.identity);
    if(!ctx||!ctx.simulated||ctx.tenantId!==station.tenant_id||
       ctx.stationId!==station.station_id||ctx.ws.readyState!==WebSocket.OPEN)
      return {code:409,error:'Test-Wallbox ist nicht verbunden'};
    if(ctx.pendingCommand||ctx.controlling||ctx.configuringFreecharge||ctx.advancedInProgress)
      return {code:409,error:'Die Test-Wallbox verarbeitet bereits einen Befehl'};
    ctx.advancedInProgress=true;
    try{
      const outcome=await sendCommand(ctx,action,payload,{raw:true});
      if(!outcome.ok)return {code:409,error:outcome.error,errorCode:outcome.errorCode||null};
      // Only audit the action and result. Do not log tokens, RFID IDs or URLs.
      await event(ctx,'CSMS.'+action,{responseStatus:outcome.response.status||null});
      return {code:200,action,response:outcome.response};
    }finally{ctx.advancedInProgress=false;}
  }
  async function configureFreecharge(point){
    const ctx=active.get(point.ocpp_identity);
    if(!ctx||ctx.tenantId!==point.tenant_id||ctx.stationId!==point.station_id||
      ctx.simulated||ctx.ws.readyState!==WebSocket.OPEN)
      return {code:409,body:{error:'Die Wallbox ist nicht mit ChargeVisor verbunden'}};
    if(ctx.configuringFreecharge||ctx.controlling)
      return {code:409,body:{error:'Für diese Wallbox läuft bereits ein Konfigurationsauftrag'}};
    ctx.configuringFreecharge=true;
    try{
      return await applyLuminaFreecharge(point.freecharge_enabled,(action,payload)=>sendCommand(ctx,action,payload));
    }finally{ctx.configuringFreecharge=false;}
  }
  async function control(point,actor,command){
    const ctx=active.get(point.ocpp_identity);
    if(!ctx||ctx.tenantId!==point.tenant_id||ctx.stationId!==point.station_id||ctx.simulated||
       ctx.ws.readyState!==WebSocket.OPEN)return {code:409,error:'Die Wallbox ist offline'};
    if(ctx.configuringFreecharge||ctx.controlling||ctx.pendingCommand)return {code:409,error:'Die Wallbox verarbeitet bereits einen Befehl'};
    const connector=point.connector_number;
    ctx.controlling=true;
    try{
      const {rows:[tx]}=await pool.query(
        'SELECT id,user_id,remote_paused FROM cv_ocpp_transactions WHERE tenant_id=$1 AND identity=$2 AND connector_id=$3 AND NOT simulated AND stopped_at IS NULL',
        [point.tenant_id,point.ocpp_identity,connector]);
      if(actor.role==='user'&&tx&&tx.user_id!==actor.id)return {code:403,error:'Dieser Ladevorgang gehört einem anderen Nutzer'};
      const id=Number(tx?.id);
      let action,payload,paused;
      if(command==='reset'){
        const busy=await pool.query('SELECT 1 FROM cv_ocpp_transactions WHERE identity=$1 AND NOT simulated AND stopped_at IS NULL LIMIT 1',[ctx.identity]);
        if(busy.rowCount)return {code:409,error:'Vor dem Neustart alle Ladevorgänge beenden'};
        [action,payload]=['Reset',{type:'Soft'}];
      }else if(command==='start'&&!tx){
        const {rows:[live]}=await pool.query('SELECT status FROM cv_ocpp_connector_live WHERE identity=$1 AND connector_id=$2',[ctx.identity,connector]);
        if(!['Preparing','SuspendedEV','SuspendedEVSE'].includes(live?.status))return {code:409,error:'Die Wallbox meldet kein angeschlossenes Fahrzeug'};
        if(!ctx.remoteStart?.startedAt&&ctx.remoteStart?.expires>Date.now())return {code:409,error:'Ein Startbefehl wartet auf die Wallbox'};
        const tag='CVR-'+randomBytes(8).toString('hex');
        ctx.remoteStart={tag,expires:Date.now()+90000,connector,pointId:point.id,actorId:actor.id,userId:actor.role==='user'?actor.id:null};
        [action,payload]=['RemoteStartTransaction',{connectorId:connector,idTag:tag}];
      }else if(!tx||!Number.isSafeInteger(id)||id>2147483647){
        return {code:409,error:'Kein aktiver Ladevorgang an diesem Ladepunkt'};
      }else if(command==='stop'){
        [action,payload]=['RemoteStopTransaction',{transactionId:id}];
      }else if(command==='pause'&&!tx.remote_paused){
        [action,payload]=['SetChargingProfile',{connectorId:connector,csChargingProfiles:{
          chargingProfileId:id,transactionId:id,stackLevel:0,chargingProfilePurpose:'TxProfile',
          chargingProfileKind:'Relative',chargingSchedule:{chargingRateUnit:'A',chargingSchedulePeriod:[{startPeriod:0,limit:0}]}
        }}];
        paused=true;
      }else if(command==='start'&&tx.remote_paused){
        [action,payload]=['ClearChargingProfile',{id}];
        paused=false;
      }else return {code:409,error:'Der aktuelle Ladezustand erlaubt diesen Befehl nicht'};
      const status=await sendCommand(ctx,action,payload);
      if(status!=='Accepted'){
        if(action==='RemoteStartTransaction')ctx.remoteStart=null;
        return {code:409,error:status==='Timeout'?'Die Wallbox antwortet nicht':'Die Wallbox hat den Befehl nicht bestätigt ('+status+')'};
      }
      if(paused!==undefined)
        await pool.query('UPDATE cv_ocpp_transactions SET remote_paused=$2 WHERE id=$1 AND stopped_at IS NULL',[tx.id,paused]);
      await pool.query('INSERT INTO cv_audit(actor_id,tenant_id,action,target_id) VALUES($1,$2,$3,$4)',
        [actor.id,point.tenant_id,'ocpp_'+command,point.id]);
      return {code:200,status};
    }finally{ctx.controlling=false;}
  }
  async function upgrade(req,socket,head){
    let identity;
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(!path.startsWith('/ocpp/'))return reject(socket,404);
      const segments=path.slice('/ocpp/'.length).split('/');
      identity=decodeURIComponent(segments[0]);
      // Some wallboxes append their configured ID to an endpoint that already contains it.
      if(segments.length>2||(segments.length===2&&decodeURIComponent(segments[1])!==identity))
        return reject(socket,400);
    }catch{return reject(socket,400);}
    if(!validId(identity)||!String(req.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim()).includes('ocpp1.6'))return reject(socket,400);
    const a=parseBasic(req.headers.authorization);if(!a||a.id!==identity||!a.password)return reject(socket);
    try{
      const r=await pool.query('SELECT c.tenant_id,c.station_id,c.password_hash,t.status,s.is_simulator FROM cv_ocpp_credentials c JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id JOIN cv_tenants t ON t.id=c.tenant_id WHERE c.identity=$1 AND t.deleted_at IS NULL',[identity]);
      if(!r.rowCount||r.rows[0].status!=='active')return reject(socket);
      const row=r.rows[0],remote=String(req.socket.remoteAddress||''),loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
      const token=virtualTokens.get(identity);
      const localVirtual=!!(row.is_simulator&&loopback&&token&&token.until>Date.now()&&token.secret===a.password);
      // An independent external OCPP simulator may authenticate using the real,
      // provisioned test-station password. Simulation mode is tied to the
      // station's explicit is_simulator flag, never to a client-provided value.
      if(!localVirtual&&!await verifyPassword(a.password,row.password_hash))return reject(socket);
      const simulated=!!row.is_simulator;
      if(req.headers['x-chargevisor-test-wallbox']==='1'&&!simulated)return reject(socket,403);
      if(localVirtual)virtualTokens.delete(identity);
      if(active.has(identity))return reject(socket,409);
      wss.handleUpgrade(req,socket,head,ws=>{
        const ctx={ws,identity,tenantId:row.tenant_id,stationId:row.station_id,simulated};
        active.set(identity,ctx);
        let queue=pool.query('UPDATE cv_ocpp_credentials SET last_connected_at=now() WHERE identity=$1 AND tenant_id=$2',
          [identity,ctx.tenantId]).then(()=>state(ctx,{action:'Connected'}))
          .catch(e=>console.error('OCPP open:',e.code||e.message));
        let pending=0;
        let pong=true;
        ws.on('pong',()=>{pong=true;});
        const ping=setInterval(()=>{
          if(!pong){ws.terminate();return;}
          if(ws.readyState===WebSocket.OPEN){pong=false;ws.ping();}
        },30000).unref();
        ws.on('message',m=>{
          const frame=parseFrame(m);
          if(Array.isArray(frame)&&(frame[0]===3||frame[0]===4)){
            handleCommandResponse(ctx,frame);
            return;
          }
          if(pending>=32){ws.close(1008,'OCPP-Nachrichtenlimit');return;}
          pending++;
          queue=queue.then(()=>process(ctx,frame)).catch(e=>console.error('OCPP queue:',e.code||e.message))
            .finally(()=>{pending--;});
        });
        ws.on('close',()=>{
          clearInterval(ping);
          ctx.pendingCommand?.finish(ctx.pendingCommand.raw?{ok:false,error:'Disconnected'}:'Disconnected');
          queue.then(()=>state(ctx,{connected:false,action:'Disconnected'}))
            .catch(e=>console.error('OCPP close:',e.code||e.message))
            .finally(()=>{if(active.get(identity)===ctx)active.delete(identity);});
        });
        ws.on('error',e=>console.error('OCPP socket:',e.message));
      });
    }catch(e){console.error('OCPP handshake:',e.code||e.message);reject(socket,503);}
  }
  async function simulate(identity,port){
    if(active.has(identity))throw Error('Virtuelle Wallbox bereits verbunden');
    const secret=randomBytes(32).toString('base64url');
    virtualTokens.set(identity,{secret,until:Date.now()+30000});
    const client=new WebSocket('ws://127.0.0.1:'+port+'/ocpp/'+encodeURIComponent(identity),['ocpp1.6'],{headers:{Authorization:'Basic '+Buffer.from(identity+':'+secret).toString('base64')},handshakeTimeout:5000});
    const results=[];let number=0;
    const request=(action,payload)=>new Promise((resolve,reject)=>{
      const id='virtual-'+(++number);
      const timer=setTimeout(()=>{client.off('message',onMessage);reject(Error('Keine Antwort auf '+action));},7000);
      const onMessage=buf=>{
        let m;try{m=JSON.parse(buf.toString());}catch{return;}
        if(m[1]!==id)return;
        clearTimeout(timer);client.off('message',onMessage);
        if(m[0]===3){results.push({action,reply:m[2]});resolve(m[2]);}
        else reject(Error('OCPP-Fehler '+action+': '+JSON.stringify(m)));
      };
      client.on('message',onMessage);client.send(JSON.stringify([2,id,action,payload]));
    });
    try{
      await Promise.race([
        new Promise((resolve,reject)=>{client.once('open',resolve);client.once('error',reject);}),
        new Promise((_,reject)=>setTimeout(()=>reject(Error('WebSocket Timeout')),7000))
      ]);
      const boot=await request('BootNotification',{chargePointVendor:'ChargeVisor',chargePointModel:'Virtual Test Wallbox',firmwareVersion:'sim-1.0'});
      if(boot.status!=='Accepted')throw Error('BootNotification rejected');
      await request('Heartbeat',{});
      await request('StatusNotification',{connectorId:1,status:'Available',errorCode:'NoError'});
      await request('MeterValues',{connectorId:1,meterValue:[{timestamp:now(),sampledValue:[
        {value:'1250',unit:'Wh',measurand:'Energy.Active.Import.Register'},
        {value:'0',unit:'W',measurand:'Power.Active.Import'}
      ]}]});
      return {ok:true,simulated:true,identity,results};
    }finally{
      virtualTokens.delete(identity);
      client.close();
    }
  }
  function issueVirtualToken(identity){
    const secret=randomBytes(32).toString('base64url');
    virtualTokens.set(identity,{secret,until:Date.now()+120000});
    return secret;
  }
  return {upgrade,simulate,active,issueVirtualToken,physical,configureFreecharge,control,advancedCommand};
}
export function createOcppApi({pool,getActor,bridge,port,env}){
  const origin=String(env.CV_PUBLIC_URL||'').replace(/\/$/,'');
  const testVerifier=createOcppTestVerifier({pool,env});
  return async(req,res,path)=>{
    if(path==='/api/ocpp/test-verification')return testVerifier(req,res);
    try{
      const actor=await getActor(req);
      if(!actor)return sendJSON(res,401,{error:'Nicht angemeldet'});
      const params=new URL(req.url,'http://localhost').searchParams;
      const tenantId=actor.role==='superadmin'?params.get('tenantId'):actor.tenant_id;
      if(path==='/api/ocpp/test-command'&&req.method==='POST'){
        // Disabled in production unless deliberately enabled. Never send an
        // arbitrary OCPP command to a real/customer charger from this route.
        if(env.CV_OCPP_TEST_COMMANDS!=='1')return sendJSON(res,404,{error:'Testbefehle deaktiviert'});
        if(actor.role!=='superadmin')return sendJSON(res,403,{error:'Nur Walectra darf Testbefehle ausführen'});
        if(!origin||req.headers.origin!==origin||
           String(req.headers['content-type']||'').split(';')[0]!=='application/json')
          return sendJSON(res,403,{error:'Ungültige Anfragequelle'});
        const chunks=[];let size=0;
        for await(const chunk of req){
          size+=chunk.length;
          if(size>16384)return sendJSON(res,413,{error:'Testauftrag zu groß'});
          chunks.push(chunk);
        }
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
        catch{return sendJSON(res,400,{error:'Ungültiges JSON'});}
        const tid=body?.tenantId,identity=body?.identity,action=body?.action;
        if(!validUuid(tid)||!validId(identity))
          return sendJSON(res,400,{error:'Testkunde und OCPP-Identität erforderlich'});
        const validation=validateOcppCsmsCommand(action,body?.payload);
        if(!validation.ok)return sendJSON(res,400,{error:validation.error});
        const station=await pool.query(
          "SELECT c.identity,c.station_id,c.tenant_id FROM cv_ocpp_credentials c "+
          "JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id "+
          "JOIN cv_tenants t ON t.id=c.tenant_id AND t.status='active' AND t.deleted_at IS NULL "+
          "WHERE c.identity=$1 AND c.tenant_id=$2 AND s.is_simulator=true",
          [identity,tid]);
        if(!station.rowCount)return sendJSON(res,404,{error:'Isolierte Teststation nicht gefunden'});
        const result=await bridge.advancedCommand(station.rows[0],action,body.payload);
        const {code,...data}=result;
        return sendJSON(res,code,data);
      }
      if(path==='/api/ocpp/freecharge-configuration'){
        return await handleFreechargeConfiguration({
          pool,actor,req,origin,send:(status,data)=>sendJSON(res,status,data),configure:bridge.configureFreecharge
        });
      }
      if(path==='/api/ocpp/rfid'){
        return await bridge.physical.handleRfid({actor,req,params,origin,send:(status,data)=>sendJSON(res,status,data)});
      }
      if(path==='/api/ocpp/control'&&req.method==='POST'){
        if(!origin||req.headers.origin!==origin||String(req.headers['content-type']||'').split(';')[0]!=='application/json')
          return sendJSON(res,403,{error:'Ungültige Anfragequelle'});
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)return sendJSON(res,413,{error:'Anfrage zu groß'});chunks.push(chunk);}
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return sendJSON(res,400,{error:'Ungültige Anfrage'});}
        const {pointId,command}=body||{};
        const tid=actor.role==='superadmin'?body?.tenantId:tenantId;
        if(!validUuid(tid)||!validUuid(pointId)||!['start','stop','pause','reset'].includes(command))
          return sendJSON(res,400,{error:'Ladepunkt und Befehl prüfen'});
        const permitted=actor.role==='superadmin'||(command==='reset'?
          actor.role==='admin'&&actor.can_reset_station===true:
          ['admin','user'].includes(actor.role)&&actor.can_control_charging===true);
        if(!permitted)return sendJSON(res,403,{error:'Premium-Funktion. Kontaktiere Walectra für die Freischaltung.'});
        const {rows:[point]}=await pool.query(`
          SELECT p.* FROM cv_chargepoints p JOIN cv_stations s ON s.id=p.station_id AND s.tenant_id=p.tenant_id
          JOIN cv_tenants t ON t.id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2 AND p.enabled AND NOT s.is_simulator
            AND t.status='active' AND t.deleted_at IS NULL AND ($3::uuid IS NULL OR EXISTS(
              SELECT 1 FROM cv_point_access a WHERE a.user_id=$3 AND a.chargepoint_id=p.id AND a.tenant_id=p.tenant_id))
        `,[pointId,tid,actor.role==='user'?actor.id:null]);
        if(!point)return sendJSON(res,404,{error:'Aktiver Ladepunkt nicht gefunden'});
        const {code,...result}=await bridge.control(point,actor,command);
        return sendJSON(res,code,result);
      }
      const filters={userId:params.get('userId'),siteId:params.get('siteId'),from:params.get('from'),to:params.get('to')};
      if(req.method==='GET'&&['/api/ocpp/sessions','/api/ocpp/reports/charging.pdf'].includes(path)){
        const validDay=value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&value.slice(0,4)!=='0000'&&
          Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
        if((filters.userId&&!validUuid(filters.userId))||(filters.siteId&&!validUuid(filters.siteId))||!validDay(filters.from)||!validDay(filters.to)||
           (filters.from&&filters.to&&filters.from>filters.to))
          return sendJSON(res,400,{error:'Bitte Standort, Nutzer und Zeitraum prüfen.'});
        for(const key of Object.keys(filters))if(!filters[key])filters[key]=null;
      }
      if(path==='/api/ocpp/analytics'&&req.method==='GET'){
        const periods={day:['day','hour'],week:['week','day'],month:['month','day'],year:['year','month'],all:[null,'year']};
        const period=periods[params.get('period')||'month'];
        const site=params.get('siteId')||null;
        if(!validUuid(tenantId)||!Array.isArray(period)||(site&&!validUuid(site)))
          return sendJSON(res,400,{error:'Standort oder Zeitraum ungültig'});
        const {rows}=await pool.query(`
          SELECT date_trunc($5,x.started_at AT TIME ZONE 'Europe/Berlin')::text AS bucket,
            count(*)::int AS sessions,
            sum(CASE WHEN x.meter_stop_wh>=x.meter_start_wh THEN (x.meter_stop_wh-x.meter_start_wh)/1000 END) AS kwh
          FROM cv_ocpp_transactions x JOIN cv_ocpp_credentials c ON c.identity=x.identity AND c.tenant_id=x.tenant_id
            JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id
          WHERE x.tenant_id=$1 AND NOT x.simulated AND x.stopped_at IS NOT NULL
            AND ($2::uuid IS NULL OR x.user_id=$2) AND ($3::uuid IS NULL OR s.site_id=$3)
            AND ($4::text IS NULL OR x.started_at>=date_trunc($4,now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
          GROUP BY 1 ORDER BY 1`,[tenantId,actor.role==='user'?actor.id:null,site,...period]);
        const [sessions,power]=await Promise.all([
          bridge.physical.history(actor,tenantId,{limit:8,siteId:site}),
          params.get('metric')==='power'?bridge.physical.powerHistory(actor,tenantId,site):[]
        ]);
        return sendJSON(res,200,{buckets:rows,sessions,power,period:params.get('period')||'month'});
      }
      if(path==='/api/ocpp/sessions'&&req.method==='GET'){
        if(!validUuid(tenantId))return sendJSON(res,400,{error:'Kunde auswählen'});
        if(params.get('months')==='1')
          return sendJSON(res,200,{firstMonth:await bridge.physical.firstHistoryMonth(actor,tenantId)});
        if(params.get('export')==='1'){
          const beforeId=params.get('beforeId');
          if(beforeId!==null&&(!/^[1-9]\d{0,18}$/.test(beforeId)||BigInt(beforeId)>9223372036854775807n))
            return sendJSON(res,400,{error:'Ungültige Position im Ladeverlauf.'});
          const pageSize=500;
          const rows=await bridge.physical.history(actor,tenantId,{...filters,beforeId,limit:pageSize+1});
          const sessions=rows.slice(0,pageSize);
          return sendJSON(res,200,{sessions,nextCursor:rows.length>pageSize?sessions.at(-1).id:null});
        }
        return sendJSON(res,200,{sessions:await bridge.physical.history(actor,tenantId,filters)});
      }
      if(path==='/api/ocpp/reports/charging.pdf'&&req.method==='GET'){
        if(actor.role!=='superadmin'&&(actor.role!=='admin'||actor.can_download_pdf!==true))
          return sendJSON(res,403,{error:'PDF-Ladeberichte müssen von Walectra freigegeben werden.'});
        if(!validUuid(tenantId))return sendJSON(res,400,{error:'Kunde auswählen'});
        const {rows:[tenant]}=await pool.query('SELECT name FROM cv_tenants WHERE id=$1 AND deleted_at IS NULL',[tenantId]);
        if(!tenant)return sendJSON(res,404,{error:'Kunde nicht gefunden'});
        const pdf=await chargingReport(tenant.name,await bridge.physical.history(actor,tenantId,filters));
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="ChargeVisor-Ladebericht.pdf"',
          'Content-Length':pdf.length,'Cache-Control':'no-store'});
        res.end(pdf);
        return;
      }
      if(path==='/api/ocpp/test-rfid'){
        return await handleTestRfid({pool,actor,req,params,origin,send:(status,data)=>sendJSON(res,status,data)});
      }
      if(path==='/api/ocpp/test-sessions'&&req.method==='GET'){
        if(actor.role!=='superadmin')return sendJSON(res,403,{error:'Nur Walectra darf Testladevorgänge sehen'});
        if(!validUuid(tenantId))return sendJSON(res,400,{error:'Kunde auswählen'});
        const sessions=await pool.query(`
          SELECT x.id,s.name AS station_name,p.name AS point_name,x.connector_id,
            x.meter_start_wh,x.meter_stop_wh,x.started_at,x.stopped_at,x.simulated
          FROM cv_ocpp_transactions x
          JOIN cv_ocpp_credentials c ON c.identity=x.identity AND c.tenant_id=x.tenant_id
          JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id AND s.is_simulator
          LEFT JOIN cv_chargepoints p ON p.tenant_id=c.tenant_id AND p.station_id=c.station_id
            AND p.ocpp_identity=x.identity AND p.connector_number=x.connector_id
          WHERE x.tenant_id=$1 AND x.simulated
          ORDER BY x.started_at DESC,x.id DESC LIMIT 100`,[tenantId]);
        return sendJSON(res,200,{sessions:sessions.rows});
      }
      if(path==='/api/ocpp/live'&&req.method==='GET'){
        if(!tenantId)return sendJSON(res,400,{error:'Kunde auswählen'});
        const liveFields='l.station_id,l.connected,l.vendor,l.model,l.firmware,l.simulated,l.last_seen,s.is_simulator';
        const liveSource=' FROM cv_ocpp_live l JOIN cv_stations s ON s.id=l.station_id AND s.tenant_id=l.tenant_id';
        const r=actor.role==='user'?await pool.query('SELECT p.id AS point_id,'+liveFields+liveSource+
          ' JOIN cv_chargepoints p ON p.ocpp_identity=l.identity AND p.station_id=l.station_id AND p.tenant_id=l.tenant_id'+
          ' JOIN cv_point_access a ON a.chargepoint_id=p.id AND a.tenant_id=p.tenant_id'+
          ' WHERE l.tenant_id=$1 AND a.user_id=$2',[tenantId,actor.id]):
          await pool.query('SELECT l.identity,l.status,l.action,l.energy_wh,l.power_w,'+liveFields+liveSource+' WHERE l.tenant_id=$1',[tenantId]);
        const connectorFields='x.station_id,x.connector_id,x.status,x.energy_wh,x.power_w,x.simulated,x.last_seen,x.power_updated_at,x.status_changed_at,x.error_code,x.error_info';
        const transactionState=await pool.query(
          'SELECT chargepoint_id AS point_id,remote_paused FROM cv_ocpp_transactions WHERE tenant_id=$1 AND NOT simulated AND stopped_at IS NULL AND ($2::uuid IS NULL OR user_id=$2)',
          [tenantId,actor.role==='user'?actor.id:null]);
        const cs=actor.role==='user'?
          await pool.query('SELECT p.id AS point_id,'+connectorFields+' FROM cv_ocpp_connector_live x'+
            ' JOIN cv_chargepoints p ON p.ocpp_identity=x.identity AND p.station_id=x.station_id AND p.tenant_id=x.tenant_id AND p.connector_number=x.connector_id'+
            ' JOIN cv_point_access a ON a.chargepoint_id=p.id AND a.tenant_id=p.tenant_id'+
            ' WHERE x.tenant_id=$1 AND a.user_id=$2',[tenantId,actor.id]):
          await pool.query('SELECT x.identity,'+connectorFields+' FROM cv_ocpp_connector_live x WHERE x.tenant_id=$1',[tenantId]);
        return sendJSON(res,200,{
          live:actor.role==='user'?r.rows.map(({identity,status,action,energy_wh,power_w,...x})=>x):r.rows,
          connectors:actor.role==='user'?cs.rows.map(({identity,...x})=>x):cs.rows,
          transactions:transactionState.rows
        });
      }
      if(path==='/api/ocpp/simulate'&&req.method==='POST'){
        if(actor.role!=='superadmin')return sendJSON(res,403,{error:'Nur Walectra darf den Simulator starten'});
        if(req.headers.origin!==origin||!String(req.headers['content-type']||'').startsWith('application/json'))return sendJSON(res,403,{error:'Ungültige Anfrage'});
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4000)return sendJSON(res,413,{error:'Anfrage zu groß'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return sendJSON(res,400,{error:'Ungültiges JSON'});}
        if(!validId(body.stationId)&&!/^[a-f0-9-]{36}$/i.test(String(body.stationId||'')))return sendJSON(res,400,{error:'Station fehlt'});
        if(!/^[a-f0-9-]{36}$/i.test(String(body.tenantId||'')))return sendJSON(res,400,{error:'Kunde fehlt'});
        const station=await pool.query('SELECT c.identity FROM cv_ocpp_credentials c JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id WHERE c.station_id=$1 AND c.tenant_id=$2 AND s.is_simulator=true ORDER BY c.identity LIMIT 1',[body.stationId,body.tenantId]);
        if(!station.rowCount)return sendJSON(res,403,{error:'Nur ausdrücklich als virtuell angelegte Test-Wallboxen dürfen simuliert werden'});
        const result=await bridge.simulate(station.rows[0].identity,port);
        return sendJSON(res,200,result);
      }
      return sendJSON(res,404,{error:'Unbekannter OCPP-Endpunkt'});
    }catch(e){console.error('OCPP API:',e.code||e.message);sendJSON(res,500,{error:'OCPP-Dienst vorübergehend nicht verfügbar'});}
  };
}
