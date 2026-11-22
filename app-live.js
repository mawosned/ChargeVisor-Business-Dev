(() => {
  'use strict';
  const db={tenants:[],sites:[],stations:[],people:[],chargers:[],sessions:[],tags:[],mode:{},ocpp:[],ocppConnectors:[]};
  const state={role:'user',tenant:'',person:'',page:'overview',query:'',expanded:'',siteOpen:'',
    sessionFilters:{month:'',custom:false,from:'',to:'',user:'',site:''}};
  const firstSessionMonth=new Map();
  let account=null;
  let overviewSite='',overviewPeriod='day',overviewMetric='power';
  const collapsedSites=new Set();
  const premiumText='Premium-Funktion. Kontaktiere Walectra für die Freischaltung.';
  const lockedAttrs=' aria-disabled="true" title="'+premiumText+'"';
  const testTools=()=>account?.testToolsEnabled===true;
  const canControl=()=>state.role==='super'||account?.canControlCharging===true;
  const canReset=()=>state.role==='super'||(state.role==='admin'&&account?.canResetStation===true);
  const activeCharge=point=>db.transactions?.find(x=>x.point_id===point.id);
  function measuredPower(point){
    const live=exactConnector(point);
    if(point.disabled||!liveForPoint(point)?.connected||!live?.status)return null;
    const age=Date.now()-Date.parse(live.power_updated_at);
    const watts=Number(live.power_w);
    if(live.power_w!=null&&Number.isFinite(age)&&age>=0&&age<=120000&&Number.isFinite(watts))return watts/1000;
    return ['Available','Preparing','Finishing'].includes(live.status)?0:null;
  }
  const kw=n=>Number(n).toLocaleString(locale(),{maximumFractionDigits:2})+' kW';
  function powerSummary(points){
    const active=points.filter(point=>!point.disabled);
    const powers=active.map(measuredPower);
    const known=powers.filter(value=>value!==null);
    return {kw:known.length?known.reduce((sum,value)=>sum+value,0):null,partial:known.length>0&&known.length<active.length};
  }
  const pointFault=point=>['Offline','Fehler','Warnung'].includes(deviceStatus(point));
  function faultReason(point){
    const live=liveForPoint(point);
    if(!live?.connected)return 'OCPP-Verbindung unterbrochen';
    if(live.error_info)return live.error_info;
    const labels=new Map([['ConnectorLockFailure','Ladestecker verriegelt nicht'],['EVCommunicationError','Kommunikation mit dem Fahrzeug gestört'],
      ['GroundFailure','Erdungsfehler'],['HighTemperature','Temperatur zu hoch'],['OverCurrentFailure','Überstrom erkannt']]);
    return labels.get(live.error_code)||(live.error_code&&live.error_code!=='NoError'?live.error_code:deviceStatus(point));
  }
  function controlButton(point,command,label,icon,allowed=canControl()){
    return '<button type="button" class="btn ghost small cv-control cv-control-'+command+'" data-ocpp-control="'+command+
      '" data-point-id="'+esc(point.id)+'" aria-label="'+label+'"'+(preview?' disabled':allowed?'':lockedAttrs)+'>'+icon+'</button>';
  }
  const chargeControlIcon={
    start:'<path d="M4 2.7a.65.65 0 0 1 1-.55l8 5.3a.65.65 0 0 1 0 1.1l-8 5.3A.65.65 0 0 1 4 13.3z"/>',
    pause:'<rect x="3" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.8" y="2.5" width="3.2" height="11" rx="1"/>',
    stop:'<rect x="3.5" y="3.5" width="9" height="9" rx="1.3"/>'
  };
  const controlIcon=command=>'<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">'+chargeControlIcon[command]+'</svg>';
  function pointControls(point,status){
    if(getStation(point)?.isSimulator||point.disabled)return '';
    const active=activeCharge(point);
    const play=()=>controlButton(point,'start',active?'Ladevorgang fortsetzen':'Ladevorgang starten',controlIcon('start'));
    const stop=()=>controlButton(point,'stop','Ladevorgang stoppen',controlIcon('stop'));
    if(status==='Lädt')return (active?.remote_paused?'':controlButton(point,'pause','Ladevorgang pausieren',controlIcon('pause')))+stop();
    if(status==='Pausiert')return stop()+(active?.remote_paused?play():'');
    if(status==='Verbunden'&&!active&&['Preparing','SuspendedEV','SuspendedEVSE'].includes(exactConnector(point)?.status))return play();
    return active&&status==='Verbunden'?stop():'';
  }
  function showPremium(feature){
    modal('Premium-Funktion','<p>'+premiumText+'</p><div class="modal-actions"><button class="btn ghost" data-close-modal>Schließen</button>'+
      '<a class="btn" target="_blank" rel="noopener" href="https://outlook.office.com/mail/deeplink/compose?to=info%40walectra.de&amp;subject='+encodeURIComponent('Freischaltung '+feature)+'&amp;body='+
      encodeURIComponent('Hallo Walectra, bitte schaltet '+feature+' für '+tenant().name+' frei.')+'">In Outlook schreiben</a></div>');
  }
  let preview=null;
  let changingView=false;
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const locale=()=>document.documentElement?.lang==='en'?'en-GB':'de-DE';
  const num = n => Number(n).toLocaleString(locale(),{minimumFractionDigits:1,maximumFractionDigits:1});
  const euro = n => Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const rateText = n => Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:4})+' €/kWh';
  const validPrice = value => Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=10;
  const rateForPerson = id => {
    const person=db.people.find(p=>p.id===id && p.tenant===state.tenant);
    const userRate=person?.rateOverride;
    return userRate!==null && userRate!==undefined && userRate!=='' ? Number(userRate) : Number(tenant()?.defaultRate??0.55);
  };
  const sessionRate = row => row.rateSnapshot!==undefined&&row.rateSnapshot!==null ? Number(row.rateSnapshot) : rateForPerson(row.personId);
  const sessionCost = row => Math.round(((Number(row.kwh)||0)*sessionRate(row)+Number.EPSILON)*100)/100;

  function toast(msg) {const el=$('toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4200);}
  const tenant = () => db.tenants.find(t=>t.id===state.tenant) || {id:'',name:'Noch kein Kunde',status:'pending'};
  const availablePeople = () => db.people.filter(p=>p.tenant===state.tenant);
  const availableTags = () => db.tags.filter(t=>t.tenant===state.tenant);
  const user = () => db.people.find(p=>p.id===state.person&&p.tenant===state.tenant) || {id:account?.id||'',name:account?.name||'Nutzer',chargerIds:[]};
  const peopleForCharger = cid => availablePeople().filter(p=>p.chargerIds.includes(cid));
  const chargerSite = c => c.siteId || '';
  const availableSites = () => db.sites.filter(x=>x.tenant===state.tenant);
  const boltIcon = (extra='') => '<img src="/assets/blitz-bolt.svg" class="bolt-icon '+extra+'" alt="" aria-hidden="true">';
  const pointIssue = c => c.disabled ? 'stillgelegt'
    : c.status==='Offline' ? 'offline'
    : /Störung|Fehler|Fault|Error|Suspicious|Warnung|Problem/i.test(c.status||'') ? 'warning'
    : '';
  const luminaLedClass = c=>{
    if(c.disabled)return 'off';
    if(!c.status||c.status==='Nicht verbunden'||c.status==='Verbunden'||c.status==='Unbekannt')return 'off';
    if(c.status==='Offline')return 'error';
    if(/Fehler|Fault|Error|Defekt/i.test(c.status||''))return 'error';
    if(/Warnung|Problem|Suspicious/i.test(c.status||''))return 'warning';
    if(c.status==='Lädt')return 'charging';
    return 'ready';
  };
  const luminaPreview = (c,small=false) => '<span class="lumina-preview lumina-'+luminaLedClass(c)+(small?' lumina-small':'')
      +'" role="img" aria-label="Lumina, Status '+esc(pointStatus(c))+'">'
      +'<img src="/assets/lumina-thumb.svg?v=2" alt="" loading="lazy"><span class="lumina-led" aria-hidden="true"></span></span>';
  const pointStatusLabel = c => c.disabled?'Stillgelegt':(c.status||'Unbekannt');
  const statusIcon = x => ['Nicht verbunden','Verbunden'].includes(x)?'<span class="charge-symbol unknown">○</span>':x==='Stillgelegt'?'<span class="charge-symbol offline">⊘</span>':x==='Lädt'?'<span class="charge-symbol charging">'+boltIcon('status-bolt')+'</span>':x==='Offline'?'<span class="charge-symbol offline">×</span>'
    :/Fehler|Fault|Error|Defekt/i.test(x)?'<span class="charge-symbol offline">!</span>'
    :/Warnung|Problem|Suspicious/i.test(x)?'<span class="charge-symbol warning">!</span>'
     :x==='Pausiert'?'<span class="charge-symbol warning">'+controlIcon('pause')+'</span>':'<span class="charge-symbol ready">●</span>';
  // Each LED reflects received OCPP state, not demo data or assumptions.
  const exactConnector = point => db.ocppConnectors.find(x=>x.point_id
    ?x.point_id===point.id
    :x.station_id===point.stationId && Number(x.connector_id)===Number(point.connectorNumber||1) &&
      (!point.ocppId||!x.identity||x.identity===point.ocppId));
  const liveForPoint = point => {
    const master=db.ocpp.find(x=>x.point_id===point.id)||
      db.ocpp.find(x=>!x.point_id&&point.ocppId&&x.station_id===point.stationId&&x.identity===point.ocppId);
    const connector=exactConnector(point);
    return connector?{...master,...connector,
      connected:master?.connected===true,
      action:master?.action,firmware:master?.firmware,
      vendor:master?.vendor,model:master?.model}:master;
  };
  const deviceStatus = point => {
    if(point.disabled)return 'Stillgelegt';
    const live=liveForPoint(point);
    if(!live)return 'Nicht verbunden';
    if(!live.connected)return 'Offline';
    // Shared OCPP identities need per-connector status; never attribute connector 1's
    // status to every slave in the chain.
    const station=getStation(point);
    if(station?.topology==='shared'&&db.chargers.filter(p=>p.stationId===point.stationId).length>1&&!exactConnector(point))
      return 'Verbunden';
    switch(live.status){
      case 'Charging':return 'Lädt';
      case 'Available':return 'Bereit';
      case 'Faulted':return 'Fehler';
      case 'Unavailable':return 'Offline';
      case 'SuspendedEVSE':case 'SuspendedEV':return activeCharge(point)?.remote_paused?'Pausiert':'Verbunden';
      case 'Preparing':case 'Finishing':return 'Verbunden';
      default:return 'Verbunden';
    }
  };
  const displayPoint = p => ({...p,status:deviceStatus(p)});
  const getStation = c => db.stations.find(st=>st.id===c.stationId);
  const stationKey = c => c.stationId || 'legacy-'+c.id;
  const myChargers = () => db.chargers.filter(c=>c.tenant===state.tenant && !c.archived && (state.role!=='user'||user()?.chargerIds.includes(c.id)));
  const pointStatus = c => c.disabled ? 'Stillgelegt' : c.status;
  const mySessions = () => db.sessions.filter(s=>s.tenant===state.tenant && (state.role!=='user'||s.personId===user()?.id));
  const total = a => a.reduce((sum,x)=>sum+x.kwh,0);
  const badge = status => `<span class="status-badge ${status==='Lädt'?'charging':status==='Offline'?'offline':''}">${esc(status)}</span>`;
  const roleTitle = () => state.role==='super'?'Walectra · Superadmin':state.role==='admin'?'Kunde · Admin':'Kunde · Nutzer';
  const mapInfo = c => {
    const station=getStation(c);
    if(station)return {cp:station.topology==='shared' ? (station.ocppId||'OCPP-ID offen') : (c.ocppId||'OCPP-ID offen'),
      connector:station.topology==='shared' ? (c.connectorNumber||1) : 1};
    return {cp:c.serial||'OCPP-ID offen',connector:1};
  };
  const myTenantChargerIndex = c => db.chargers.filter(x=>x.tenant===state.tenant).findIndex(x=>x.id===c.id);
  const link = (id,text,ico,active) => `<button type="button" class="nav-item ${active?'active':''}" data-page="${id}"${active?' aria-current="page"':''}><span class="ico">${ico}</span>${text}</button>`;
  function head(title,sub,actions='') {return `<div class="headline"><div><div class="eyebrow">${state.role==='super'?'WALECTRA MANAGEMENT':esc(tenant().name.toUpperCase())}</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="head-actions">${actions}</div></div>`;}
  function renderNav() {
    const superRole=state.role==='super';
    const allowed = state.role==='user'
      ? [['overview','Übersicht','▦'],['sites','Meine Ladepunkte',boltIcon('nav-bolt')],['sessions','Meine Ladevorgänge','▤']]
      : [['overview','Übersicht','▦'],['sites','Standorte & Ladepunkte',boltIcon('nav-bolt')],['sessions','Ladevorgänge','▤'],
        ...(superRole?[['people','RFID','♙'],['customers','Kundenverwaltung','▣']]:[['user-management','Nutzerverwaltung','♙']]),
        ['settings','Einstellungen','⚙']];
    let activePage=superRole&&state.page==='user-management'?'customers':state.page;
    if(!allowed.some(x=>x[0]===activePage))activePage=state.page='overview';
    $('nav').innerHTML=allowed.map(([id,name,icon])=>link(id,name,icon,id===activePage)).join('');
  }
  async function api(path,method='GET',data,format='json'){
  const options={method,credentials:'same-origin',headers:{}};
  if(preview){
    if(method!=='GET')throw Error('Änderungen sind in der Rollenvorschau deaktiviert.');
    options.headers['X-CV-Preview-User']=preview.userId;
    options.headers['X-CV-Preview-Tenant']=preview.tenantId;
  }
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  const response=await fetch(path,options);
  if(response.ok&&format==='blob')return response.blob();
  let result={};try{result=await response.json();}catch{}
  if(!response.ok)throw Error(result.error||'Serverfehler ('+response.status+')');
  return result;
}

  function scope(){return state.role==='super'?{tenantId:state.tenant}:{};}
  const canInvite=()=>state.role==='super'||(state.role==='admin'&&account?.canInviteUsers===true);
  const canDownloadPdf=()=>state.role==='super'||(state.role==='admin'&&account?.canDownloadPdf===true);

  async function loadLive(){
  if(!account){
    try{account=(await api('/api/auth/me')).user;}
    catch{window.location.replace('/login');return false;}
    state.role=account.role==='superadmin'?'super':account.role;
    state.person=account.id;
    state.tenant=account.tenantId||'';
  }
  let tenants=state.role==='super'?(await api('/api/tenants')).tenants:
    [{id:account.tenantId,name:account.tenantName||'Kunde',status:account.tenantStatus,price_per_kwh:account.pricePerKwh,contact_name:account.contactName,contact_email:account.contactEmail,contact_phone:account.contactPhone}];
  db.tenants=tenants.map(t=>({...t,site:''}));
  if(!tenants.some(t=>t.id===state.tenant))state.tenant=tenants[0]?.id||'';
  db.sites=[];db.stations=[];db.people=[];db.chargers=[];db.sessions=[];db.tags=[];db.ocpp=[];db.ocppConnectors=[];
  if(!state.tenant)return true;
  if(state.role==='user'){
    const [p,telemetry]=await Promise.all([api('/api/points'),api('/api/ocpp/live')]);
    db.ocpp=(telemetry.live||[]).filter(x=>testTools()||!x.simulated);
    db.ocppConnectors=(telemetry.connectors||[]).filter(x=>testTools()||!x.simulated);
    db.transactions=telemetry.transactions||[];
    const visiblePoints=p.points.filter(x=>testTools()||!x.is_simulator);
    db.chargers=visiblePoints.map(x=>({
      id:x.id,tenant:state.tenant,stationId:x.station_id||null,siteId:x.site_id||null,
      connectorNumber:x.connector_number||1,location:x.name,serial:'',ocppId:'',
      status:'Nicht verbunden',disabled:!x.enabled,power:null
    }));
    const s=new Map(),st=new Map();
    visiblePoints.forEach(x=>{
      if(x.site_id&&!s.has(x.site_id))s.set(x.site_id,{id:x.site_id,tenant:state.tenant,name:x.site_name,address:x.site_address||''});
      if(x.station_id&&!st.has(x.station_id))st.set(x.station_id,{
        id:x.station_id,tenant:state.tenant,siteId:x.site_id,name:x.station_name,topology:x.station_topology,serial:'',isSimulator:x.is_simulator===true
      });
    });
    db.sites=[...s.values()];db.stations=[...st.values()];
    db.people=[{id:account.id,tenant:state.tenant,name:account.name,email:account.email,role:'user',
      chargerIds:db.chargers.map(x=>x.id),state:'aktiv'}];
  }else{
    const qs='?tenantId='+encodeURIComponent(state.tenant);
    const [data,users,invites,telemetry]=await Promise.all([
      api('/api/structure/overview'+qs),api('/api/users'+qs),api('/api/invitations'+qs),api('/api/ocpp/live'+qs)
    ]);
    db.ocpp=(telemetry.live||[]).filter(x=>testTools()||!x.simulated);
    db.ocppConnectors=(telemetry.connectors||[]).filter(x=>testTools()||!x.simulated);
    db.transactions=telemetry.transactions||[];
    db.sites=data.sites.map(x=>({...x,tenant:state.tenant}));
    db.stations=data.stations.filter(x=>testTools()||!x.is_simulator).map(x=>({...x,tenant:state.tenant,siteId:x.site_id,
      isSimulator:x.is_simulator===true,ocppId:x.ocpp_identity||'',type:x.topology==='shared'?'multi':'single'}));
    const pointMap=new Map(db.stations.map(x=>[x.id,x]));
    db.chargers=data.points.filter(x=>!x.station_id||pointMap.has(x.station_id)).map(x=>({
      id:x.id,tenant:state.tenant,siteId:pointMap.get(x.station_id)?.site_id||'',
      stationId:x.station_id,location:x.name,serial:x.serial||'',power:x.power_kw||null,
      connectorNumber:x.connector_number,ocppId:x.ocpp_identity,
      status:'Nicht verbunden',disabled:!x.enabled,freechargeEnabled:x.freecharge_enabled===true
    }));
    db.people=users.users.map(x=>({
      id:x.id,tenant:state.tenant,name:x.name,email:x.email,role:x.role,state:x.enabled?'aktiv':'gesperrt',
      portalEnabled:x.portal_enabled!==false,canInviteUsers:x.can_invite_users===true,canDownloadPdf:x.can_download_pdf===true,
      canControlCharging:x.can_control_charging===true,canResetStation:x.can_reset_station===true,
      chargerIds:data.access.filter(a=>a.user_id===x.id).map(a=>a.chargepoint_id)
    }));
    for(const x of invites.invitations.filter(x=>!x.accepted_at)){
      const inviteState=new Date(x.expires_at)<=new Date()?'abgelaufen':'eingeladen';
      const profile=db.people.find(p=>p.email===x.email);
      if(profile){
        if(profile.portalEnabled===false&&!profile.portalInvitation)profile.portalInvitation=inviteState;
        continue;
      }
      db.people.push({id:'pending-'+x.email,tenant:state.tenant,name:x.name,email:x.email,
        role:x.role,state:inviteState,
        chargerIds:[],pointNames:x.point_names||[]});
    }
  }
  if(!availableSites().some(site=>site.id===state.sessionFilters.site))state.sessionFilters.site='';
  if(!availablePeople().some(person=>person.id===state.sessionFilters.user))state.sessionFilters.user='';
  state.siteOpen=state.siteOpen||db.sites[0]?.id||'';
  return true;
}

  function render(){
  renderNav();
  const titles={overview:'Übersicht',customers:'Kundenverwaltung',sites:'Standorte & Ladepunkte',sessions:'Ladevorgänge',people:'RFID','user-management':state.role==='super'?'Kundenverwaltung / Nutzerverwaltung':'Nutzerverwaltung',settings:'Einstellungen'};
  $('crumb').textContent=titles[state.page]||'Übersicht';
  $('avatar').textContent=state.role==='super'?'WA':state.role==='admin'?'AD':'NU';
  $('realRole').textContent=({super:'Walectra · Superadmin',admin:'Kunden-Admin',user:'Nutzer'})[state.role]+' · '+(account?.name||'');
  $('realRole').hidden=state.role==='super'||!!preview;
  $('rolePreviewBtn').hidden=state.role!=='super';
  $('logoutReal').hidden=!!preview;
  $('rolePreviewBanner').hidden=!preview;
  $('rolePreviewLabel').textContent=preview?'Vorschau: '+$('realRole').textContent:'';
  const current=db.tenants.find(t=>t.id===state.tenant);
  const customer=$('customerContext');
  customer.innerHTML=state.role==='super'
    ?'<label class="cv-context-label" for="globalTenantSelect">AKTUELLER KUNDE</label>'+
      '<select id="globalTenantSelect" class="cv-global-tenant" aria-label="Kunde in allen Menüs wechseln" '+(!db.tenants.length?'disabled':'')+'>'+
      db.tenants.map(t=>'<option value="'+esc(t.id)+'" '+(t.id===state.tenant?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select>'
    :'<span class="cv-context-label">KUNDE</span><strong class="cv-context-fixed">'+esc(current?.name||account?.tenantName||'Kein Kunde')+'</strong>';
  $('content').innerHTML=({overview:dashboard,customers,sites:sitesPage,sessions,people,'user-management':userManagement,settings})[state.page]();
  if(state.page==='sessions'&&state.tenant){void loadChargingHistory();void loadMonthOptions();}
  if(state.page==='overview'&&state.tenant){void loadOverview();syncOverviewNavigation();}
  $('tenantTariff')?.addEventListener?.('submit',saveTariff);
  $('chargingFilters')?.addEventListener?.('submit',event=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const from=data.get('from')||'',to=data.get('to')||'';
    if(from&&to&&from>to){toast('Das Ende muss am oder nach dem Beginn liegen.');return;}
    Object.assign(state.sessionFilters,{from,to});
    void loadChargingHistory();
  });
}

  function renderTimeChart(input,{power,period}){
    const values=input.map(row=>({
      time:Date.parse(power?row.bucket:row.bucket.replace(' ','T')+'Z'),
      value:power?row.kw:row.kwh,partial:power&&row.reported<row.points
    })).filter(row=>Number.isFinite(row.time)&&row.value!=null&&Number.isFinite(Number(row.value)));
    if(!values.length)return '<p class="inline-help cv-chart-empty">'+
      (power?'Für heute sind noch keine Leistungswerte verfügbar.':'Keine gemessene Ladeenergie im gewählten Zeitraum.')+'</p>';
    const unit=power?'kW':'kWh',width=720,height=124,hour=3600000;
    const fmt=(n)=>Number(n).toLocaleString(locale(),{maximumFractionDigits:1});
    const max=Math.max(...values.map(row=>Number(row.value)),1);
    const headroom=Math.ceil(max/2)*2;
    const first=values[0].time,last=values.at(-1).time;
    const left=power?Math.floor(first/hour)*hour:first;
    const bucket=power?120000:({day:hour,week:86400000,month:86400000,year:2678400000,all:31622400000})[period];
    const right=power?Math.max(left+hour,Math.ceil((last+1)/hour)*hour):last+bucket;
    const x=time=>width*(time-left)/(right-left);
    const y=value=>height-height*Number(value)/headroom;
    const segments=[];
    for(const row of values){
      const current=segments.at(-1);
      if(!current||row.time-current.at(-1).time>bucket*1.03)segments.push([row]);else current.push(row);
    }
    const paths=segments.map(segment=>{
      let line='M'+x(segment[0].time)+' '+y(segment[0].value);
      for(const row of segment.slice(1))line+=' H'+x(row.time)+' V'+y(row.value);
      const end=x(Math.min(right,segment.at(-1).time+bucket));
      line+=' H'+end;
      return '<path class="cv-chart-area" d="'+line+' V'+height+' H'+x(segment[0].time)+' Z"/>'+
        '<path class="cv-chart-line" d="'+line+'"/>';
    }).join('');
    const dateLabel=time=>new Intl.DateTimeFormat(locale(),{
      timeZone:power?'Europe/Berlin':'UTC',
      ...(power||period==='day'?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:
        period==='all'?{year:'numeric'}:period==='year'?{month:'short'}:{day:'2-digit',month:'2-digit'})
    }).format(time);
    const ticks=Math.min(6,Math.max(1,Math.round((right-left)/(power?hour:bucket))));
    const tickLabels=Array.from({length:ticks+1},(_,i)=>'<span>'+esc(dateLabel(left+(right-left)*i/ticks))+'</span>').join('');
    return '<div class="cv-plot"><div class="cv-plot-y" aria-hidden="true">'+[headroom,headroom/2,0].map(value=>'<span>'+fmt(value)+' '+unit+'</span>').join('')+
      '</div><div class="cv-plot-graph"><svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="'+
      (power?'Ladeleistung je Zeitpunkt':'Ladeenergie je Zeitraum')+'">'+
      '<defs><linearGradient id="cvChartFill" x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#75e8bb" stop-opacity=".60"/><stop offset="1" stop-color="#c6f7e7" stop-opacity=".65"/></linearGradient></defs>'+
      [0,height/2,height].map(level=>'<path class="cv-chart-grid" d="M0 '+level+' H'+width+'"/>').join('')+paths+
      '</svg><div class="cv-plot-x" aria-hidden="true">'+tickLabels+'</div></div></div>'+
      (power&&values.some(row=>row.partial)?'<p class="cv-plot-note">Teilsummen bei fehlenden Meldungen.</p>':'');
  }

  async function loadOverview(){
    const chart=$('analyticsChart'),recent=$('analyticsSessions');
    if(!chart)return;
    const power=overviewPeriod==='day'&&overviewMetric==='power';
    const period=overviewPeriod;
    const query=new URLSearchParams({...scope(),period,metric:power?'power':'energy'});
    if(validOverviewSite())query.set('siteId',overviewSite);
    try{
      const report=await api('/api/ocpp/analytics?'+query);
      if(!chart.isConnected)return;
      const buckets=report.buckets||[];
      chart.innerHTML=renderTimeChart(power?report.power||[]:buckets,{power,period});
      if(!power){
        const values=buckets.filter(row=>row.kwh!=null);
        const total=values.length?num(values.reduce((n,row)=>n+Number(row.kwh),0))+' kWh':'–';
        $('analyticsTotal').textContent=total;
      }
      const rows=(report.sessions||[]).map(sessionRow);
      recent.innerHTML=rows.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Beginn</th><th>Ladepunkt</th><th>Nutzer</th><th>Energie</th><th>Status</th></tr></thead><tbody>'+
        rows.map(row=>'<tr>'+[row.start,row.point,row.user||'–',row.kwh===null?'–':num(row.kwh)+' kWh',row.status].map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+
        '</tbody></table></div>':'<p class="inline-help">Noch keine Ladevorgänge.</p>';
    }catch(err){if(chart.isConnected)chart.textContent=err.message;}
  }

  function syncOverviewNavigation(){
    const section=$('overviewStations'),nav=$('nav');
    if(state.page!=='overview'||!section?.getBoundingClientRect||!nav?.querySelectorAll)return;
    const inStations=section.getBoundingClientRect().top<120;
    for(const item of nav.querySelectorAll('[data-page="sites"],[data-page="overview"]')){
      const active=item.dataset.page===(inStations?'sites':'overview');
      item.classList.toggle('active',active);
      if(active)item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    }
    $('crumb').textContent=inStations?'Standorte & Ladepunkte':'Übersicht';
  }

  function extendStation(id){
    if(state.role!=='super'||preview)return;
    const station=db.stations.find(s=>s.id===id);
    if(!station)return;
    const close=modal('Ladepunkte erweitern','<form id="extendStationForm" class="cv-form">'+
      '<label>Ladepunktnamen (jeweils eine Zeile)<textarea name="names" rows="4" maxlength="5200" required></textarea></label>'+
      '<p class="inline-help">'+(station.topology==='shared'?'Die neuen Connectoren folgen auf die vorhandenen Nummern.':'Jeder neue Ladepunkt erhält eigene OCPP-Zugangsdaten.')+'</p>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Erweitern</button></div></form>');
    $('extendStationForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,button=form.querySelector('button:not([type])');
      button.disabled=true;
      try{
        const names=form.elements.names.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        const result=await api('/api/structure/stations/'+id+'/points','POST',{...scope(),names});
        close();
        if(result.credentials.length)showOcppCredentials(result.credentials,{stationName:station.name,stationId:id,wssConfigured:result.wssConfigured,oneTime:true});
        await refreshData(result.points.length+' Ladepunkt(e) hinzugefügt.');
      }catch(err){toast(err.message);}finally{button.disabled=false;}
    });
  }

  function changeChargePermissions(id){
    if(state.role!=='super'||preview)return;
    const person=availablePeople().find(x=>x.id===id);
    if(!person)return;
    const close=modal('Ladesteuerung freigeben','<form id="chargePermissionsForm" class="cv-form"><p>'+esc(person.name)+'</p>'+
      '<label class="cv-form-checkbox"><input type="checkbox" name="control" '+(person.canControlCharging?'checked':'')+'> Starten, pausieren und stoppen</label>'+
      (person.role==='admin'?'<label class="cv-form-checkbox"><input type="checkbox" name="reset" '+(person.canResetStation?'checked':'')+'> Ladestation neu starten</label>':'')+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Speichern</button></div></form>');
    $('chargePermissionsForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,button=form.querySelector('button:not([type])');
      button.disabled=true;
      try{
        await api('/api/users/'+id+'/charging-permissions','PUT',{...scope(),
          canControlCharging:form.elements.control.checked,canResetStation:form.elements.reset?.checked===true});
        close();await refreshData('Freigaben gespeichert.');
      }catch(err){toast(err.message);}finally{button.disabled=false;}
    });
  }

  async function runChargingCommand(button){
    if(preview||button.disabled)return;
    const command=button.dataset.ocppControl,label=button.getAttribute('aria-label');
    if(!(command==='reset'?canReset():canControl())){showPremium(label);return;}
    const send=async()=>{
      button.disabled=true;
      try{
        await api('/api/ocpp/control','POST',{...scope(),pointId:button.dataset.pointId,command});
        await pollLive();
        toast('Wallbox hat den Befehl angenommen.');
      }catch(err){toast(err.message);}finally{button.disabled=false;}
    };
    if(!['stop','reset'].includes(command)){await send();return;}
    const close=modal(label,'<p>'+(command==='stop'?'Möchtest du den Ladevorgang wirklich stoppen?':'Möchtest du die Ladestation wirklich neu starten?')+'</p>'+
      '<div class="modal-actions"><button class="btn ghost" data-close-modal>Abbrechen</button><button class="btn danger" id="confirmChargeCommand">'+esc(label)+'</button></div>');
    $('confirmChargeCommand').addEventListener('click',async()=>{close();await send();},{once:true});
  }

  function customerSelect(){
  return state.role==='super'?'<button class="btn small" id="newTenantBtn">+ Kunde</button>':'';
}

  const validOverviewSite=()=>availableSites().some(site=>site.id===overviewSite);
  const overviewPeriods={day:'Heute',week:'Diese Woche',month:'Dieser Monat',year:'Dieses Jahr',all:'Gesamter Zeitraum'};
  const countLabel=(count,singular,plural)=>count+' '+(count===1?singular:plural);

  function dashboard(){
    const points=myChargers(),sites=availableSites(),enabled=points.filter(point=>!point.disabled);
    const faults=enabled.filter(pointFault);
    const statuses=enabled.map(deviceStatus);
    const online=enabled.filter(point=>liveForPoint(point)?.connected).length;
    const unknown=enabled.filter(point=>!exactConnector(point)?.status||deviceStatus(point)==='Nicht verbunden').length;
    const healthy=enabled.length>0&&!unknown&&!faults.length;
    const ready=statuses.filter(status=>status==='Bereit').length,charging=statuses.filter(status=>status==='Lädt').length;
    const issue=faults[0],issueSite=issue&&sites.find(site=>site.id===issue.siteId);
    const failureTime=issue&&deviceStatus(issue)!=='Offline'?exactConnector(issue)?.status_changed_at:null;
    const timeLabel=failureTime?new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}).format(new Date(failureTime)):'';
    const systemLine=healthy?'Alle '+countLabel(enabled.length,'Ladepunkt','Ladepunkte')+' online':
      issue?countLabel(faults.length,'Ladepunkt gestört','Ladepunkte gestört'):
        enabled.length?countLabel(online,'Ladepunkt online','Ladepunkte online'):'Keine aktiven Ladepunkte';
    const stats=[
      [boltIcon('metric-bolt'),points.length,points.length===1?'Ladepunkt':'Ladepunkte','points'],
      ['●',ready,'bereit','ready'],['◌',charging,'laden','charging'],
      ['!',faults.length,faults.length===1?'Störung':'Störungen','fault'],
      ['▦',sites.length,sites.length===1?'Standort':'Standorte','sites']
    ];
    const powerChart=overviewPeriod==='day'&&overviewMetric==='power';
    const selectedSite=validOverviewSite()?sites.find(site=>site.id===overviewSite):null;
    const chartPoints=selectedSite?points.filter(point=>point.siteId===selectedSite.id):points;
    const current=powerSummary(chartPoints);
    const place=selectedSite?.name||(sites.length===1?sites[0].name:'Alle Standorte');
    const heading=powerChart?'Ladeleistung heute':'Ladeenergie im Zeitverlauf';
    const pending='<p class="cv-chart-empty inline-help">Messwerte werden geladen …</p>';
    return '<div class="cv-overview">'+head(state.role==='user'?'Hallo, '+esc(account?.name||'Nutzer')+'!':'Ladeinfrastruktur im Überblick',
      state.role==='user'?'Deine zugewiesenen Ladepunkte.':'',customerSelect())+
      '<section class="cv-overview-status '+(healthy?'ok':issue?'has-fault':'unknown')+'" aria-label="Systemstatus">'+
      '<div class="cv-overview-state"><small>Systemstatus</small><div class="cv-overview-state-line"><span aria-hidden="true" class="cv-state-symbol">'+
      (healthy?'✓':issue?'⚠︎':'○')+'</span><div><strong>'+(healthy?'Alles OK':issue?'Störung':'Status unvollständig')+'</strong><p>'+esc(systemLine)+'</p></div></div></div>'+
      (issue?'<div class="cv-overview-fault"><strong>'+esc([issueSite?.name,issue.location].filter(Boolean).join(' · '))+'</strong><p>'+esc(faultReason(issue))+
        '</p><div class="cv-overview-fault-footer">'+(timeLabel?'<span>Seit '+esc(timeLabel)+' Uhr</span>':'')+
        '<button class="cv-status-link" type="button" data-fault-point="'+esc(issue.id)+'">Details ansehen ›</button></div></div>':'')+'</section>'+
      '<div class="cv-overview-stats" aria-label="Status der Ladeinfrastruktur">'+stats.map(([icon,count,label,type])=>
        '<div><span class="cv-stat-symbol cv-stat-'+type+'" aria-hidden="true">'+icon+'</span><span><b>'+count+'</b> '+label+'</span></div>').join('')+'</div>'+
      '<section class="panel cv-power-panel"><div class="cv-power-head"><div><h2>'+heading+'</h2><p>'+esc(place)+' · Summe aller Ladepunkte</p></div>'+
      '<div class="cv-power-filters"><label>Standort <select id="analyticsSite"><option value="">Alle Standorte</option>'+
      sites.map(site=>'<option value="'+esc(site.id)+'" '+(site.id===overviewSite?'selected':'')+'>'+esc(site.name)+'</option>').join('')+'</select></label>'+
      '<label>Zeitraum <select id="analyticsPeriod">'+Object.entries(overviewPeriods).map(([key,label])=>
        '<option value="'+key+'" '+(overviewPeriod===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      (overviewPeriod==='day'?'<label>Messgröße <select id="analyticsMetric"><option value="power">Leistung (kW)</option>'+
        '<option value="energy" '+(overviewMetric==='energy'?'selected':'')+'>Energie (kWh)</option></select></label>':'')+'</div></div>'+
      '<div class="cv-power-body"><div id="analyticsChart" aria-live="polite">'+pending+'</div><div class="cv-power-total">'+
      '<span>'+(powerChart?(current.partial?'Aktuell gemessen':'Aktuell'):'Im Zeitraum')+'</span><strong id="analyticsTotal">'+
      (powerChart&&current.kw!==null?esc(kw(current.kw)):'–')+'</strong>'+
      (powerChart&&current.kw===null?'<small>Keine aktuelle Messung</small>':'')+'</div></div></section>'+
      '<div class="cv-overview-sites">'+sites.map(site=>{
        const group=points.filter(point=>point.siteId===site.id);
        const issues=group.filter(pointFault).length;
        const connected=group.filter(point=>!point.disabled&&liveForPoint(point)?.connected).length;
        return '<button type="button" class="health-site-row" data-site-health="'+esc(site.id)+'"><span class="health-site-identity"><strong>'+
          esc(site.name)+'</strong><small>'+countLabel(group.length,'Ladepunkt','Ladepunkte')+(site.address?' · '+esc(site.address):'')+
          '</small></span><span class="health-pill '+(issues?'orange':connected?'green':'grey')+'">'+
          (issues?countLabel(issues,'Störung','Störungen'):connected?connected+' online':'Keine Statusdaten')+
          '</span><span class="health-link">Details ansehen ›</span></button>';
      }).join('')+(sites.length?'':'<div class="health-empty">Noch keine Standorte eingerichtet.</div>')+'</div>'+
      '<section class="panel panel-top-gap"><div class="panel-head"><h2>Letzte Ladevorgänge</h2>'+
      '<button class="btn ghost small" id="showPhysicalSessions">Ladevorgänge ansehen ›</button></div><div id="analyticsSessions"></div></section>'+
      (state.role==='user'?'':'<section id="overviewStations" class="panel-top-gap">'+sitesPage(true)+'</section>')+'</div>';
  }

  const contactAccessStates={
    available:{label:'Kein Zugang eingerichtet',invite:'Kontakt als Admin einladen'},
    invited:{label:'Einladung offen',invite:'Einladung erneut senden'},
    expired:{label:'Einladung abgelaufen',invite:'Neue Einladung senden'},
    registered:{label:'Registriert',reset:true},
    disabled:{label:'Zugang gesperrt'},
    reserved:{label:'E-Mail einem anderen Zugang zugeordnet'}
  };

  function contactAccess(customer){
    if(customer.status==='suspended')return {label:'Kundenkonto gesperrt'};
    if(!customer.contact_email)return {label:'Keine E-Mail hinterlegt'};
    return contactAccessStates[customer.contact_access]||{label:'Status nicht verfügbar'};
  }

  function customers(){
    if(state.role!=='super')return dashboard();
    const cards=db.tenants.map(t=>{
      const selected=t.id===state.tenant;
      const initials=String(t.name||'K').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
      const status=({active:'Aktiv',pending:'In Vorbereitung',suspended:'Gesperrt'})[t.status]||t.status;
      const access=contactAccess(t);
      const contactAction=access.invite
        ?'<button class="btn ghost small" type="button" data-invite-contact="'+esc(t.id)+'">'+access.invite+'</button>'
        :access.reset?'<button class="btn ghost small" type="button" data-reset-contact-password="'+esc(t.id)+'">Passwort-Link senden</button>':'';
      return '<article class="cv-customer-card '+(selected?'selected':'')+'">'+
        '<div class="cv-customer-card-top"><span class="cv-customer-avatar">'+esc(initials)+'</span>'+
        '<div class="cv-customer-main"><strong>'+esc(t.name)+'</strong><small>'+esc(status)+'</small></div></div>'+
        '<div class="cv-contact-grid"><div><span>Kontaktperson</span><strong>'+esc(t.contact_name||'Noch nicht hinterlegt')+'</strong></div>'+
        '<div><span>E-Mail</span><strong>'+esc(t.contact_email||'–')+'</strong></div>'+
        '<div><span>Telefon</span><strong>'+esc(t.contact_phone||'–')+'</strong></div>'+
        '<div><span>Admin-Zugang</span><strong>'+access.label+'</strong></div></div>'+
        '<div class="cv-customer-actions">'+
        '<button class="btn ghost small" type="button" data-open-customer="'+esc(t.id)+'">Öffnen</button>'+
        '<button class="btn ghost small" type="button" data-customer-users="'+esc(t.id)+'">Nutzer verwalten</button>'+
        '<button class="btn ghost small" type="button" data-edit-customer="'+esc(t.id)+'">Bearbeiten</button>'+
        contactAction+
        '<button class="btn danger small" type="button" data-delete-customer="'+esc(t.id)+'">Kunde archivieren</button></div></article>';
    }).join('');
    return head('Kundenverwaltung','Kunden, Kontaktpersonen und Zugänge zentral verwalten. Geräte richtet ausschließlich Walectra ein.',
      '<button id="newTenantBtn" class="btn">+ Kunde anlegen</button>')+
      '<section class="cv-customers-hero"><div><span>KUNDEN · CHARGEVISOR BUSINESS</span>'+
      '<h2>'+db.tenants.length+' Kundenkonten</h2><p>Die technische Einrichtung bleibt bei Walectra. Kontaktpersonen können als Kunden-Admins eingeladen werden.</p></div>'+
      '<span class="cv-hero-bolt">'+boltIcon()+'</span></section>'+
      '<div class="cv-customer-list">'+(cards||'<div class="panel empty">Noch keine Kunden angelegt.</div>')+'</div>';
  }

  function sitesPage(inOverview=false){
  const points=myChargers();
  const places=availableSites().filter(s=>state.role!=='user'||points.some(p=>p.siteId===s.id));
  const search=state.query.trim().toLowerCase();
  const filtered=places.filter(s=>[s.name,s.address,...points.filter(p=>p.siteId===s.id).map(p=>p.location)].join(' ').toLowerCase().includes(search));
  const tools=state.role==='super'?'<button id="newSiteBtn" class="btn ghost">+ Standort</button><button id="newChargerBtn" class="btn">+ Ladestation</button>':'';
  let html=inOverview?'<div class="panel-head"><h2>Standorte &amp; Ladepunkte</h2>'+tools+'</div>':head(state.role==='user'?'Meine Ladepunkte':'Standorte & Ladepunkte',
    state.role==='super'?'Walectra richtet die Hardware ein und verwaltet technische IDs.':
    state.role==='admin'?'Von Walectra eingerichtete Ladepunkte. Du kannst Nutzer zuweisen.':'Nur die Ladepunkte, für die du freigeschaltet bist.',tools);
  html+='<div class="toolbar"><input class="search" id="searchInput" placeholder="Standort oder Ladepunkt suchen …" value="'+esc(state.query)+'"><span class="micro">'+
    countLabel(points.length,'Ladepunkt','Ladepunkte')+' · '+countLabel(places.length,'Standort','Standorte')+'</span></div>';
  for(const site of filtered){
    const these=points.filter(p=>p.siteId===site.id);
    const groups=new Map();
    for(const p of these){const key=p.stationId||p.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
    const open=(inOverview?!collapsedSites.has(site.id):state.siteOpen===site.id)||!!search;
    const onlineCount=these.filter(p=>['Bereit','Lädt'].includes(deviceStatus(p))).length;
    const sitePower=powerSummary(these);
    const currentPower=sitePower.kw===null?'Leistung nicht gemeldet':(sitePower.partial?'Gemessen ':'Aktuell ')+kw(sitePower.kw);
    const errorCount=these.filter(p=>deviceStatus(p)==='Fehler').length;
    html+='<section class="site-section"><button class="site-head" data-open-site="'+esc(site.id)+'" aria-expanded="'+open+'"><span class="site-visual">▦</span><span class="site-name"><strong>'+esc(site.name)+'</strong><small>'+esc(site.address)+'</small></span><span class="site-numbers">'+
      countLabel(these.length,'Ladepunkt','Ladepunkte')+'<small>'+countLabel(groups.size,'Ladestation','Ladestationen')+' · '+esc(currentPower)+' · '+onlineCount+' bereit/lädt'+(errorCount?' · '+errorCount+' Fehler':'')+'</small></span><span class="site-arrow">'+(open?'⌃':'⌄')+'</span></button>';
    if(open){
      html+='<div class="site-details">'+(state.role==='super'?'<div class="cv-site-actions"><button class="btn ghost small" data-edit-site="'+esc(site.id)+'">Standort & Adresse bearbeiten</button></div>':'');
      for(const list of groups.values()){
        const station=db.stations.find(s=>s.id===list[0].stationId);
        const shared=station?.topology==='shared';
        if(shared)list.sort((a,b)=>a.connectorNumber-b.connectorNumber);
        const stationPower=powerSummary(list);
        html+='<div class="station-group"><div class="station-group-title cv-station-heading">'+
          '<div class="station-group-copy"><strong>'+esc(station?.name||'Ladestation')+'</strong><small>'+
          (station?.name?'Ladestation · ':'')+countLabel(list.length,'Ladepunkt','Ladepunkte')+'</small></div>'+
          '<span class="cv-station-power">'+(stationPower.partial?'Gemessen: ':'Total aktuell: ')+
          (stationPower.kw===null?'–':esc(kw(stationPower.kw)))+'</span>'+
          (station?.isSimulator?'<span class="cv-virtual-pill">Virtuelle Wallbox</span>':'')+
          (state.role==='super'&&station?'<button type="button" class="btn ghost small" data-credentials="'+esc(station.id)+'">OCPP-Zugangsdaten</button>':'')+
          (state.role==='super'&&station?.isSimulator?
            db.ocpp.some(x=>x.station_id===station.id&&x.connected&&x.simulated)?
              '<span class="cv-virtual-pill">Simulator verbunden</span>':
              '<button type="button" class="btn small" data-run-ocpp-test="'+esc(station.id)+'">Einmaligen OCPP-Test starten</button>'
            :'')+'</div><div class="points-header"><span>Ladepunkt</span><span>Status</span><span>OCPP-Anbindung</span><span>Nutzer</span><span></span></div>';
        for(const p of list){
          const assigned=peopleForCharger(p.id).filter(x=>x.role==='user');
          const expanded=state.expanded===p.id;
          const live=liveForPoint(p),status=deviceStatus(p),display=displayPoint(p);
          const liveLabel=live?.simulated?' · TESTSIMULATOR':'';
          const connector=Number(p.connectorNumber||1),power=measuredPower(p);
          const connectorLabel='#'+connector+(shared?(connector===1?' · Master':' · Slave'):'');
          html+='<div class="point-group '+(p.disabled?'point-disabled':'')+'"><div class="point-row">'+
            '<div class="point-name">'+luminaPreview(display,true)+'<span><strong>'+esc(p.location)+'</strong></span></div>'+
            '<div class="point-current"><span class="cv-point-controls">'+pointControls(p,status)+'</span><span class="cv-point-status">'+
            statusIcon(status)+'<strong>'+esc(status)+esc(liveLabel)+'</strong></span>'+
            (power!==null&&(power>0||status==='Lädt')?'<span class="cv-point-power">'+esc(kw(power))+'</span>':'')+'</div>'+
            '<div class="point-connect"><strong>'+(state.role==='super'?esc(p.ocppId||'Nicht hinterlegt'):'Technik durch Walectra')+'</strong>'+
            '<small>Connector '+esc(connectorLabel)+'</small></div>'+
            '<div class="point-people">'+esc(assigned.map(x=>x.name).join(', ')||'Nicht zugewiesen')+'</div>'+
            '<button class="detail-button" data-expand="'+esc(p.id)+'" aria-expanded="'+expanded+'">'+(expanded?'Weniger':'Details')+
            ' <span>'+(expanded?'⌃':'⌄')+'</span></button></div>';
          if(expanded){
            const firm=live?.firmware||'Noch nicht gemeldet',vendor=live?.vendor||'Noch nicht gemeldet',
              model=live?.model||'Noch nicht gemeldet';
            html+='<div class="point-detail-panel">'+
              '<div class="point-detail-grid">'+
                '<div><small>Ladepunkt</small><strong>'+esc(p.location)+'</strong></div>'+
                '<div><small>Ladestation</small><strong>'+esc(station?.name||'Nicht hinterlegt')+'</strong></div>'+
                '<div><small>Seriennummer</small><strong>'+esc(station?.serial||'Nicht hinterlegt')+'</strong></div>'+
                '<div><small>Hersteller</small><strong>'+esc(vendor)+'</strong></div>'+
                '<div><small>Modell</small><strong>'+esc(model)+'</strong></div>'+
                '<div><small>Firmwarestand</small><strong>'+esc(firm)+'</strong></div>'+
                (state.role==='super'?'<div><small>OCPP-Geräte-ID</small><strong>'+esc(p.ocppId||'Nicht hinterlegt')+'</strong></div>':'')+
                '<div><small>Connector</small><strong>'+esc(connectorLabel)+'</strong></div>'+
                '<div><small>Letzte OCPP-Nachricht</small><strong>'+esc(live?.action||'Keine Daten')+'</strong></div>'+
                '<div><small>Empfangene Energie</small><strong>'+esc(live?.energy_wh??'–')+' Wh</strong></div>'+
                '<div><small>Aktuelle Leistung</small><strong>'+(power===null?'–':esc(kw(power)))+'</strong></div>'+
                (pointFault(p)?'<div><small>Störung</small><strong>'+esc(faultReason(p))+'</strong></div>':'')+
              '</div>'+
              '<p class="inline-help">'+(live?.simulated?'TESTSIMULATOR – keine reale Energie und keine Abrechnung. ':
              'Werte stammen ausschließlich aus eingegangenen OCPP-Nachrichten. ')+
              (shared&&list.length>1?'Gemeinsame OCPP-Verbindung: Status nur bei vorhandener Connector-Meldung.':'')+'</p>';
            if(state.role!=='user')html+='<div class="point-actions"><button class="btn ghost small" data-access="'+esc(p.id)+'">Nutzer zuweisen</button></div>';
            if(state.role==='super')html+='<div class="point-actions"><button class="btn ghost small" data-edit-point="'+esc(p.id)+'">Umbenennen</button><button class="btn ghost small" data-toggle-point="'+esc(p.id)+'">'+(p.disabled?'Aktivieren':'Deaktivieren')+'</button>'+
              (station&&!station.isSimulator&&p.ocppId?'<button class="btn ghost small" data-charge-mode="'+esc(p.id)+'">Lademodus: '+(p.freechargeEnabled?'Freecharge':'RFID')+'</button>':'')+'</div>';
            if(station&&!station.isSimulator)html+='<div class="point-actions">'+
              (state.role==='super'?'<button class="btn ghost small" data-extend-station="'+esc(station.id)+'">Ladepunkte erweitern</button>':'')+
              (state.role!=='user'?controlButton(p,'reset','Ladestation neu starten','Ladestation neu starten',canReset()):'')+'</div>';
            html+='</div>';
          }
          html+='</div>';
        }
        html+='</div>';
      }
      html+='</div>';
    }
    html+='</section>';
  }
  if(!filtered.length)html+='<section class="panel empty">Noch keine Standorte oder Ladepunkte vorhanden.</section>';
  if(state.role==='user'&&!points.length)html+='<p class="inline-help">Dein Kunden-Admin muss dir zuerst einen Ladepunkt zuweisen.</p>';
  return html;
}

  function userManagement(){
  const members=availablePeople();
  const shown=members.filter(p=>(p.name+' '+p.email).toLowerCase().includes(state.query.toLowerCase()));
  const inviteLocked=!canInvite();
  let h=head('Nutzerverwaltung','Nutzerprofile verwalten und Ladepunkte zuweisen.',
    (state.role==='super'?'<button type="button" class="btn ghost" data-page="customers">Zurück zur Kundenverwaltung</button>':'')+
    '<button class="btn ghost" id="createUserBtn" '+(preview||!state.tenant?'disabled':'')+'>+ Nutzer hinzufügen</button>'+
    '<button class="btn" id="inviteBtn" '+(!state.tenant||preview?'disabled':inviteLocked?lockedAttrs:'')+'>+ Nutzer einladen</button>'+
    (inviteLocked?'<span class="cv-feature-note">Portal-Einladungen bei Walectra freigeben lassen.</span>':''));
  h+='<section class="panel"><div class="panel-head"><h2>'+esc(tenant().name)+'</h2></div>'+
    '<div class="toolbar"><input class="search" id="searchInput" placeholder="Name oder E-Mail suchen …" value="'+esc(state.query)+'"><span class="micro">'+shown.length+' Konten / Einladungen</span></div>'+
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Ladepunkte</th><th>Status</th><th>Aktion</th></tr></thead><tbody>';
  h+=shown.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+esc(p.email)+'</td><td>'+esc(p.role==='admin'?'Kunden-Admin':'Nutzer')+'</td>'+
    '<td>'+(p.chargerIds.length?p.chargerIds.map(id=>'<span class="chip">'+esc(db.chargers.find(x=>x.id===id)?.location||'Ladepunkt')+'</span>').join(' '):p.pointNames?.length?p.pointNames.map(n=>'<span class="chip">'+esc(n)+'</span>').join(' '):'–')+'</td>'+
    '<td><span class="chip '+(p.state==='aktiv'?'success':'pending')+'">'+esc(p.state)+'</span>'+
    (p.portalEnabled===false?' <span class="chip">RFID-Profil</span>':'')+
    (p.portalInvitation?' <span class="chip pending">Portal: '+esc(p.portalInvitation)+'</span>':'')+'</td>'+
    '<td>'+(p.state==='aktiv'&&p.role==='user'?'<button class="btn ghost small" data-user-access="'+esc(p.id)+'">Zuweisen</button>':
      state.role==='super'&&p.role==='admin'&&p.state==='aktiv'?'<button class="btn ghost small" data-admin-permissions="'+esc(p.id)+'">Freigaben</button>':'–')+
    (state.role==='super'&&p.state==='aktiv'&&p.portalEnabled!==false?'<button class="btn ghost small" data-charge-permissions="'+esc(p.id)+'">Ladesteuerung</button>':'')+'</td></tr>').join('');
  h+=shown.length?'':'<tr><td colspan="6" class="empty">Noch keine Nutzer.</td></tr>';
  return h+'</tbody></table></div></section>'+
    (state.role==='admin'?physicalRfidPanel():'');
  }

  function physicalRfidPanel(){
    return '<section class="panel panel-top-gap"><div class="panel-head"><h2>RFID-Karten</h2>'+
      '<button type="button" id="managePhysicalRfid" class="btn ghost small" '+(preview||!state.tenant?'disabled':'')+
      '>RFID-Karten verwalten</button></div></section>';
  }

  function people(){
  const stations=db.stations.filter(s=>s.isSimulator&&s.tenant===state.tenant);
  return head('RFID','Karten und Ladeberechtigungen verwalten.',
    '<button type="button" class="btn ghost" data-page="user-management">Nutzerverwaltung öffnen</button>')+
    physicalRfidPanel()+
    (!testTools()?'':'<section class="panel panel-top-gap"><h2>Virtuelle Test-Wallboxen</h2>'+
    (stations.length?stations.map(s=>'<div class="panel-head"><strong>'+esc(s.name)+'</strong>'+
      '<button type="button" class="btn ghost small" data-test-rfid="'+esc(s.id)+'">Testkarte anlernen</button></div>').join(''):
      '<p>Lege unter „Standorte & Ladepunkte“ zuerst eine virtuelle Test-Wallbox an.</p>')+'</section>');
}

  const currentMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date());
  const monthDate=month=>new Date(month+'-01T12:00:00Z');
  function offsetMonth(month,distance){
    const date=monthDate(month);
    date.setUTCMonth(date.getUTCMonth()+distance);
    return date.toISOString().slice(0,7);
  }
  function monthRange(month){
    const end=monthDate(offsetMonth(month,1));
    end.setUTCDate(0);
    return {from:month+'-01',to:end.toISOString().slice(0,10)};
  }
  const monthCacheKey=()=>[state.tenant,state.role,account?.id].join(':');
  function monthOptions(){
    const current=currentMonth(),selected=state.sessionFilters.month||current;
    const earliest=firstSessionMonth.get(monthCacheKey());
    const recent=offsetMonth(current,-11);
    const min=earliest&&earliest<recent?earliest:recent;
    const newest=selected>current?selected:current;
    const archiveLimit=offsetMonth(newest,-239);
    const cutoff=archiveLimit>min?archiveLimit:min;
    const months=new Set();
    for(let month=newest;month>=cutoff;month=offsetMonth(month,-1))months.add(month);
    // Old selections remain available as the previous/next buttons move through the archive.
    months.add(selected);
    const format=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'});
    return [...months].sort().reverse().map(month=>
      '<option value="'+month+'"'+(month===selected?' selected':'')+'>'+esc(format.format(monthDate(month)))+'</option>').join('');
  }
  async function loadMonthOptions(){
    const select=$('sessionMonth'),id=monthCacheKey();
    if(!select||firstSessionMonth.has(id))return;
    try{
      const {firstMonth}=await api('/api/ocpp/sessions?'+new URLSearchParams({...scope(),months:'1'}));
      firstSessionMonth.set(id,/^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth||'')?firstMonth:null);
      if(select.isConnected&&id===monthCacheKey())select.innerHTML=monthOptions();
    }catch{/* Month navigation and custom dates remain available. */}
  }
  function sessions(){
    const f=state.sessionFilters,month=f.month||currentMonth();
    return head(state.role==='user'?'Meine Ladevorgänge':'Ladevorgänge & Berichte','Energie aus gemeldeten Zählerständen.')+
      '<section class="panel cv-sessions-panel"><h2>Letzte Ladevorgänge</h2>'+
      '<form id="chargingFilters" class="cv-session-filters"><div class="cv-session-period"><div class="cv-session-period-head">'+
      (f.custom?'<button type="button" id="toggleCustomDates" class="cv-session-link">Monat wählen</button>':
        '<label for="sessionMonth">Monat</label><div class="cv-month-picker"><button type="button" class="btn ghost small" data-month-step="-1" aria-label="Vorheriger Monat">‹</button>'+
        '<select id="sessionMonth" name="month">'+monthOptions()+'</select>'+
        '<button type="button" class="btn ghost small" data-month-step="1" aria-label="Nächster Monat" '+(month>=currentMonth()?'disabled':'')+'>›</button></div>'+
        '<button type="button" id="toggleCustomDates" class="cv-session-link">Zeitraum frei wählen</button>')+'</div>'+
      (f.custom?'<div class="cv-session-dates"><label>Von <input name="from" type="date" value="'+esc(f.from)+'"></label>'+
        '<label>Bis <input name="to" type="date" value="'+esc(f.to)+'"></label>'+
        '<button class="btn ghost small" type="submit">Filtern</button></div>':'')+'</div>'+
      '<label class="cv-session-choice">Standort <select name="site"><option value="">Alle Standorte</option>'+
      availableSites().map(site=>'<option value="'+esc(site.id)+'" '+(site.id===f.site?'selected':'')+'>'+esc(site.name)+'</option>').join('')+'</select></label>'+
      (state.role==='user'?'':'<label class="cv-session-choice">Nutzer <select name="user"><option value="">Alle Nutzer</option>'+
        availablePeople().filter(person=>person.role==='user'&&!person.id.startsWith('pending-')).map(person=>
          '<option value="'+esc(person.id)+'" '+(person.id===f.user?'selected':'')+'>'+esc(person.name)+'</option>').join('')+'</select></label>')+'</form>'+
      '<div class="cv-session-exports"><strong>Exportieren</strong>'+
      '<button class="btn ghost small" type="button" data-session-export="CSV" aria-label="CSV herunterladen"><span aria-hidden="true">▤</span> CSV</button>'+
      '<button class="btn ghost small" type="button" data-session-export="XLSX" aria-label="Excel herunterladen"><span aria-hidden="true">▦</span> Excel</button>'+
      (state.role==='user'?'':'<button id="downloadChargingReport" type="button" class="btn small" aria-label="PDF-Ladebericht herunterladen"'+
        (!canDownloadPdf()?lockedAttrs:'')+(preview?' disabled':'')+'><span aria-hidden="true">✦</span> PDF-Ladebericht</button>')+'</div>'+
      '<div id="chargingHistory" aria-live="polite"></div>'+
      '<p class="inline-help cv-session-footer">Die Übersicht zeigt bis zu 100 Treffer. CSV und Excel enthalten alle Treffer. Zeitraum in Berliner Ortszeit.</p></section>'+
      (state.role==='super'&&testTools()?'<section class="panel panel-top-gap">'+
        '<h2>Simulierte Ladevorgänge</h2><p>Testvorgänge dienen der OCPP-Prüfung und werden nicht abgerechnet.</p>'+
        '<button id="showTestSessions" type="button" class="btn ghost small" '+(!state.tenant?'disabled':'')+'>Testvorgänge anzeigen</button></section>':'');
  }

  function settings(){
  const t=tenant();
  let h=head('Einstellungen',state.role==='super'?'Kunden, Ansprechpartner und technische Konfiguration.':'Kundeninformationen und Freigaben.');
  h+='<section class="panel"><div class="panel-head"><h2>Kundenkonto</h2>'+(state.role==='super'&&t.id?'<button class="btn ghost small" id="editCurrentCustomerBtn">Kundendaten bearbeiten</button>':'')+'</div>'+
    '<div class="customer-data-grid"><div><small>Kunde</small><strong>'+esc(t.name)+'</strong></div><div><small>Status</small><strong>'+esc(t.status||'–')+'</strong></div>'+
    '<div><small>Kontaktperson</small><strong>'+esc(t.contact_name||'Noch nicht hinterlegt')+'</strong></div>'+
    '<div><small>Kontakt E-Mail</small><strong>'+esc(t.contact_email||'Noch nicht hinterlegt')+'</strong></div><div><small>Telefon</small><strong>'+esc(t.contact_phone||'Noch nicht hinterlegt')+'</strong></div></div></section>'+
    '<section class="panel panel-top-gap"><h2>OCPP-Anbindung</h2><p>ChargeVisor verbindet Wallboxen über OCPP 1.6 JSON.</p></section>';
  if(t.id)h+='<section class="panel panel-top-gap"><h2>Ladetarif</h2>'+
    '<form id="tenantTariff" class="toolbar"><label>Preis in €/kWh <input name="price" type="number" min="0" max="999" step="0.0001" required value="'+esc(t.price_per_kwh??'')+'"></label>'+
    '<button class="btn small" type="submit" '+(preview?'disabled':'')+'>Tarif speichern</button></form>'+
    '<p class="inline-help">Der Tarif gilt für neue Ladevorgänge ab ihrem Start.</p></section>';
  if(state.role==='super')h+='<section class="panel panel-top-gap"><h2>Microsoft 365</h2><p>Geschäftspostfach und Einladungsversand verwalten.</p><a class="btn ghost small" href="/login?manage=1">Outlook-Verbindung verwalten</a></section>';
  return h;
}

  function modal(title,contents){
  $('modalHost').innerHTML='<div class="modal-backdrop" id="modalBackdrop"><section class="modal station-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">'+esc(title)+'</h2>'+contents+'</section></div>';
  const close=()=>{$('modalHost').replaceChildren();};
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
  $('modalHost').querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',close));
  return close;
}

  function showRolePreview(){
    if(state.role!=='super'||changingView)return;
    const tenantId=state.tenant;
    const accounts=availablePeople().filter(p=>p.state==='aktiv'&&p.portalEnabled!==false&&['admin','user'].includes(p.role));
    const close=modal('Rollenansicht',
      '<p>Aktueller Kunde: <strong>'+esc(tenant().name)+'</strong>. Die Vorschau zeigt die Sicht eines aktiven Kontos mit seinen tatsächlichen Freigaben.</p>'+
      '<form id="rolePreviewForm"><div class="field"><label for="previewRole">Rolle</label>'+
      '<select id="previewRole"><option value="admin">Kunden-Admin</option><option value="user">Nutzer</option></select></div>'+
      '<div class="field"><label for="previewUser">Konto</label><select id="previewUser" required></select></div>'+
      '<p id="rolePreviewHelp" role="status"></p>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button>'+
      '<button type="submit" class="btn" id="startRolePreview">Vorschau öffnen</button></div></form>');
    const role=$('previewRole'),target=$('previewUser'),start=$('startRolePreview');
    function update(){
      const matches=accounts.filter(p=>p.role===role.value);
      target.innerHTML=matches.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.email)+'</option>').join('');
      target.disabled=!matches.length;
      start.disabled=!matches.length;
      $('rolePreviewHelp').textContent=matches.length?'Änderungen sind in der Vorschau deaktiviert.':
        'Für diese Rolle gibt es bei diesem Kunden noch kein aktives Konto.';
    }
    if(!accounts.some(p=>p.role==='admin')&&accounts.some(p=>p.role==='user'))role.value='user';
    role.addEventListener('change',update);
    update();
    role.focus();
    $('rolePreviewForm').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!target.value||tenantId!==state.tenant||changingView)return;
      start.disabled=true;
      const opened=await changeRoleView({tenantId,userId:target.value,role:role.value,returnPage:state.page});
      if(opened){close();$('content').focus();}
      else start.disabled=false;
    });
  }

  async function changeRoleView(next){
    if(changingView)return false;
    const before={account,preview,state:{...state},db:{...db}};
    changingView=true;
    preview=next;
    try{
      const {user}=await api('/api/auth/me');
      if(next?(user.id!==next.userId||user.tenantId!==next.tenantId||user.role!==next.role):user.role!=='superadmin')
        throw Error('Die gewählte Rollenansicht konnte nicht geladen werden.');
      account=user;
      Object.assign(state,{
        role:next?user.role:'super',person:user.id,tenant:next?user.tenantId:before.preview.tenantId,
        page:next?'overview':before.preview.returnPage,siteOpen:'',expanded:'',query:''
      });
      await loadLive();
      return true;
    }catch(err){
      account=before.account;
      preview=before.preview;
      Object.assign(state,before.state);
      Object.assign(db,before.db);
      toast(err.message);
      return false;
    }finally{
      changingView=false;
      render();
    }
  }

  // Show secrets only after an authenticated create/rotate response.
  // Normal metadata requests never include the raw password.
  function showOcppCredentials(credentials,{stationName='',wssConfigured=false,oneTime=false,stationId='',isSimulator=false}={}){
    if(state.role!=='super')return;
    const urlAvailable=wssConfigured===true;
    const makeField=(label,value,key,index,opts={})=>{
      const id='cv-ocpp-'+key+'-'+index;
      const supplied=typeof value==='string'&&value.length>0;
      const secret=opts.secret===true;
      const input='<input id="'+id+'" type="'+(secret?'password':'text')+
        '" readonly autocomplete="off" spellcheck="false" value="'+esc(supplied?value:'Noch nicht eingerichtet')+
        '" aria-label="'+esc(label)+'">';
      return '<div class="ocpp-detail-field">'+
        '<span class="ocpp-detail-label">'+esc(label)+'</span>'+
        '<div class="ocpp-detail-value">'+input+
          (supplied?'<button type="button" class="btn ghost small" data-ocpp-copy-target="'+id+'">Kopieren</button>':'')+
          (secret?'<button type="button" class="btn ghost small" data-ocpp-reveal-target="'+id+'">Anzeigen</button>':'')+
        '</div></div>';
    };
    const rows=credentials.map((item,i)=>{
      const identity=String(item.identity||'');
      const url=item.wssUrl||'';
      let hostname='',port='',path='',baseUrl='';
      if(url){
        try{
          const parsed=new URL(url);
          hostname=parsed.hostname;port=parsed.port||'443';path=parsed.pathname;
          const lastSlash=path.lastIndexOf('/');
          if(parsed.protocol==='wss:'&&identity&&decodeURIComponent(path.slice(lastSlash+1))===identity){
            parsed.pathname=path.slice(0,lastSlash+1);
            baseUrl=parsed.href;
          }
        }catch{}
      }
      const fullAddress=makeField('WSS-Serveradresse (vollständig)',url,'url',i);
      const pwd=typeof item.password==='string'?item.password:null;
      return '<section class="ocpp-connection-card">'+
        '<div class="ocpp-connection-heading"><h3>Verbindung '+(i+1)+'</h3>'+
          '<span class="ocpp-connection-tag">OCPP 1.6 JSON</span></div>'+
        (isSimulator?fullAddress:makeField('OCPP URL für Lumina (ohne ID)',baseUrl,'base-url',i))+
        makeField(isSimulator?'OCPP-ID (Charge Point Identity)':'Charge Point ID',identity,'identity',i)+
        '<p class="ocpp-small">HTTP Basic Auth ist erforderlich. Falls ein separates Feld für den Benutzernamen angezeigt wird, dort ebenfalls die Charge Point ID eintragen.</p>'+
        (pwd?makeField('OCPP-Passwort – nur einmal sichtbar',pwd,'secret',i,{secret:true}):
          '<p class="ocpp-small"><strong>Passwort sicher hinterlegt.</strong> Nicht auslesbar. Bei Verlust bitte neu erzeugen.</p>')+
        (url||!isSimulator?'<details class="ocpp-advanced"><summary>'+
          (isSimulator?'Hostname, Port und Pfad einzeln anzeigen':'Vollständige WSS-Adresse und weitere Felder anzeigen')+
          '</summary><div class="ocpp-advanced-grid">'+
          (isSimulator?'':fullAddress)+
          (url?makeField('Hostname',hostname,'host',i)+makeField('Port',port,'port',i)+makeField('Pfad',path,'path',i):'')+
          '</div></details>':'')+
        (!pwd&&stationId?'<button type="button" class="btn ghost small" data-ocpp-rotate="'+esc(stationId)+'" data-ocpp-identity="'+esc(identity)+'">Passwort neu erzeugen</button>':'')+
        '</section>';
    }).join('');
    const statusLabel=urlAvailable?'WSS-Adresse hinterlegt · Verbindung ungeprüft':'OCPP-Server noch nicht eingerichtet';
    const intro='<div class="ocpp-guide"><div class="ocpp-guide-steps">'+
      '<h3>Wallbox verbinden</h3>'+
      '<div class="ocpp-step"><span class="ocpp-step-num">1</span><div><strong>Konfiguration öffnen</strong>'+
        '<p>'+(isSimulator?'Starte den Simulator auf deinem Rechner und <a href="http://127.0.0.1:8765" target="_blank" rel="noopener noreferrer">öffne das lokale Bedienfeld</a>.':
          'Hersteller-App oder Weboberfläche der Wallbox öffnen.')+'</p></div></div>'+
      '<div class="ocpp-step"><span class="ocpp-step-num">2</span><div><strong>OCPP 1.6 JSON aktivieren</strong>'+
        '<p>Eine sichere WebSocket-Verbindung (WSS) mit HTTP Basic Auth verwenden.</p></div></div>'+
      '<div class="ocpp-step"><span class="ocpp-step-num">3</span><div><strong>Verbindungsdaten eintragen</strong>'+
        (isSimulator?'<p>Die vollständige WSS-Serveradresse in „OCPP-Adresse“ einfügen und OCPP-ID und Passwort übernehmen.</p>':
          '<p>Bei Enelion Lumina die „OCPP URL“ mit abschließendem Schrägstrich übernehmen und die „Charge Point ID“ separat eintragen. Die Wallbox ergänzt die ID selbst. Das OCPP-Passwort in das Passwortfeld eintragen.</p>'+
          '<p>Für Clients ohne separates ID-Feld die vollständige WSS-Adresse aus den weiteren Feldern kopieren. Bei einer gemeinsamen Master/Slave-Verbindung nur den Master einrichten.</p>')+
      '</div></div>'+
      '<div class="ocpp-step"><span class="ocpp-step-num">4</span><div><strong>Verbindung herstellen</strong>'+
        '<p>Verbindung '+(isSimulator?'im Simulator':'in der Wallbox')+' starten und den Status unter „Standorte &amp; Ladepunkte“ prüfen.</p></div></div>'+
      '</div><div class="ocpp-guide-data"><div class="ocpp-guide-status"><span class="ocpp-connection-dot"></span>'+esc(statusLabel)+'</div>'+
      (oneTime?'<p class="ocpp-important">Passwörter jetzt kopieren und sicher ablegen. Sie werden nur einmal angezeigt und danach nur als Hash gespeichert.</p>':'')+
      (rows||'<p>Diese Ladestation hat noch keine OCPP-Zugangsdaten.</p>')+
      (!rows&&stationId?'<button type="button" class="btn" data-ocpp-provision="'+esc(stationId)+'">OCPP-Zugangsdaten erstellen</button>':'')+
      '</div></div>';
    const content='<p class="ocpp-guide-subtitle">'+esc(stationName)+' · '+credentials.length+
      ' OCPP-Verbindung(en)</p>'+
      (!urlAvailable?'<div class="ocpp-warning">Noch keine nutzbare WSS-Adresse: Der separate ChargeVisor-OCPP-Dienst muss zuerst eingerichtet und mit der Authentifizierung verbunden werden. Diese Angaben sind aktuell nur vorbereitet.</div>':'')+
      intro+'<div class="modal-actions"><button type="button" class="btn" data-close-modal>Schließen</button></div>';
    modal('Wallbox verbinden · Schritt 2/2',content);
    $('modalHost').querySelector('.station-modal')?.classList.add('ocpp-wizard');
    for(const b of $('modalHost').querySelectorAll('[data-ocpp-reveal-target]')){
      b.addEventListener('click',()=>{
        const input=$(b.dataset.ocppRevealTarget);
        const shown=input.type==='text';input.type=shown?'password':'text';
        b.textContent=shown?'Anzeigen':'Verbergen';
      });
    }
    for(const b of $('modalHost').querySelectorAll('[data-ocpp-copy-target]')){
      b.addEventListener('click',async()=>{
        const input=$(b.dataset.ocppCopyTarget);
        try{await navigator.clipboard.writeText(input.value);toast('In Zwischenablage kopiert.');}
        catch{input.type='text';input.focus();input.select();toast('Bitte Wert manuell kopieren.');}
      });
    }
    for(const b of $('modalHost').querySelectorAll('[data-ocpp-provision]')){
      b.addEventListener('click',async()=>{
        b.disabled=true;
        try{
          const result=await api('/api/structure/stations/'+encodeURIComponent(b.dataset.ocppProvision)+'/credentials/provision','POST',scope());
          if(!result.credentials?.length){toast('Diese Anlage hat bereits OCPP-Zugangsdaten.');return;}
          showOcppCredentials(result.credentials,{stationName,wssConfigured:result.wssConfigured,oneTime:true,stationId:b.dataset.ocppProvision,isSimulator});
        }catch(err){b.disabled=false;toast(err.message);}
      });
    }
    for(const b of $('modalHost').querySelectorAll('[data-ocpp-rotate]')){
      b.addEventListener('click',async()=>{
        if(!window.confirm('Neues OCPP-Passwort erzeugen? Das bisherige wird dadurch ungültig.'))return;
        try{
          const result=await api('/api/structure/stations/'+encodeURIComponent(b.dataset.ocppRotate)+'/credentials/'+encodeURIComponent(b.dataset.ocppIdentity)+'/rotate','POST',scope());
          showOcppCredentials([result],{stationName,wssConfigured:result.wssConfigured,oneTime:true,stationId:b.dataset.ocppRotate,isSimulator});
        }catch(err){toast(err.message);}
      });
    }
  }
  async function showSavedCredentials(stationId){
    if(state.role!=='super')return;
    const station=db.stations.find(x=>x.id===stationId&&x.tenant===state.tenant);
    if(!station)return;
    try{
      const query='?tenantId='+encodeURIComponent(state.tenant);
      const data=await api('/api/structure/stations/'+encodeURIComponent(stationId)+'/credentials'+query);
      showOcppCredentials(data.credentials||[],{stationName:station.name,wssConfigured:data.wssConfigured,stationId,isSimulator:station.isSimulator});
    }catch(err){toast(err.message);}
  }

  function showTestRfid(stationId){
    if(state.role!=='super')return;
    const tenantId=state.tenant;
    const station=db.stations.find(s=>s.id===stationId&&s.tenant===tenantId&&s.isSimulator);
    if(!station)return;
    const points=myChargers().filter(p=>p.stationId===stationId);
    const identities=[...new Set(points.map(p=>p.ocppId).filter(Boolean))];
    if(!identities.length){toast('Erstelle zuerst OCPP-Zugangsdaten für diese Test-Wallbox.');return;}
    modal('Testkarte anlernen',
      '<div id="testRfidForm"><p>'+esc(station.name)+' · Virtuelle Test-Wallbox</p>'+
      '<div class="field"><label for="testRfidIdentity">OCPP-Verbindung</label><select id="testRfidIdentity">'+
      identities.map(id=>'<option>'+esc(id)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="testRfidUser">Zugewiesener Nutzer</label><select id="testRfidUser"></select></div>'+
      '<p id="testRfidStatus" class="inline-help" role="status"></p>'+
      '<div class="rfid-capture-actions"><button id="testRfidOpen" type="button" class="btn">Einlesen starten</button>'+
      '<button id="testRfidConfirm" type="button" class="btn" hidden>Testkarte zuordnen</button>'+
      '<button id="testRfidCancel" type="button" class="btn ghost" hidden>Einlesen abbrechen</button></div>'+
      '<h3>Angelernte Testkarten</h3><ul id="testRfidCards"></ul>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Schließen</button></div></div>');
    const form=$('testRfidForm'),identitySelect=$('testRfidIdentity'),users=$('testRfidUser');
    const status=$('testRfidStatus'),cards=$('testRfidCards');
    const open=$('testRfidOpen'),confirm=$('testRfidConfirm'),cancel=$('testRfidCancel');
    let candidate=null,windowOpen=false,busy=false;
    const active=()=>form.isConnected&&state.tenant===tenantId;
    function controls(){
      identitySelect.disabled=busy||windowOpen;
      open.hidden=windowOpen;
      open.disabled=busy||!users.value;
      confirm.hidden=!windowOpen;
      confirm.disabled=busy||!candidate||!users.value;
      cancel.hidden=!windowOpen;
      cancel.disabled=busy;
    }
    function eligibleUsers(){
      const ids=new Set(points.filter(p=>!p.disabled&&p.ocppId===identitySelect.value).map(p=>p.id));
      users.innerHTML='<option value="">Nutzer auswählen</option>'+availablePeople()
        .filter(p=>p.role==='user'&&p.state==='aktiv'&&p.chargerIds.some(id=>ids.has(id)))
        .map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
      controls();
    }
    async function sync(action){
      if(busy||!active())return;
      const identity=identitySelect.value;
      const scope={tenantId,stationId,identity};
      busy=true;
      controls();
      try{
        const data=action
          ?await api('/api/ocpp/test-rfid','POST',{...scope,action,candidate,userId:users.value})
          :await api('/api/ocpp/test-rfid?'+new URLSearchParams(scope));
        if(!active()||identity!==identitySelect.value)return;
        windowOpen=!!data.window;
        candidate=data.window?.candidate||null;
        status.textContent=candidate?'Empfangen: '+candidate+'. Prüfe die Kennung und bestätige die Zuordnung.':
          windowOpen?'Halte im Simulator eine Testkarte mit einer Kennung wie SIM-001 vor. Das Fenster endet um '+
            new Date(data.window.expiresAt).toLocaleTimeString('de-DE')+'.':
          users.options.length===1?'Weise zuerst einem aktiven Nutzer einen Ladepunkt dieser Verbindung zu.':
            'Wähle einen Nutzer aus und starte anschließend das Einlesen.';
        cards.innerHTML=data.cards?.length?data.cards.map(card=>{
          const user=availablePeople().find(p=>p.id===card.userId);
          return '<li>'+esc(card.idTag)+' · '+esc(user?.name||'Nutzer nicht verfügbar')+'</li>';
        }).join(''):'<li>Noch keine Testkarte angelernt.</li>';
      }catch(err){
        if(active()){
          status.textContent=err.message;
          if(action)toast(err.message);
        }
      }finally{
        busy=false;
        if(active())controls();
      }
    }
    async function poll(){
      if(!active())return;
      if(windowOpen)await sync();
      if(active())setTimeout(poll,1500);
    }
    identitySelect.addEventListener('change',()=>{eligibleUsers();void sync();});
    users.addEventListener('change',controls);
    open.addEventListener('click',()=>sync('open'));
    confirm.addEventListener('click',()=>sync('confirm'));
    cancel.addEventListener('click',()=>sync('cancel'));
    eligibleUsers();
    void sync();
    void poll();
  }

  function showPhysicalRfid(){
    if(preview||!state.tenant||!['admin','super'].includes(state.role))return;
    const tenantId=state.tenant;
    const users=availablePeople().filter(p=>p.role==='user'&&p.state==='aktiv');
    const userOptions='<option value="">Nutzer auswählen</option>'+
      users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>').join('');
    const chargers=myChargers();
    const points=chargers.filter(point=>!point.disabled);
    const connections=new Map();
    for(const point of chargers){
      const station=getStation(point);
      if(station&&!station.isSimulator&&point.ocppId&&!connections.has(point.ocppId))
        connections.set(point.ocppId,station);
    }
    const clock=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const readTime=read=>{
      const time=new Date(read.last_seen);
      return read.last_seen&&Number.isFinite(time.getTime())?clock.format(time):'–';
    };
    const readPoint=read=>read.point_name||(read.connector_id==null?'–':'Connector #'+read.connector_id);
    modal('RFID-Karten verwalten',
      '<p id="physicalRfidStatus" role="status">RFID-Daten werden geladen …</p>'+
      '<section id="physicalRfidRecent" hidden><h3>Kürzlich gelesene Karten</h3>'+
      '<p>Halte eine Karte an die Wallbox. Sobald sie hier erscheint, kannst du sie einem Nutzer zuordnen.</p>'+
      '<div id="rfidRecentReads"></div>'+
      '<form id="rfidSeenForm" class="rfid-seen-form" hidden>'+
      '<h3>Karte zuordnen</h3><p id="rfidSeenSelection"></p>'+
      '<div class="field"><label for="rfidSeenDriver">Nutzer</label><select id="rfidSeenDriver" required>'+userOptions+'</select></div>'+
      '<div class="field"><label for="rfidSeenLabel">Kartenname</label><input id="rfidSeenLabel" maxlength="80" required></div>'+
      '<fieldset class="rfid-point-picker"><legend>Ladepunkte freigeben</legend>'+
      '<label><input type="checkbox" id="rfidSeenAllPoints"> Alle derzeit aktiven Ladepunkte</label>'+
      '<div id="rfidSeenPointOptions" class="rfid-point-options">'+points.map(point=>
        '<label><input type="checkbox" name="pointIds" value="'+esc(point.id)+'"> '+
        esc([db.sites.find(site=>site.id===point.siteId)?.name,point.location].filter(Boolean).join(' · '))+'</label>'
      ).join('')+'</div></fieldset>'+
      '<p class="inline-help">Bestehende Freigaben bleiben erhalten.</p>'+
      '<div class="rfid-capture-actions"><button class="btn" type="submit">Karte zuordnen</button>'+
      '<button class="btn ghost" type="button" id="rfidSeenCancel">Abbrechen</button></div></form></section>'+
      '<details id="physicalRfidAdvanced" class="cv-setup-advanced" hidden><summary>Manuell eingeben oder gezielt einlesen</summary>'+
      '<form id="physicalRfidForm">'+
      '<div class="field"><label for="rfidDriver">Nutzer</label><select id="rfidDriver" required>'+userOptions+'</select></div>'+
      '<div class="field"><label for="rfidLabel">Kartenname</label><input id="rfidLabel" maxlength="80" required></div>'+
      '<div class="field"><label for="rfidConnection">Wallbox zum Einlesen</label><select id="rfidConnection">'+
      '<option value="">Keine Wallbox ausgewählt</option>'+[...connections].map(([id,s])=>
        '<option value="'+esc(id)+'">'+esc(s.name)+' · '+esc(id)+'</option>').join('')+'</select></div>'+
      '<div class="rfid-capture-actions"><button class="btn ghost small" type="button" id="openPhysicalRfid">Karte an Wallbox einlesen</button>'+
      '<button class="btn ghost small" type="button" id="cancelPhysicalRfid" hidden>Einlesen abbrechen</button></div>'+
      '<div class="field"><label for="rfidTag">Kartenkennung (OCPP idTag)</label><input id="rfidTag" autocomplete="off" spellcheck="false" maxlength="20" required></div>'+
      '<button class="btn" type="submit">Karte zuordnen</button></form></details>'+
      '<div id="physicalRfidCards"></div>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Schließen</button></div>');
    const form=$('physicalRfidForm'),connection=$('rfidConnection'),tag=$('rfidTag');
    const status=$('physicalRfidStatus'),cards=$('physicalRfidCards');
    const open=$('openPhysicalRfid'),cancel=$('cancelPhysicalRfid');
    const save=form.querySelector('button[type=submit]');
    const recentSection=$('physicalRfidRecent'),reads=$('rfidRecentReads'),seenForm=$('rfidSeenForm');
    const seenSave=seenForm.querySelector('button[type=submit]'),seenDriver=$('rfidSeenDriver');
    const allPoints=$('rfidSeenAllPoints'),pointOptions=$('rfidSeenPointOptions');
    const pointInputs=[...pointOptions.querySelectorAll('input')];
    let recent=[],selectedReadId='',recentMarkup='';
    let scanning=false,busy=false,configured=false,requestId=0;
    const active=()=>form.isConnected&&state.tenant===tenantId;
    const currentRead=()=>recent.find(read=>read.id===selectedReadId);

    function controls(){
      connection.disabled=busy||scanning;
      open.disabled=busy||scanning||!connection.value;
      cancel.disabled=busy;
      cancel.hidden=!scanning;
      tag.readOnly=scanning;
      save.disabled=busy||!configured||!users.length||(scanning&&!tag.value);
      allPoints.disabled=busy||!points.length;
      for(const button of reads.querySelectorAll('[data-rfid-read]'))button.disabled=busy;
      pointOptions.hidden=allPoints.checked;
      seenSave.disabled=busy||!configured||!currentRead()||!users.length||
        !(allPoints.checked||pointInputs.some(input=>input.checked));
    }

    function renderRecent(){
      const markup=recent.length?'<div class="table-wrap"><table class="data-table">'+
        '<thead><tr><th>Uhrzeit (Berlin)</th><th>Wallbox</th><th>Ladepunkt</th><th>Aktion</th></tr></thead><tbody>'+
        recent.map(read=>'<tr><td>'+esc(readTime(read))+'</td><td>'+esc(read.station_name||'Wallbox')+'</td><td>'+esc(readPoint(read))+'</td>'+
          '<td><button class="btn ghost small" type="button" data-rfid-read="'+esc(read.id)+'" aria-pressed="'+
          (read.id===selectedReadId)+'">Auswählen</button></td></tr>').join('')+
        '</tbody></table></div>':'<p>Aktuell sind keine Kartenlesungen verfügbar.</p>';
      if(markup!==recentMarkup){reads.innerHTML=markup;recentMarkup=markup;}
      seenForm.hidden=!selectedReadId;
      if(selectedReadId){
        const read=currentRead();
        $('rfidSeenSelection').textContent=read?[readTime(read),read.station_name,readPoint(read)].filter(Boolean).join(' · '):
          'Diese Kartenlesung ist abgelaufen oder wurde bereits zugeordnet. Wähle eine aktuelle Lesung.';
      }
      controls();
    }

    async function sync(action,fields={}){
      if(busy||!active())return;
      const identity=connection.value,stationId=connections.get(identity)?.id||'';
      const scope={tenantId,identity,stationId};
      const id=++requestId;
      const current=()=>active()&&id===requestId&&identity===connection.value;
      if(action){busy=true;controls();}
      try{
        const data=action?await api('/api/ocpp/rfid','POST',{
          ...(action==='assign-seen'?{tenantId}:scope),action,...fields
        }):await api('/api/ocpp/rfid?'+new URLSearchParams(scope));
        if(!current())return;
        configured=data.configured;
        recentSection.hidden=!configured;
        $('physicalRfidAdvanced').hidden=!configured;
        recent=Array.isArray(data.recent)?data.recent:[];
        if(action==='assign-seen'){
          selectedReadId='';
          seenForm.reset();
          toast('RFID-Karte zugeordnet und Ladepunkte freigegeben.');
        }else{
          if(scanning||data.window||action==='confirm'||action==='manual')tag.value=data.window?.candidate||'';
          scanning=!!data.window;
        }
        status.textContent=!configured?'Die RFID-Freigabe ist serverseitig noch nicht eingerichtet.':
          scanning?(tag.value?'Karte erkannt. Prüfe die Kennung und bestätige die Zuordnung.':
            'Halte die Karte innerhalb von 90 Sekunden an die Wallbox.'):
          !users.length?'Lege zuerst einen aktiven Nutzer an.':
          !points.length?'Richte zuerst einen aktiven Ladepunkt ein.':'';
        cards.innerHTML=data.cards?.length?'<h3>Zugeordnete Karten</h3><ul>'+data.cards.map(card=>
          '<li class="status-row"><span>'+esc(card.label)+' · '+esc(users.find(u=>u.id===card.user_id)?.name||'Nutzer gesperrt')+'</span>'+
          '<button type="button" class="btn ghost small" data-rfid-card="'+esc(card.id)+'" data-rfid-enable="'+!card.enabled+'" '+
          (!configured?'disabled':'')+'>'+ (card.enabled?'Sperren':'Freigeben')+'</button></li>').join('')+'</ul>':'';
        renderRecent();
        if(action==='assign-seen'){
          try{await refreshData();}
          catch{if(active())toast('RFID-Karte zugeordnet. Die Freigaben konnten nicht neu geladen werden.');}
        }
      }catch(err){if(current()){status.textContent=err.message;if(action)toast(err.message);}}
      finally{if(action){busy=false;if(active())controls();}}
    }

    async function poll(){
      if(!active())return;
      await sync();
      if(active())setTimeout(poll,1500);
    }
    reads.addEventListener('click',event=>{
      const button=event.target.closest('[data-rfid-read]');
      const read=recent.find(item=>item.id===button?.dataset.rfidRead);
      if(busy||!read||read.id===selectedReadId)return;
      selectedReadId=read.id;
      seenForm.reset();
      for(const input of pointInputs)input.checked=input.value===read.point_id;
      renderRecent();
      seenDriver.focus();
    });
    $('rfidSeenCancel').addEventListener('click',()=>{
      if(busy)return;
      selectedReadId='';
      seenForm.reset();
      renderRecent();
    });
    seenForm.addEventListener('change',controls);
    seenForm.addEventListener('submit',event=>{
      event.preventDefault();
      if(seenSave.disabled)return;
      void sync('assign-seen',{
        readId:selectedReadId,userId:seenDriver.value,label:$('rfidSeenLabel').value.trim(),
        pointIds:allPoints.checked?[]:pointInputs.filter(input=>input.checked).map(input=>input.value),
        allPoints:allPoints.checked
      });
    });
    connection.addEventListener('change',()=>{controls();void sync();});
    open.addEventListener('click',()=>sync('open'));
    cancel.addEventListener('click',()=>sync('cancel'));
    cards.addEventListener('click',event=>{
      const button=event.target.closest('[data-rfid-card]');
      if(button)void sync('set-enabled',{cardId:button.dataset.rfidCard,enabled:button.dataset.rfidEnable==='true'});
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void sync(scanning?'confirm':'manual',{userId:$('rfidDriver').value,label:$('rfidLabel').value,tag:tag.value.trim()});
    });
    controls();
    void poll();
  }

  function chargingQuery(){
    const params=new URLSearchParams(scope());
    const filters=state.sessionFilters;
    const {from,to}=filters.custom?filters:monthRange(filters.month||currentMonth());
    if(filters.user)params.set('userId',filters.user);
    if(filters.site)params.set('siteId',filters.site);
    if(from)params.set('from',from);
    if(to)params.set('to',to);
    return params;
  }
  const sessionDate=value=>value?new Date(value).toLocaleString(locale(),{timeZone:'Europe/Berlin'}):'';
  function sessionRow(s){
    const kwh=s.energy_wh==null?null:Number(s.energy_wh)/1000;
    const rate=s.price_per_kwh==null?null:Number(s.price_per_kwh);
    return {sessionId:s.id,start:sessionDate(s.started_at),end:sessionDate(s.stopped_at),
      site:s.site_name,station:s.station_name,point:s.point_name||'Connector #'+s.connector_id,
      connector:s.connector_id,user:s.user_name||(s.authorization_kind==='freecharge'?'Freecharge':''),
      kwh,rate,amount:s.amount_eur==null?null:Number(s.amount_eur),status:s.stopped_at?'Beendet':'Aktiv'};
  }
  function exportSessionRow(s){
    const {card_id,card_name,authorization_kind,organization_name,stop_reason,signed_meter}=s;
    const start=new Date(s.started_at),end=s.stopped_at?new Date(s.stopped_at):null;
    return {...sessionRow(s),start:start.toISOString(),end:end?.toISOString(),
      siteId:s.site_id,stationId:s.station_id,type:authorization_kind==='rfid'?'RFID':
        authorization_kind==='freecharge'?'Freecharge':authorization_kind==='remote'?'Fernstart':null,authorization:card_id,cardName:card_name,
      organization:organization_name,user:s.user_name,stopReason:stop_reason,signedMeter:signed_meter,
      meterStart:s.meter_start_wh==null?null:Number(s.meter_start_wh),
      meterStop:s.meter_stop_wh==null?null:Number(s.meter_stop_wh),
      durationMinutes:end?(end-start)/60000:null};
  }
  async function loadChargingHistory(){
    const target=$('chargingHistory');
    if(!target)return;
    const query=chargingQuery().toString();
    target.textContent='Ladevorgänge werden geladen …';
    try{
      const {sessions:rows}=await api('/api/ocpp/sessions?'+query);
      if(!target.isConnected||query!==chargingQuery().toString())return;
      target.innerHTML='<div class="table-wrap"><table class="data-table"><thead><tr>'+
        ['Beginn','Ladepunkt','Nutzer','Energie','€/kWh','Betrag','Status'].map(label=>'<th>'+label+'</th>').join('')+
        '</tr></thead><tbody>'+rows.map(sessionRow).map(r=>'<tr>'+
          [r.start,r.point,r.user||'–',r.kwh==null?'–':num(r.kwh)+' kWh',r.rate==null?'–':rateText(r.rate),r.amount==null?'–':euro(r.amount),r.status]
            .map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+
        (rows.length?'':'<tr><td colspan="7">Keine Ladevorgänge für diesen Filter.</td></tr>')+'</tbody></table></div>';
    }catch(err){if(target.isConnected&&query===chargingQuery().toString())target.textContent=err.message;}
  }
  async function exportChargingHistory(format){
    if(!state.tenant)return;
    const query=chargingQuery();
    query.set('export','1');
    const company=tenant().name;
    try{
      const rows=[];
      let cursor=null;
      do{
        if(cursor)query.set('beforeId',String(cursor));
        const page=await api('/api/ocpp/sessions?'+query);
        rows.push(...page.sessions.map(exportSessionRow));
        cursor=page.nextCursor;
      }while(cursor);
      window.ChargeVisorExports['export'+format]({live:true,company,from:query.get('from'),to:query.get('to'),rows});
    }catch(err){toast(err.message);}
  }
  async function saveTariff(event){
    event.preventDefault();
    const form=event.currentTarget;
    const button=form.querySelector('button');
    const customer=tenant();
    button.disabled=true;
    try{
      const data=await api('/api/tenants/'+encodeURIComponent(customer.id)+'/tariff','PUT',{pricePerKwh:Number(form.elements.price.value)});
      customer.price_per_kwh=data.price_per_kwh;
      if(account?.tenantId===customer.id)account.pricePerKwh=data.price_per_kwh;
      toast('Ladetarif gespeichert.');
    }catch(err){toast(err.message);}
    finally{button.disabled=false;}
  }

  async function showOcppSessions(simulated){
    if(!state.tenant||(simulated&&state.role!=='super'))return;
    const tenantId=state.tenant;
    modal(simulated?'Simulierte Ladevorgänge':'Ladevorgänge',
      '<p>'+(simulated?'Die letzten 100 Testvorgänge. Sie werden nicht abgerechnet.':'Die letzten 100 Ladevorgänge. Energie wird aus den gemeldeten Zählerständen berechnet.')+'</p>'+
      '<div id="testSessionRows" aria-live="polite">Ladevorgänge werden geladen …</div>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Schließen</button></div>');
    const target=$('testSessionRows');
    try{
      const {sessions}=await api('/api/ocpp/'+(simulated?'test-sessions':'sessions')+'?tenantId='+encodeURIComponent(tenantId));
      if(!target.isConnected||state.tenant!==tenantId)return;
      if(!sessions.length){target.textContent=simulated?'Noch keine Testvorgänge gespeichert.':'Noch keine Ladevorgänge gespeichert.';return;}
      target.innerHTML='<div class="table-wrap"><table class="data-table"><thead><tr><th>Wallbox / Ladepunkt</th>'+
        '<th>Beginn</th><th>Status</th><th>Energie</th></tr></thead><tbody>'+
        sessions.map(s=>'<tr><td>'+esc(s.station_name)+'<br>'+esc(s.point_name||'Connector '+s.connector_id)+
          (s.user_name&&state.role!=='user'?'<br>'+esc(s.user_name):
            s.authorization_kind==='freecharge'?'<br>Freecharge':'')+'</td>'+
          '<td>'+esc(new Date(s.started_at).toLocaleString('de-DE'))+'</td><td>'+(s.stopped_at?'Beendet':'Aktiv')+'</td>'+
          '<td>'+sessionEnergy(s,simulated)+'</td></tr>').join('')+
        '</tbody></table></div>';
    }catch(err){if(target.isConnected)target.textContent=err.message;}
  }

  function sessionEnergy(row,simulated){
    const wh=simulated&&row.meter_stop_wh!=null?Number(row.meter_stop_wh)-Number(row.meter_start_wh):row.energy_wh;
    return wh==null?'–':esc(Number(wh).toLocaleString('de-DE')+' Wh');
  }

  function adminInvitationMessage(result){
    if(result.existingUser)return 'Für diese E-Mail-Adresse besteht bereits ein Kunden-Admin-Zugang.';
    if(result.delivery==='email')return 'Admin-Einladung zum Versand übergeben.';
    return 'Admin-Einladung erstellt. Bitte den Einladungslink manuell weitergeben.';
  }

  async function downloadReport(button){
    if(!state.tenant||preview||!canDownloadPdf())return;
    button.disabled=true;
    try{
      const path='/api/ocpp/reports/charging.pdf?'+chargingQuery();
      const blob=await api(path,'GET',undefined,'blob');
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download='ChargeVisor-Ladebericht.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(err){toast(err.message);}
    finally{if(button.isConnected)button.disabled=false;}
  }

  const allPointsOption=()=>'<label class="cv-form-checkbox"><input type="checkbox" name="allPoints"> Alle aktiven Ladepunkte</label>';
  function bindAllPoints(form){
    const all=form.elements.allPoints;
    if(!all)return;
    form.addEventListener('change',event=>{
      if(event.target===all){
        for(const checkbox of form.querySelectorAll('input[name="pointIds"]:not(:disabled),input[name="accessIds"]:not(:disabled)'))
          checkbox.checked=all.checked;
      }else if(['pointIds','accessIds'].includes(event.target.name)&&!event.target.checked){
        all.checked=false;
      }
    });
  }

  async function refreshData(message){
  await loadLive();render();if(message)toast(message);
}

  function showModal(type,id){
  const superRole=state.role==='super', current=scope(),points=myChargers().filter(x=>!x.disabled);
  let content='';
  if(type==='tenant'||type==='edit-tenant'){
    if(!superRole)return;
    const editing=type==='edit-tenant';
    const t=editing?db.tenants.find(x=>x.id===id):null;
    if(editing&&!t)return;
    content='<p class="cv-modal-sub">'+(editing?'Kundendaten und Ansprechpartner aktualisieren.':'Kundenkonto erstellen und optional die Kontaktperson als Kunden-Admin einladen.')+'</p>'+
      '<form id="pilotForm" class="cv-form">'+
      '<div class="field"><label>Kundenname / Firmenname / WEG</label><input name="name" required maxlength="180" value="'+esc(t?.name||'')+'" placeholder="z. B. Muster Hausverwaltung GmbH"></div>'+
      '<div class="cv-form-divider">Ansprechpartner</div>'+
      '<div class="field"><label>Name der Kontaktperson</label><input name="contactName" required maxlength="160" autocomplete="name" value="'+esc(t?.contact_name||'')+'" placeholder="Vor- und Nachname"></div>'+
      '<div class="cv-form-grid"><div class="field"><label>E-Mail-Adresse</label><input name="contactEmail" type="email" required autocomplete="email" maxlength="254" value="'+esc(t?.contact_email||'')+'" placeholder="name@firma.de"></div>'+
      '<div class="field"><label>Telefonnummer</label><input name="contactPhone" type="tel" required autocomplete="tel" maxlength="60" value="'+esc(t?.contact_phone||'')+'" placeholder="+49 …"></div></div>'+
      (editing?'<div class="field"><label>Kundenstatus</label><select name="status">'+
        ['active','pending','suspended'].map(s=>'<option value="'+s+'" '+(t.status===s?'selected':'')+'>'+({active:'Aktiv',pending:'In Vorbereitung',suspended:'Gesperrt'})[s]+'</option>').join('')+
        '</select></div>':
        '<label class="cv-form-checkbox"><input type="checkbox" name="inviteContact" value="yes"> Kontaktperson per E-Mail als Kunden-Admin einladen</label>')+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn" type="submit">'+(editing?'Änderungen speichern':'Kunde erstellen')+'</button></div></form>';
  }else if(type==='site'||type==='edit-site'){
    if(!superRole||!state.tenant)return;
    const editing=type==='edit-site';
    const s=editing?db.sites.find(x=>x.id===id&&x.tenant===state.tenant):null;
    if(editing&&!s)return;
    content='<p class="cv-modal-sub">Vollständige Standortadresse für die Ladeinfrastruktur.</p>'+
      '<form id="pilotForm" class="cv-form"><div class="field"><label>Standortname</label>'+
      '<input name="name" maxlength="160" required value="'+esc(s?.name||'')+'" placeholder="z. B. Tiefgarage Haus A"></div>'+
      '<div class="cv-form-grid cv-form-street"><div class="field"><label>Straße</label>'+
      '<input name="street" required maxlength="160" value="'+esc(s?.street||'')+'" placeholder="Musterstraße"></div>'+
      '<div class="field"><label>Hausnummer</label><input name="houseNumber" required maxlength="30" value="'+esc(s?.house_number||'')+'" placeholder="12a"></div></div>'+
      '<div class="cv-form-grid cv-form-location"><div class="field"><label>Postleitzahl</label>'+
      '<input name="postalCode" required maxlength="20" value="'+esc(s?.postal_code||'')+'" placeholder="85276"></div>'+
      '<div class="field"><label>Ort</label><input name="city" required maxlength="120" value="'+esc(s?.city||'')+'" placeholder="Pfaffenhofen"></div></div>'+
      '<div class="field"><label>Land</label><input name="country" required maxlength="90" value="'+esc(s?.country||'Deutschland')+'"></div>'+
      (editing&&!s.street?'<p class="cv-legacy-note">Die bisherige Adresse war nur als Freitext gespeichert: '+esc(s.address||'–')+'. Bitte die Felder einmal vervollständigen.</p>':'')+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button>'+
      '<button class="btn" type="submit">'+(editing?'Standort aktualisieren':'Standort speichern')+'</button></div></form>';
  }else if(type==='station'){
    if(!superRole||!state.tenant)return;
    if(!availableSites().length){toast('Lege zuerst einen Standort an.');return;}
    content='<div class="cv-setup-progress"><span class="current">1 · Ladestation anlegen</span><span>2 · Wallbox verbinden</span></div>'+
      '<p class="cv-setup-intro">Trage nur die Anlage ein. Die OCPP-Zugangsdaten erstellt ChargeVisor anschließend automatisch.</p>'+
      '<form id="pilotForm">'+
      '<div class="field"><label>Standort</label><select name="siteId">'+availableSites().map(s=>'<option value="'+esc(s.id)+'" '+(s.id===state.siteOpen?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Name der Ladestation</label><input name="name" required maxlength="160" placeholder="z. B. Lumina Master"></div>'+
      '<div class="field"><label>Anzahl Ladepunkte</label><input name="count" type="number" id="pilotCount" min="1" max="32" value="1" required></div>'+
      '<div class="field" id="pilotTopologyWrap" hidden><label>OCPP-Verbindung bei mehreren Ladepunkten</label>'+
        '<select name="topology" id="pilotTopology"><option value="shared">Eine OCPP-Verbindung (Master mit Connectoren)</option>'+
        '<option value="individual">Eigene OCPP-Verbindung je Wallbox</option></select></div>'+
      '<div class="station-point-list"><h3>Ladepunkte benennen</h3><div id="pilotPoints"></div></div>'+
      (testTools()?'<label class="cv-virtual-option"><input type="checkbox" name="isSimulator" value="yes"> Virtuelle Test-Wallbox (ohne echte Hardware)</label>':'')+
      '<details class="cv-setup-advanced"><summary>Erweiterte Angaben (optional)</summary>'+
        '<div class="field"><label>Seriennummer / Anlagenkennung</label><input name="serial" maxlength="120"></div>'+
        '<div class="field" id="pilotShared"><label>Feste OCPP-ID der Wallbox</label>'+
        '<input name="ocppIdentity" id="pilotOcpp" placeholder="Leer lassen = ChargeVisor erzeugt die ID"></div>'+
        '<p class="inline-help">Nur verwenden, falls die Wallbox eine unveränderliche OCPP-ID vorgibt.</p></details>'+
      '<p class="cv-setup-note">Im nächsten Schritt erhältst du die Charge Point ID und das OCPP-Passwort. Die WSS-Adresse folgt, sobald unser OCPP-Server bereitsteht.</p>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button>'+
      '<button class="btn" type="submit">Speichern & Verbindungsdaten anzeigen</button></div></form>';
  }else if(type==='create-user'){
    if(state.role==='user'||preview||!state.tenant)return;
    content='<p>Das RFID-Profil kann Ladepunkte und Karten erhalten. Der Portalzugang entsteht durch eine separate Einladung.</p>'+
      '<form id="pilotForm"><div class="field"><label for="newDriverName">Name</label><input id="newDriverName" name="name" required maxlength="160"></div>'+
      '<div class="field"><label for="newDriverEmail">E-Mail-Adresse</label><input id="newDriverEmail" name="email" type="email" required maxlength="254"></div>'+
      (points.length?'<div class="station-point-list"><h3>Ladepunkte zuweisen</h3>'+allPointsOption()+points.map(p=>
        '<label class="mode-option"><input type="checkbox" name="pointIds" value="'+esc(p.id)+'">'+esc(p.location)+'</label>').join('')+'</div>':'')+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn" type="submit">Nutzer hinzufügen</button></div></form>';
  }else if(type==='admin-permissions'){
    const admin=availablePeople().find(p=>p.id===id&&p.role==='admin'&&p.state==='aktiv');
    if(!superRole||!admin||preview)return;
    content='<p>'+esc(admin.name)+' · '+esc(tenant().name)+'</p><form id="pilotForm">'+
      '<label class="cv-form-checkbox"><input type="checkbox" name="canInviteUsers" '+(admin.canInviteUsers?'checked':'')+'> Nutzer zum Portal einladen</label>'+
      '<label class="cv-form-checkbox"><input type="checkbox" name="canDownloadPdf" '+(admin.canDownloadPdf?'checked':'')+'> PDF-Ladeberichte herunterladen</label>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn" type="submit">Freigaben speichern</button></div></form>';
  }else if(type==='charge-mode'){
    const point=myChargers().find(p=>p.id===id);
    const station=point&&getStation(point);
    if(!superRole||preview||!point?.ocppId||!station||station.isSimulator)return;
    const live=liveForPoint(point);
    const onlineLumina=live?.connected&&/enelion/i.test(live.vendor||'')&&/lumina/i.test(live.model||'');
    content='<p>'+esc(station.name)+' · '+esc(point.location)+'</p><form id="pilotForm">'+
      '<div class="field"><label for="chargeMode">Lademodus</label><select id="chargeMode" name="chargeMode">'+
      '<option value="rfid" '+(!point.freechargeEnabled?'selected':'')+'>RFID erforderlich</option>'+
      '<option value="freecharge" '+(point.freechargeEnabled?'selected':'')+'>Freecharge (Einstecken und laden)</option></select></div>'+
      '<p class="inline-help">Für Freecharge muss die Wallbox beim Einstecken den idTag <strong>CV-FREECHARGE</strong> senden. Die Online-Freigabe gilt für diesen Ladepunkt.</p>'+
      (onlineLumina?'<label class="cv-form-checkbox"><input type="checkbox" name="applyLumina" checked> Einstellung an die verbundene Lumina übertragen</label>'+
        '<p class="inline-help">Alle Ladepunkte an derselben OCPP-Verbindung müssen für die Übertragung denselben Modus haben.</p>':
        '<p class="inline-help">Gerätemodus und Freecharge-idTag an der Wallbox einstellen. Die direkte Übertragung ist verfügbar, sobald eine Lumina erkannt und verbunden ist.</p>')+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn" type="submit">Lademodus speichern</button></div></form>';
  }else if(type==='invite'){
    if(!canInvite()||!state.tenant)return;
    content='<form id="pilotForm"><div class="field"><label>Name</label><input name="name" required maxlength="160"></div><div class="field"><label>E-Mail-Adresse</label><input name="email" id="cvInviteEmail" type="email" required></div>'+
      '<p id="cvExistingAccountInfo" class="cv-existing-user-note" hidden></p>'+
      (superRole?'<div class="field"><label>Rolle</label><select name="role" id="pilotRole"><option value="user">Nutzer</option><option value="admin">Kunden-Admin</option></select></div>':'')+
      '<div id="pilotAccess"><h3>Ladepunkte für den Nutzer</h3><p class="inline-help">Neue Nutzer bekommen eine Einladung zur Registrierung. Bereits registrierte Nutzer bekommen weitere Ladepunkte direkt freigeschaltet und eine E-Mail – ohne neues Passwort.</p>'+
      (points.length?allPointsOption()+points.map(p=>'<label class="mode-option"><input type="checkbox" name="pointIds" value="'+esc(p.id)+'">'+esc(db.sites.find(s=>s.id===p.siteId)?.name||'')+' · '+esc(p.location)+'</label>').join(''):'<p>Noch keine aktiven Ladepunkte. Walectra muss zuerst Geräte anlegen.</p>')+'</div>'+
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Zugang einrichten / aktualisieren</button></div></form>';
  }else if(type==='access'||type==='user-access'){
    if(state.role==='user')return;
    const selectedUser=type==='user-access'?availablePeople().find(x=>x.id===id):null;
    const selectedPoint=type==='access'?myChargers().find(x=>x.id===id):null;
    if(type==='user-access'&&!selectedUser||type==='access'&&!selectedPoint)return;
    const target=type==='access'?availablePeople().filter(x=>x.role==='user'&&x.state==='aktiv'):points;
    content='<p>'+esc(type==='access'?'Ladepunkt: '+selectedPoint.location:'Nutzer: '+selectedUser.name)+'</p>'+
      '<form id="pilotForm"><div class="station-point-list">'+(type==='user-access'?allPointsOption():'')+target.map(x=>{
        const checked=type==='access'?x.chargerIds.includes(id):selectedUser.chargerIds.includes(x.id);
        return '<label class="mode-option"><input type="checkbox" name="accessIds" value="'+esc(x.id)+'" '+(checked?'checked':'')+'>'+esc(type==='access'?x.name:x.location)+'</label>';
      }).join('')+'</div><label class="cv-form-checkbox"><input type="checkbox" name="notify" value="yes" checked> Nutzer bei neuen Ladepunkten per E-Mail benachrichtigen (kein neuer Login nötig)</label><div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Zuweisungen speichern</button></div></form>';
    if(!target.length){toast('Noch keine freigeschalteten Nutzer oder Ladepunkte.');return;}
  }else if(type==='rename'||type==='toggle'){
    if(!superRole)return;const point=myChargers().find(x=>x.id===id);if(!point)return;
    content=type==='rename'?'<form id="pilotForm"><div class="field"><label>Name des Ladepunkts</label><input name="name" required maxlength="160" value="'+esc(point.location)+'"></div><div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Speichern</button></div></form>':
      '<form id="pilotForm"><p>'+esc(point.location)+' '+(point.disabled?'aktivieren':'deaktivieren')+'?</p><div class="modal-actions"><button type="button" class="btn ghost" data-close-modal>Abbrechen</button><button class="btn">Bestätigen</button></div></form>';
  }else return;
  const close=modal(({tenant:'Neuen Kunden anlegen','edit-tenant':'Kundendaten bearbeiten',site:'Standort hinzufügen','edit-site':'Standort bearbeiten',station:'Ladestation einrichten',invite:'Benutzer einladen',access:'Nutzer zuweisen','user-access':'Ladepunkte zuweisen',rename:'Ladepunkt bearbeiten',toggle:'Ladepunkt schalten',license:'Kundenlizenz verwalten',
    'create-user':'Nutzer hinzufügen','admin-permissions':'Freigaben für Kunden-Admin','charge-mode':'Lademodus einstellen'})[type],content);
  bindAllPoints($('pilotForm'));
  if(type==='station'){
    const draw=()=>{
      const form=$('pilotForm');
      const n=Math.max(1,Math.min(32,Number($('pilotCount').value)||1));
      if(n===1)$('pilotTopology').value='shared';
      $('pilotTopologyWrap').hidden=n===1;
      const shared=form.elements.topology.value==='shared';
      $('pilotShared').hidden=!shared;
      $('pilotOcpp').required=false;
      const old=[...$('pilotPoints').querySelectorAll('[data-point-row]')].map(el=>({
        name:el.querySelector('[name="pointName"]')?.value||'',
        ocpp:el.querySelector('[name="pointOcpp"]')?.value||''
      }));
      $('pilotPoints').innerHTML=Array.from({length:n},(_,i)=>
        '<div class="station-point-input" data-point-row><span class="point-index">#'+(i+1)+'</span>'+
        '<div class="field"><label>Ladepunktname</label><input name="pointName" required maxlength="160" value="'+esc(old[i]?.name||'Stellplatz '+(i+1))+'"></div>'+
        (shared?(n>1?'<span class="cv-point-connector">Connector '+(i+1)+'</span>':''):
        '<details class="cv-setup-advanced cv-point-advanced"><summary>OCPP-ID manuell vergeben</summary>'+
        '<div class="field"><label>Feste OCPP-ID (optional)</label><input name="pointOcpp" value="'+esc(old[i]?.ocpp||'')+
          '" placeholder="Leer = automatisch"></div></details>')+
        '</div>').join('');
    };
    $('pilotTopology').addEventListener('change',draw);
    $('pilotCount').addEventListener('change',draw);
    draw();
  }
  if(type==='invite'&&$('pilotRole'))$('pilotRole').addEventListener('change',()=>{$('pilotAccess').hidden=$('pilotRole').value==='admin';});
  if(type==='invite'){
    $('cvInviteEmail').addEventListener('input',()=>{
      const form=$('pilotForm');
      const entered=form.elements.email.value.trim().toLowerCase();
      const match=availablePeople().find(x=>x.email.toLowerCase()===entered&&x.state==='aktiv');
      const info=$('cvExistingAccountInfo');
      if(match){
        form.elements.name.value=match.name;
        info.hidden=false;
        info.textContent=match.role==='user'
          ?(match.portalEnabled===false?'Dieses RFID-Profil erhält mit der Einladung einen Portalzugang. Karte und bisherige Ladepunkte bleiben zugeordnet.':
            'Bestehender Nutzer: Wähle weitere Ladepunkte. Bereits vorhandene Freigaben bleiben erhalten.')
          :'Dieses Konto ist bereits als Kunden-Admin angelegt. Es wird kein neuer Benutzer benötigt.';
      }else{
        info.hidden=true;
      }
      for(const cb of form.querySelectorAll('input[name="pointIds"]')){
        const already=match?.role==='user'&&match.chargerIds.includes(cb.value);
        cb.disabled=!!already;
        cb.checked=!!already||form.elements.allPoints?.checked===true;
        cb.closest('label')?.classList.toggle('cv-already-assigned',!!already);
      }
    });
  }

  if(preview){
    const form=$('pilotForm');
    for(const btn of form.querySelectorAll('button[type=submit],button:not([type])'))btn.disabled=true;
    form.addEventListener('submit',event=>event.preventDefault());
    return;
  }

  $('pilotForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,fd=new FormData(form);
    const data=Object.fromEntries(fd.entries());
    const btn=form.querySelector('button[type=submit],button:not([type])');if(btn)btn.disabled=true;
    const allPoints=form.elements.allPoints?.checked===true;
    try{
      let msg='Gespeichert.';
      if(type==='tenant'){
        const created=await api('/api/tenants','POST',{
          name:data.name,contactName:data.contactName,contactEmail:data.contactEmail,contactPhone:data.contactPhone
        });
        state.tenant=created.id;state.siteOpen='';state.page='customers';msg='Kunde erstellt.';
        if(data.inviteContact==='yes'){
          try{
            const sent=await api('/api/invitations','POST',{
              tenantId:created.id,name:data.contactName,email:data.contactEmail,role:'admin',pointIds:[]
            });
            msg+=' '+adminInvitationMessage(sent);
            if(sent.delivery==='manual'&&sent.link)window.prompt('Einladungslink für den Kunden-Admin:',sent.link);
          }catch(invErr){msg+=' Die Admin-Einladung konnte nicht abgeschlossen werden: '+invErr.message;}
        }
      }else if(type==='edit-tenant'){
        await api('/api/tenants/'+id,'PATCH',{
          name:data.name,contactName:data.contactName,contactEmail:data.contactEmail,
          contactPhone:data.contactPhone,status:data.status
        });
        state.tenant=id;msg='Kundendaten aktualisiert.';
      }else if(type==='site'||type==='edit-site'){
        const payload={...scope(),name:data.name,street:data.street,houseNumber:data.houseNumber,
          postalCode:data.postalCode,city:data.city,country:data.country};
        const site=type==='site'?
          await api('/api/structure/sites','POST',payload):
          (await api('/api/structure/sites/'+id,'PATCH',payload)).site;
        state.siteOpen=site.id;msg=type==='site'?'Standort gespeichert.':'Standortadresse aktualisiert.';
      }else if(type==='station'){
        const topology=data.topology;
        const rows=[...form.querySelectorAll('[data-point-row]')];
        const specs=rows.map(row=>({name:row.querySelector('[name="pointName"]').value,
          ocppIdentity:topology==='individual'?row.querySelector('[name="pointOcpp"]').value:undefined}));
        const provisioned=await api('/api/structure/stations','POST',{...scope(),siteId:data.siteId,name:data.name,serial:data.serial,topology,
          ocppIdentity:data.ocppIdentity,pointSpecs:specs,isSimulator:data.isSimulator==='yes'});
        // Never discard one-time secrets, even if the following dashboard refresh fails.
        close();
        try{await refreshData('Ladestation mit '+specs.length+' Ladepunkt(en) angelegt.');}
        catch(err){toast('Gespeichert, aber die Übersicht konnte nicht aktualisiert werden: '+err.message);}
        showOcppCredentials(provisioned.credentials||[],{
          stationName:data.name,wssConfigured:provisioned.wssConfigured,oneTime:true,isSimulator:provisioned.isSimulator
        });
        return;
      }else if(type==='create-user'){
        const pointIds=allPoints?[]:fd.getAll('pointIds');
        await api('/api/users','POST',{...scope(),name:data.name,email:data.email,pointIds,allPoints});
        msg='RFID-Nutzerprofil hinzugefügt.';
      }else if(type==='admin-permissions'){
        await api('/api/users/'+encodeURIComponent(id)+'/admin-permissions','PUT',{
          ...scope(),canInviteUsers:form.elements.canInviteUsers.checked,canDownloadPdf:form.elements.canDownloadPdf.checked
        });
        msg='Admin-Freigaben gespeichert.';
      }else if(type==='charge-mode'){
        await api('/api/structure/points/'+encodeURIComponent(id),'PATCH',{
          ...scope(),freechargeEnabled:data.chargeMode==='freecharge'
        });
        msg='Online-Lademodus gespeichert.';
        if(data.applyLumina){
          try{
            const result=await api('/api/ocpp/freecharge-configuration','POST',{...scope(),pointId:id});
            msg+=result.status==='RebootRequired'?' Die Lumina verlangt einen Neustart.':' Die Lumina hat die Einstellung bestätigt.';
          }catch(err){msg+=' Übertragung zur Wallbox: '+err.message;}
        }
      }else if(type==='invite'){
        const role=superRole?data.role:'user';
        const pointIds=role==='user'&&!allPoints?[...form.querySelectorAll('input[name="pointIds"]:checked')].map(x=>x.value):[];
        const result=await api('/api/invitations','POST',{...scope(),name:data.name,email:data.email,role,pointIds,allPoints:role==='user'&&allPoints});
        if(role==='admin'){
          msg=adminInvitationMessage(result);
        }else if(result.existingUser){
          msg=result.alreadyAssigned?'Der Nutzer hat diese Ladepunkte bereits. Keine erneute Einladung notwendig.':
            result.delivery==='email'?'Weitere Ladepunkte freigeschaltet und Nutzer per E-Mail benachrichtigt.':
            'Weitere Ladepunkte freigeschaltet. Die E-Mail-Benachrichtigung konnte nicht gesendet werden.';
        }else{
          msg=result.delivery==='email'?'Einladung für neuen Nutzer versendet.':
            'Einladung erstellt, automatischer Versand fehlgeschlagen.';
        }
        if(result.delivery==='manual'&&result.link)window.prompt('Einladungslink kopieren und weiterleiten:',result.link);
      }else if(type==='rename'||type==='toggle'){
        const p=myChargers().find(x=>x.id===id);
        await api('/api/structure/points/'+id,'PATCH',{...scope(),...(type==='rename'?{name:data.name}:{enabled:!!p.disabled})});
      }else if(type==='access'||type==='user-access'){
        const selected=new Set([...form.querySelectorAll('input[name="accessIds"]:checked')].map(x=>x.value));
        let added=0,failed=0,notified=0;
        const notify=data.notify==='yes';
        if(type==='user-access'){
          const result=await api('/api/users/'+id+'/points','PUT',{
            ...scope(),pointIds:allPoints?[]:[...selected],allPoints,notify
          });
          added=result.addedPoints||0;
          if(result.delivery==='email')notified++;
          if(result.delivery==='failed')failed++;
        }else{
          const targets=availablePeople().filter(p=>p.role==='user'&&p.state==='aktiv');
          for(const user of targets){
            const desired=selected.has(user.id),has=user.chargerIds.includes(id);
            if(desired===has)continue;
            const result=await api('/api/points/'+id+'/access','PUT',{
              ...scope(),userId:user.id,allowed:desired,notify
            });
            added+=result.addedPoints||0;
            if(result.delivery==='email')notified++;
            if(result.delivery==='failed')failed++;
          }
        }
        msg='Zuweisungen gespeichert.'+(notified?' '+notified+' Benachrichtigung(en) versendet.':'')+
          (failed?' '+failed+' E-Mail(s) konnten nicht versendet werden.':'')+
          (added&&!notify?' Keine E-Mail versendet (abgewählt).':'');
      }
      close();await refreshData(msg);
    }catch(err){if(btn)btn.disabled=false;toast(err.message);}
  });
}

  async function handleClick(e){
  if(changingView)return;
  if(e.target.closest('#rolePreviewBtn')){showRolePreview();return;}
  if(e.target.closest('#endRolePreview')&&preview){
    if(await changeRoleView(null))$('rolePreviewBtn').focus();
    return;
  }
  const page=e.target.closest('[data-page]');
  if(page){state.page=page.dataset.page;state.query='';$('sidebar').classList.remove('show');render();return;}
  const site=e.target.closest('[data-open-site]');
  if(site){
    const id=site.dataset.openSite;
    if(state.page==='overview'){if(collapsedSites.has(id))collapsedSites.delete(id);else collapsedSites.add(id);}
    else state.siteOpen=state.siteOpen===id?'':id;
    render();syncOverviewNavigation();return;
  }
  const extend=e.target.closest('[data-extend-station]');
  if(extend){extendStation(extend.dataset.extendStation);return;}
  const chargePermission=e.target.closest('[data-charge-permissions]');
  if(chargePermission){changeChargePermissions(chargePermission.dataset.chargePermissions);return;}
  const command=e.target.closest('[data-ocpp-control]');
  if(command){await runChargingCommand(command);return;}
  const health=e.target.closest('[data-site-health],[data-fault-point]');
  if(health){
    const fault=myChargers().find(point=>point.id===health.dataset.faultPoint);
    state.siteOpen=fault?.siteId||health.dataset.siteHealth;
    state.expanded=fault?.id||'';
    state.page='sites';state.query='';render();
    if(fault)document.querySelector('[data-expand="'+fault.id+'"]')?.scrollIntoView({block:'center'});
    return;
  }
  const monthStep=e.target.closest('[data-month-step]');
  if(monthStep){
    const filters=state.sessionFilters;
    filters.month=offsetMonth(filters.month||currentMonth(),Number(monthStep.dataset.monthStep));
    render();return;
  }
  if(e.target.closest('#toggleCustomDates')){
    const filters=state.sessionFilters;
    if(!filters.custom)Object.assign(filters,monthRange(filters.month||currentMonth()));
    filters.custom=!filters.custom;
    render();return;
  }
  const detail=e.target.closest('[data-expand]');
  if(detail){state.expanded=state.expanded===detail.dataset.expand?'':detail.dataset.expand;render();return;}
  const editCustomer=e.target.closest('[data-edit-customer]');
  if(editCustomer&&state.role==='super'){showModal('edit-tenant',editCustomer.dataset.editCustomer);return;}
  const openCustomer=e.target.closest('[data-open-customer],[data-customer-users]');
  if(openCustomer&&state.role==='super'){
    const previous={tenant:state.tenant,page:state.page,siteOpen:state.siteOpen,expanded:state.expanded,query:state.query};
    const manageUsers=openCustomer.dataset.customerUsers;
    Object.assign(state,{tenant:manageUsers||openCustomer.dataset.openCustomer,page:manageUsers?'user-management':'overview',siteOpen:'',expanded:'',query:''});
    $('sidebar').classList.remove('show');
    changingView=true;
    try{await refreshData();}catch(err){
      Object.assign(state,previous);
      toast(err.message);
      await refreshData().catch(()=>{});
    }
    finally{changingView=false;}
    return;
  }
  const deleteCustomer=e.target.closest('[data-delete-customer]');
  if(deleteCustomer&&state.role==='super'){
    const t=db.tenants.find(x=>x.id===deleteCustomer.dataset.deleteCustomer);
    if(!t)return;
    if(!window.confirm('Kunde "'+t.name+'" archivieren?\n\n'+
      'Das Kundenkonto verschwindet aus der aktiven Verwaltung. Sitzungen enden, offene Einladungen verfallen und Geräte können sich nicht mehr neu verbinden. Die Daten bleiben gespeichert.\n\n'+
      'Du kannst dieselbe E-Mail-Adresse für eine Einladung zu einem anderen Kundenkonto verwenden. Der neue Zugang wird erst nach Annahme der Einladung aktiv.'))return;
    deleteCustomer.disabled=true;
    try{
      await api('/api/tenants/'+t.id,'DELETE');
      state.siteOpen='';state.tenant='';state.page='customers';
      await refreshData('Kunde archiviert. Die Daten bleiben gespeichert.');
    }catch(err){deleteCustomer.disabled=false;toast(err.message);}
    return;
  }
  const contactAction=e.target.closest('[data-invite-contact],[data-reset-contact-password]');
  if(contactAction&&state.role==='super'){
    const resetId=contactAction.dataset.resetContactPassword;
    const t=db.tenants.find(x=>x.id===(resetId||contactAction.dataset.inviteContact));
    if(!t)return;
    const access=contactAccess(t);
    if(resetId?!access.reset:!access.invite)return;
    const action=resetId?'Link zum Zurücksetzen des Passworts':'Einladung als Kunden-Admin';
    if(!window.confirm(action+' an '+t.contact_email+' senden?'))return;
    contactAction.disabled=true;
    let message;
    try{
      if(resetId){
        const result=await api('/api/tenants/'+encodeURIComponent(t.id)+'/contact-password-reset','POST',{});
        message=result.delivery==='email'?'Passwort-Link zum E-Mail-Versand übergeben.':
          'Der Passwort-Link konnte nicht per E-Mail versendet werden.';
      }else{
        const result=await api('/api/invitations','POST',{
          tenantId:t.id,name:t.contact_name,email:t.contact_email,role:'admin',pointIds:[]
        });
        message=result.existingUser?'Admin-Zugang bereits vorhanden. Bei Bedarf „Passwort-Link senden“ wählen.':
          adminInvitationMessage(result);
        if(result.delivery==='manual'&&result.link)window.prompt('Einladungslink:',result.link);
      }
    }catch(err){message=err.message;}
    try{await refreshData(message);}
    catch{toast(message+' Der Zugangsstatus konnte nicht aktualisiert werden.');}
    finally{contactAction.disabled=false;}
    return;
  }
  const editSite=e.target.closest('[data-edit-site]');
  if(editSite&&state.role==='super'){showModal('edit-site',editSite.dataset.editSite);return;}
  if(e.target.closest('#newTenantBtn')){showModal('tenant');return;}
  if(e.target.closest('#newSiteBtn')){showModal('site');return;}
  if(e.target.closest('#newChargerBtn')){showModal('station');return;}
  const creds=e.target.closest('[data-credentials]');
  if(creds){await showSavedCredentials(creds.dataset.credentials);return;}
  const testRfid=e.target.closest('[data-test-rfid]');
  if(testRfid){showTestRfid(testRfid.dataset.testRfid);return;}
  if(e.target.closest('#showTestSessions')){await showOcppSessions(true);return;}
  if(e.target.closest('#showPhysicalSessions')){await showOcppSessions(false);return;}
  const pdf=e.target.closest('#downloadChargingReport');
  if(pdf&&!pdf.disabled){
    if(!canDownloadPdf()){
      showPremium('PDF-Ladebericht');
    }else await downloadReport(pdf);
    return;
  }
  const reportExport=e.target.closest('[data-session-export]');
  if(reportExport){await exportChargingHistory(reportExport.dataset.sessionExport);return;}
  if(e.target.closest('#managePhysicalRfid')){showPhysicalRfid();return;}
  if(e.target.closest('#createUserBtn')){showModal('create-user');return;}
  if(e.target.closest('#inviteBtn')){if(!canInvite())showPremium('Portal-Einladungen');else showModal('invite');return;}
  const permissions=e.target.closest('[data-admin-permissions]');
  if(permissions){showModal('admin-permissions',permissions.dataset.adminPermissions);return;}
  const chargeMode=e.target.closest('[data-charge-mode]');
  if(chargeMode){showModal('charge-mode',chargeMode.dataset.chargeMode);return;}
  if(e.target.closest('#editCurrentCustomerBtn')){showModal('edit-tenant',state.tenant);return;}
  const access=e.target.closest('[data-access]');if(access){showModal('access',access.dataset.access);return;}
  const userAccess=e.target.closest('[data-user-access]');if(userAccess){showModal('user-access',userAccess.dataset.userAccess);return;}
  const virtual=e.target.closest('[data-run-ocpp-test]');
  if(virtual){
    virtual.disabled=true;virtual.textContent='Test läuft …';
    try{
      const result=await api('/api/ocpp/simulate','POST',{tenantId:state.tenant,stationId:virtual.dataset.runOcppTest});
      await refreshData('OCPP-Test erfolgreich: '+result.results.map(x=>x.action).join(' · '));
    }catch(err){virtual.disabled=false;virtual.textContent='OCPP-Test starten';toast(err.message);}
    return;
  }
  const rename=e.target.closest('[data-edit-point]');if(rename){showModal('rename',rename.dataset.editPoint);return;}
  const toggle=e.target.closest('[data-toggle-point]');if(toggle){showModal('toggle',toggle.dataset.togglePoint);return;}
}

  async function handleChange(e){
  if(['analyticsSite','analyticsPeriod','analyticsMetric'].includes(e.target.id)){
    if(e.target.id==='analyticsSite')overviewSite=e.target.value;
    if(e.target.id==='analyticsPeriod')overviewPeriod=e.target.value;
    if(e.target.id==='analyticsMetric')overviewMetric=e.target.value;
    render();return;
  }
  if(e.target.id==='sessionMonth'){
    state.sessionFilters.month=e.target.value;render();return;
  }
  if(state.page==='sessions'&&e.target.form?.id==='chargingFilters'&&['site','user'].includes(e.target.name)){
    state.sessionFilters[e.target.name]=e.target.value;
    void loadChargingHistory();return;
  }
  if(e.target.id==='tenantSelect'||e.target.id==='globalTenantSelect'){
    state.sessionFilters.user='';state.sessionFilters.site='';
    if(state.role!=='super'||changingView)return;
    const previous=state.tenant;
    state.tenant=e.target.value;state.siteOpen='';state.expanded='';state.query='';
    changingView=true;
    try{await refreshData();}
    catch(err){state.tenant=previous;toast(err.message);await refreshData().catch(()=>{});}
    finally{changingView=false;}
  }
}

  function handleInput(e){
  if(e.target.id==='searchInput'){
    const position=e.target.selectionStart;
    state.query=e.target.value;
    render();
    const input=$('searchInput');if(input){input.focus();input.setSelectionRange(position,position);}
  }
}

  async function pollLive(){
    if(changingView||!account||!state.tenant||!['sites','overview'].includes(state.page))return;
    if(document.visibilityState==='hidden'||$('modalHost').innerHTML)return;
    if(document.activeElement?.id==='searchInput')return;
    const tid=state.tenant;
    const view=preview;
    const r=await api('/api/ocpp/live?tenantId='+encodeURIComponent(tid));
    if(changingView||state.tenant!==tid||preview!==view||$('modalHost').innerHTML)return;
    db.ocpp=(r.live||[]).filter(x=>testTools()||!x.simulated);
    db.ocppConnectors=(r.connectors||[]).filter(x=>testTools()||!x.simulated);
    db.transactions=r.transactions||[];
    render();
  }
  async function init(){
  try{
    if(!await loadLive())return;
    render();
    document.addEventListener('click',handleClick);
    document.addEventListener('change',handleChange);
    window.addEventListener?.('scroll',syncOverviewNavigation,{passive:true});
    document.addEventListener('input',handleInput);
    $('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('show'));
    if(typeof setInterval==='function')setInterval(()=>{
      pollLive().catch(err=>console.warn('ChargeVisor live refresh:',err.message));
    },12000);
    $('logoutReal').addEventListener('click',async()=>{
      if(preview||changingView)return;
      try{await api('/api/auth/logout','POST',{});}finally{window.location.assign('/login');}
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('modalHost').replaceChildren();$('sidebar').classList.remove('show');}});
  }catch(err){
    const host=document.getElementById('content');
    if(host)host.textContent='ChargeVisor konnte die echten Kundendaten nicht laden: '+err.message;
  }
}
  init();
})();
