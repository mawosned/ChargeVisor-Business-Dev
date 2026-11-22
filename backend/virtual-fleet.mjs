// Real OCPP 1.6J WebSocket clients, not synthetic database rows.
// This fleet is intentionally limited to stations marked is_simulator.
// For true 24/7 reliability deploy an independent always-on runner; this
// in-process worker stops if the Render app sleeps/restarts.
import {WebSocket} from 'ws';

const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(Error('stopped'));
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
  const cancel=()=>{clearTimeout(timer);reject(Error('stopped'));};
  signal.addEventListener('abort',cancel,{once:true});
});
const iso=()=>new Date().toISOString();
class VirtualCharger{
  constructor(identity,bridge,port,config={}){
    this.identity=identity;this.bridge=bridge;this.port=port;
    this.config={
      idleMs:config.idleMs??12000,prepareMs:config.prepareMs??3500,
      chargeMs:config.chargeMs??30000,finishMs:config.finishMs??4000,
      meterIntervalMs:config.meterIntervalMs??5000,heartbeatMs:config.heartbeatMs??20000,
      reconnectMs:config.reconnectMs??5000,
    };
    this.controller=new AbortController();
    this.ws=null;this.pending=new Map();this.next=0;this.energyWh=1000;this.cycles=0;
    this.job=null;this.lastError=null;
  }
  start(){if(!this.job)this.job=this.loop();return this;}
  stop(){
    this.controller.abort();
    try{this.ws?.close();}catch{}
    this.ws?.terminate?.();
  }
  async connect(){
    const token=this.bridge.issueVirtualToken(this.identity);
    const ws=new WebSocket('ws://127.0.0.1:'+this.port+'/ocpp/'+encodeURIComponent(this.identity),
      ['ocpp1.6'],{headers:{Authorization:'Basic '+Buffer.from(this.identity+':'+token).toString('base64')},handshakeTimeout:5000});
    this.ws=ws;
    const onMessage=raw=>{
      let frame;try{frame=JSON.parse(raw.toString());}catch{return;}
      const awaited=this.pending.get(frame[1]);if(!awaited)return;
      this.pending.delete(frame[1]);clearTimeout(awaited.timer);
      if(frame[0]===3)awaited.resolve(frame[2]);
      else awaited.reject(Error('OCPP '+awaited.action+' rejected: '+JSON.stringify(frame)));
    };
    ws.on('message',onMessage);
    ws.on('close',()=>{
      for(const req of this.pending.values()){clearTimeout(req.timer);req.reject(Error('WebSocket closed'));}
      this.pending.clear();
    });
    await Promise.race([
      new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);}),
      sleep(8000,this.controller.signal).then(()=>{throw Error('WebSocket connect timeout');})
    ]);
    return ws;
  }
  call(action,payload){
    const ws=this.ws;
    if(!ws||ws.readyState!==WebSocket.OPEN)return Promise.reject(Error('Virtual charger disconnected'));
    const id='cvfleet-'+(++this.next);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);reject(Error('OCPP '+action+' timeout'));
      },5000);
      this.pending.set(id,{action,timer,resolve,reject});
      ws.send(JSON.stringify([2,id,action,payload]),err=>{
        if(err&&this.pending.has(id)){
          this.pending.delete(id);clearTimeout(timer);reject(err);
        }
      });
    });
  }
  async oneCycle(){
    const cfg=this.config,signal=this.controller.signal;
    await this.call('StatusNotification',{connectorId:1,status:'Available',errorCode:'NoError'});
    await sleep(cfg.idleMs,signal);
    await this.call('StatusNotification',{connectorId:1,status:'Preparing',errorCode:'NoError'});
    await sleep(cfg.prepareMs,signal);
    const authorization=await this.call('Authorize',{idTag:'CV-SIM-TEST'});
    if(authorization.idTagInfo?.status!=='Accepted')throw Error('Simulator authorization failed');
    const start=await this.call('StartTransaction',{
      connectorId:1,idTag:'CV-SIM-TEST',meterStart:this.energyWh,timestamp:iso()});
    if(start.idTagInfo?.status!=='Accepted'||!Number.isSafeInteger(start.transactionId)||start.transactionId<=0)
      throw Error('Simulated charging transaction rejected');
    await this.call('StatusNotification',{connectorId:1,status:'Charging',errorCode:'NoError'});
    const periods=Math.max(1,Math.ceil(cfg.chargeMs/cfg.meterIntervalMs));
    for(let i=0;i<periods;i++){
      await sleep(cfg.meterIntervalMs,signal);
      this.energyWh+=Math.round(7200*cfg.meterIntervalMs/3600000);
      await this.call('MeterValues',{connectorId:1,transactionId:start.transactionId,meterValue:[{
        timestamp:iso(),sampledValue:[
          {value:String(this.energyWh),measurand:'Energy.Active.Import.Register',unit:'Wh'},
          {value:'7200',measurand:'Power.Active.Import',unit:'W'}
        ]}]});
    }
    await this.call('StopTransaction',{
      transactionId:start.transactionId,meterStop:this.energyWh,timestamp:iso(),reason:'Local',idTag:'CV-SIM-TEST'});
    await this.call('StatusNotification',{connectorId:1,status:'Finishing',errorCode:'NoError'});
    await sleep(cfg.finishMs,signal);
    this.cycles++;
    await this.call('StatusNotification',{connectorId:1,status:'Available',errorCode:'NoError'});
    await this.call('MeterValues',{connectorId:1,meterValue:[{timestamp:iso(),sampledValue:[
      {value:String(this.energyWh),measurand:'Energy.Active.Import.Register',unit:'Wh'},
      {value:'0',measurand:'Power.Active.Import',unit:'W'}]}]});
  }
  async loop(){
    const signal=this.controller.signal;
    while(!signal.aborted){
      let heartbeat=null;
      try{
        await this.connect();
        const boot=await this.call('BootNotification',{
          chargePointVendor:'ChargeVisor',chargePointModel:'Virtual Wallbox (automated)',
          firmwareVersion:'sim-1.0'});
        if(boot.status!=='Accepted')throw Error('BootNotification rejected');
        heartbeat=setInterval(()=>{
          if(this.ws?.readyState===WebSocket.OPEN)
            this.call('Heartbeat',{}).catch(e=>{this.lastError=e.message;this.ws?.terminate();});
        },this.config.heartbeatMs);
        while(!signal.aborted&&this.ws?.readyState===WebSocket.OPEN){
          await this.oneCycle();
        }
      }catch(e){if(!signal.aborted){this.lastError=e.message;console.warn('ChargeVisor virtual charger',this.identity,e.message);}}
      finally{
        if(heartbeat)clearInterval(heartbeat);
        if(this.ws){this.ws.terminate();this.ws=null;}
      }
      if(!signal.aborted)try{await sleep(this.config.reconnectMs,signal);}catch{}
    }
  }
  status(){return {identity:this.identity,connected:this.ws?.readyState===WebSocket.OPEN,
    cycles:this.cycles,lastError:this.lastError};}
}
export function createVirtualFleet({pool,bridge,port,config={},syncMs=30000}){
  const units=new Map();
  let timer=null,stopped=false,syncing=false;
  async function sync(){
    if(stopped||syncing)return;
    syncing=true;
    try{
      const r=await pool.query(
        "SELECT c.identity FROM cv_ocpp_credentials c "+
        "JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id "+
        "JOIN cv_tenants t ON t.id=c.tenant_id "+
        "WHERE s.is_simulator=true AND t.status='active' AND t.deleted_at IS NULL ORDER BY c.identity");
      const ids=new Set(r.rows.map(x=>x.identity));
      for(const [id,unit] of units)if(!ids.has(id)){unit.stop();units.delete(id);}
      for(const id of ids)if(!units.has(id)){
        const unit=new VirtualCharger(id,bridge,port,config);units.set(id,unit);unit.start();
      }
    }catch(e){console.error('ChargeVisor virtual fleet sync:',e.message);}
    finally{syncing=false;}
  }
  function start(){
    if(timer||stopped)return;
    void sync();
    timer=setInterval(()=>void sync(),syncMs);
    timer.unref?.();
  }
  async function stop(){
    stopped=true;if(timer)clearInterval(timer);
    for(const unit of units.values())unit.stop();
    const jobs=[...units.values()].map(u=>u.job);
    units.clear();
    await Promise.allSettled(jobs);
  }
  return {start,sync,stop,status:()=>[...units.values()].map(x=>x.status())};
}
