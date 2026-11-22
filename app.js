(() => {
  'use strict';
  const initial = {
    tenants: [
      { id: 'firma', name: 'Muster GmbH', site: 'Firmenpark Nord', defaultRate: 0.55 },
      { id: 'weg', name: 'WEG Sonnenhof', site: 'Tiefgarage Haus A', defaultRate: 0.55 }
    ],
    stations: [
      {id:'demo-master-firma',tenant:'firma',siteId:'firma-main',name:'Ladeanlage Firmenpark (Demo)',serial:'DEMO-MASTER-001',ocppId:'DEMO-MASTER-001',topology:'shared',type:'multi'}
    ],
    sites: [
      {id:'firma-main',tenant:'firma',name:'Firmenpark Nord',address:'Musterstraße 8 · Musterstadt'},
      {id:'weg-main',tenant:'weg',name:'Tiefgarage Haus A',address:'Sonnenweg 12 · Musterstadt'}
    ],
    people: [
      { id: 'u1', tenant: 'firma', name: 'Max Mustermann', email: 'max@example.test', chargerIds: ['F-01'], state: 'aktiv' },
      { id: 'u2', tenant: 'firma', name: 'Sophie Keller', email: 'sophie@example.test', chargerIds: ['F-02', 'F-03'], state: 'aktiv' },
      { id: 'u3', tenant: 'firma', name: 'Jonas Weber', email: 'jonas@example.test', chargerIds: ['F-04'], state: 'aktiv' },
      { id: 'u4', tenant: 'firma', name: 'Lea Fischer', email: 'lea@example.test', chargerIds: ['F-05', 'F-06'], state: 'aktiv' },
      { id: 'u5', tenant: 'weg', name: 'Anna Berger', email: 'anna@example.test', chargerIds: ['W-01'], state: 'aktiv' },
      { id: 'u6', tenant: 'weg', name: 'Tim Maier', email: 'tim@example.test', chargerIds: ['W-02'], state: 'aktiv' }
    ],
    chargers: [
      { id: 'F-01', stationId:'demo-master-firma', connectorNumber:1, tenant: 'firma', location: 'Stellplatz 01', serial: 'CV-2026-1001', power: 11, status: 'Bereit' },
      { id: 'F-02', stationId:'demo-master-firma', connectorNumber:2, tenant: 'firma', location: 'Stellplatz 02', serial: 'CV-2026-1002', power: 11, status: 'Lädt' },
      { id: 'F-03', stationId:'demo-master-firma', connectorNumber:3, tenant: 'firma', location: 'Stellplatz 03', serial: 'CV-2026-1003', power: 11, status: 'Bereit' },
      { id: 'F-04', stationId:'demo-master-firma', connectorNumber:4, tenant: 'firma', location: 'Stellplatz 04', serial: 'CV-2026-1004', power: 22, status: 'Bereit' },
      { id: 'F-05', stationId:'demo-master-firma', connectorNumber:5, tenant: 'firma', location: 'Stellplatz 05', serial: 'CV-2026-1005', power: 22, status: 'Offline' },
      { id: 'F-06', stationId:'demo-master-firma', connectorNumber:6, tenant: 'firma', location: 'Stellplatz 06', serial: 'CV-2026-1006', power: 11, status: 'Bereit' },
      { id: 'W-01', tenant: 'weg', location: 'Stellplatz A1', serial: 'CV-2026-2001', power: 11, status: 'Bereit' },
      { id: 'W-02', tenant: 'weg', location: 'Stellplatz A2', serial: 'CV-2026-2002', power: 11, status: 'Lädt' },
      { id: 'W-03', tenant: 'weg', location: 'Stellplatz A3', serial: 'CV-2026-2003', power: 11, status: 'Warnung' }
    ],
    tags: [], sessions: [], mode: { firma: 'single', weg: 'single' }
  };
  const dates = [16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
  const amounts = [18.5,11.2,22.7,16.9,14.3,27.4,8.1,21.6,19.2,12.8,15.7,24.1,7.2,9.6,20.4,10.8];
  initial.sessions = dates.map((day, i) => ({
    id: `S-${1000+i}`,
    tenant: 'firma',
    chargerId: `F-0${(i%6)+1}`,
    personId: ['u1','u2','u2','u3','u4','u4'][i%6],
    date: `2026-11-${String(day).padStart(2,'0')}`,
    kwh: amounts[i],
    duration: `${1+Math.floor(amounts[i]/10)} Std. ${String((i*7)%60).padStart(2,'0')} Min.`
  })).concat(Array.from({length:12}, (_,i)=>({
    id:`S-${1100+i}`, tenant:'firma', chargerId:`F-0${(i%6)+1}`,
    personId:['u1','u2','u2','u3','u4','u4'][i%6],date:`2026-10-${String(28-i*2).padStart(2,'0')}`,
    kwh:[19.4,13.3,10.8,22.8,14.9,18.3][i%6],duration:'1 Std. 48 Min.'
  }))).concat(Array.from({length:8},(_,i)=>({
    id:`S-${2000+i}`,tenant:'weg',chargerId:`W-0${i%2+1}`,personId:i%2===0?'u5':'u6',date:`2026-11-${String(15-i*2).padStart(2,'0')}`,
    kwh:[12.2,17.3,10.1,23.5][i%4],duration:'2 Std. 05 Min.'
  })));
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('chargevisor_demo_v1') || '{}'); } catch(e) {}
  const db = {
    tenants: [...new Map([...initial.tenants.map(x=>({...x})),...(Array.isArray(stored.tenants)?stored.tenants:[])].map(x=>[x.id,x])).values()],
    sites: [...initial.sites, ...(Array.isArray(stored.sites)?stored.sites:[])],
    stations: [...new Map([...initial.stations.map(x=>({...x})),...(Array.isArray(stored.stations)?stored.stations:[])].map(x=>[x.id,x])).values()],
    people: [...new Map([...initial.people, ...(Array.isArray(stored.people)?stored.people:[])].map(p=>[p.id,p])).values()].map(p=>({
      ...p, chargerIds: Array.isArray(stored.assignments?.[p.id]) ? stored.assignments[p.id].slice() : (p.chargerIds||[]).slice()
    })),
    chargers: [...new Map([...initial.chargers.map(x=>({...x})),...(Array.isArray(stored.chargers)?stored.chargers:[])].map(x=>[x.id,x])).values()],
    sessions: initial.sessions,
    tags: [...initial.tags, ...(Array.isArray(stored.tags)?stored.tags:[])],
    mode: {...initial.mode,...(stored.mode||{})}
  };
  const state = { role:'super', tenant:'firma', person:'u1', page:'overview', month:'2026-11', query:'', expanded:'', siteOpen:'firma-main', sessionFilters:{preset:'nov',from:'2026-11-01',to:'2026-11-30',user:'',site:'',point:'',status:''} };
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = n => Number(n).toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
  const euro = n => Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const rateText = n => Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €/kWh';
  const validPrice = value => Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=10;
  const rateForPerson = id => {
    const person=db.people.find(p=>p.id===id && p.tenant===state.tenant);
    const userRate=person?.rateOverride;
    return userRate!==null && userRate!==undefined && userRate!=='' ? Number(userRate) : Number(tenant()?.defaultRate??0.55);
  };
  const sessionRate = row => row.rateSnapshot!==undefined&&row.rateSnapshot!==null ? Number(row.rateSnapshot) : rateForPerson(row.personId);
  const sessionCost = row => Math.round(((Number(row.kwh)||0)*sessionRate(row)+Number.EPSILON)*100)/100;
  const save = () => {
    try {localStorage.setItem('chargevisor_demo_v1',JSON.stringify({tags:db.tags,assignments:Object.fromEntries(db.people.map(p=>[p.id,p.chargerIds])),stations:db.stations,tenants:db.tenants,sites:db.sites.filter(x=>!initial.sites.includes(x)),people:db.people,chargers:db.chargers,mode:db.mode}));}catch(e){}
  };
  function toast(msg) {const el=$('toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4200);}
  const tenant = () => db.tenants.find(t=>t.id===state.tenant);
  const availablePeople = () => db.people.filter(p=>p.tenant===state.tenant);
  const availableTags = () => db.tags.filter(t=>t.tenant===state.tenant);
  const user = () => db.people.find(p=>p.id===state.person&&p.tenant===state.tenant) || availablePeople()[0];
  const peopleForCharger = cid => availablePeople().filter(p=>p.chargerIds.includes(cid));
  const chargerSite = c => c.siteId || (c.tenant==='firma'?'firma-main':'weg-main');
  const availableSites = () => db.sites.filter(x=>x.tenant===state.tenant);
  const boltIcon = (extra='') => '<img src="/assets/blitz-bolt.svg" class="bolt-icon '+extra+'" alt="" aria-hidden="true">';
  const pointIssue = c => c.disabled ? 'stillgelegt'
    : c.status==='Offline' ? 'offline'
    : /Störung|Fehler|Fault|Error|Suspicious|Warnung|Problem/i.test(c.status||'') ? 'warning'
    : '';
  const luminaLedClass = c=>{
    if(c.disabled)return 'off';
    if(c.status==='Offline')return 'error';
    if(/Fehler|Fault|Error|Defekt/i.test(c.status||''))return 'error';
    if(/Warnung|Problem|Suspicious/i.test(c.status||''))return 'warning';
    if(c.status==='Lädt')return 'charging';
    return 'ready';
  };
  const luminaPreview = (c,small=false) => '<span class="lumina-preview lumina-'+luminaLedClass(c)+(small?' lumina-small':'')
      +'" role="img" aria-label="Lumina Demo, Status '+esc(pointStatus(c))+'">'
      +'<img src="/assets/lumina-thumb.svg?v=2" alt="" loading="lazy"><span class="lumina-led" aria-hidden="true"></span></span>';
  const pointStatusLabel = c => c.disabled?'Stillgelegt':(c.status||'Unbekannt');
  const statusIcon = x => x==='Stillgelegt'?'<span class="charge-symbol offline">⊘</span>':x==='Lädt'?'<span class="charge-symbol charging">'+boltIcon('status-bolt')+'</span>':x==='Offline'?'<span class="charge-symbol offline">×</span>'
    :/Fehler|Fault|Error|Defekt/i.test(x)?'<span class="charge-symbol offline">!</span>'
    :/Warnung|Problem|Suspicious/i.test(x)?'<span class="charge-symbol warning">!</span>'
    :'<span class="charge-symbol ready">●</span>';
  const getStation = c => db.stations.find(st=>st.id===c.stationId);
  const stationKey = c => c.stationId || 'legacy-'+c.id;
  const myChargers = () => db.chargers.filter(c=>c.tenant===state.tenant && !c.archived && (state.role!=='user'||user()?.chargerIds.includes(c.id)));
  const pointStatus = c => c.disabled ? 'Stillgelegt' : c.status;
  const mySessions = () => db.sessions.filter(s=>s.tenant===state.tenant && (state.role!=='user'||s.personId===user()?.id));
  const periodSessions = () => mySessions().filter(s=>s.date.startsWith(state.month));
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
  const link = (id,text,ico) => `<button type="button" class="nav-item ${state.page===id?'active':''}" data-page="${id}"><span class="ico">${ico}</span>${text}</button>`;
  const monthPicker = () => `<select id="monthSelect" aria-label="Monat"><option value="2026-11" ${state.month==='2026-11'?'selected':''}>November 2026</option><option value="2026-10" ${state.month==='2026-10'?'selected':''}>Oktober 2026</option></select>`;
  function head(title,sub,actions='') {return `<div class="headline"><div><div class="eyebrow">${state.role==='super'?'WALECTRA MANAGEMENT':esc(tenant().name.toUpperCase())}</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="head-actions">${actions}</div></div>`;}
  function renderNav() {
    const allowed = state.role==='user' ? [['overview','Übersicht','▦'],['sites','Meine Ladepunkte',boltIcon('nav-bolt')],['sessions','Meine Ladevorgänge','▤']] : [['overview','Übersicht','▦'],['sites','Standorte & Ladepunkte',boltIcon('nav-bolt')],['sessions','Ladevorgänge','▤'],['people','Nutzer & RFID','♙'],['settings','Einstellungen','⚙']];
    if(!allowed.some(x=>x[0]===state.page))state.page='overview';
    $('nav').innerHTML=allowed.map(x=>link(...x)).join('');
  }
  function dashboard(){
  const sessions=periodSessions(),selected=myChargers(),kwh=total(sessions);
  const fleet=(state.role==='super'?db.chargers.filter(c=>!c.archived):selected);
  const charging=fleet.filter(c=>!c.disabled&&c.status==='Lädt').length;
  const offline=fleet.filter(c=>pointIssue(c)==='offline').length;
  const warning=fleet.filter(c=>pointIssue(c)==='warning').length;
  const disabled=fleet.filter(c=>pointIssue(c)==='stillgelegt').length;
  const healthTitle=state.role==='super'?'Systemstatus · alle Kunden':'Systemstatus · '+tenant().name;
  const metrics=[
    ['Ladepunkte',fleet.length,state.role==='super'?'Kundenübergreifend':'Beim ausgewählten Kunden',boltIcon('metric-bolt'),''],
    ['Laden gerade',charging,'Aktive Ladevorgänge','◉','teal'],
    ['Offline',offline,'Keine Verbindung','○','issue-offline'],
    ['Störungen',warning,'Warnungen und Fehler','!','issue-warning'],
    ['Energie im Monat',num(kwh)+' kWh','Ausgewählter Kunde','▥','energy']
  ];
  const sites=new Map();
  fleet.forEach(c=>{
    const customer=db.tenants.find(t=>t.id===c.tenant);
    const site=db.sites.find(t=>t.id===chargerSite(c));
    const key=c.tenant+'::'+(site?.id||chargerSite(c));
    if(!sites.has(key))sites.set(key,{key,tenantId:c.tenant,siteId:site?.id||'',customer:customer?.name||'Kunde',name:site?.name||'Standort',points:[],offline:0,warnings:0,disabled:0});
    const row=sites.get(key);
    row.points.push(c);
    const kind=pointIssue(c);
    if(kind==='offline')row.offline++;
    if(kind==='warning')row.warnings++;
    if(kind==='stillgelegt')row.disabled++;
  });
  const siteRows=[...sites.values()].sort((a,b)=>(b.offline+b.warnings+b.disabled)-(a.offline+a.warnings+a.disabled));
  const trouble=offline+warning;
  const dayValues=[...Array(8)].map((_,i)=>{const d=16-i;return {day:d,kwh:total(sessions.filter(x=>Number(x.date.slice(-2))===d))};}).reverse();
  const max=Math.max(1,...dayValues.map(d=>d.kwh));
  const tops=selected.map(c=>({name:c.location,kwh:total(sessions.filter(x=>x.chargerId===c.id))})).sort((a,b)=>b.kwh-a.kwh).slice(0,4);
  const topMax=Math.max(1,...tops.map(x=>x.kwh));
  return `${head(state.role==='user'?`Hallo, ${esc(user()?.name.split(' ')[0]||'Nutzer')}!`:'Ladeinfrastruktur im Überblick',
    state.role==='user'?'Persönlicher Verbrauch und freigegebene Ladepunkte.':'Ladepunkte, Verfügbarkeit und mögliche Störungen auf einen Blick.',
    `${state.role==='super'?`<select id="tenantSelect" class="tenant-select" aria-label="Kunde auswählen">${db.tenants.map(t=>`<option value="${esc(t.id)}" ${t.id===state.tenant?'selected':''}>${esc(t.name)}</option>`).join('')}</select><button class="btn small" id="newTenantBtn">+ Kunde</button>`:''}${state.role!=='user'?'<button class="btn ghost small" id="editTenantBtn">Stammdaten</button>':''}${monthPicker()}`)}
    <div class="metrics health-metrics">${metrics.map(m=>`<div class="metric ${m[4]}"><div class="metric-top"><span class="metric-label">${m[0]}</span><div class="metric-icon ${m[4]}">${m[3]}</div></div><div class="metric-value">${m[1]}</div><div class="metric-foot">${m[2]}</div></div>`).join('')}</div>
    <section class="panel health-panel">
      <div class="panel-head"><div><h2>${esc(healthTitle)}</h2><div class="panel-caption">${trouble?`${trouble} Problem${trouble===1?'':'e'} sichtbar, davon ${offline} offline · ${warning} Störungen`:'Keine Offline- oder Störungsmeldungen in diesen Demodaten'}</div></div><span class="health-overall ${trouble?'has-issues':'all-good'}">${trouble?'Handlungsbedarf':'Alles im grünen Bereich'}</span></div>
      <div class="health-legend"><span><i class="health-dot online"></i> Verfügbar / lädt</span><span><i class="health-dot offline"></i> Offline</span><span><i class="health-dot warning"></i> Störung</span><span><i class="health-dot disabled"></i> Stillgelegt</span></div>
      <div class="health-site-list">${siteRows.map(g=>`<button class="health-site-row" data-site-health="${esc(g.siteId)}" data-tenant-health="${esc(g.tenantId)}">
        <span class="health-site-identity"><strong>${esc(g.name)}</strong><small>${state.role==='super'?esc(g.customer)+' · ':''}${g.points.length} Ladepunkte</small></span>
        <span class="health-site-badges">${g.offline?`<span class="health-pill red">${g.offline} offline</span>`:''}${g.warnings?`<span class="health-pill orange">${g.warnings} Störung${g.warnings===1?'':'en'}</span>`:''}${g.disabled?`<span class="health-pill grey">${g.disabled} stillgelegt</span>`:''}${!g.offline&&!g.warnings&&!g.disabled?'<span class="health-pill green">Alles OK</span>':''}</span>
        <span class="health-link">Details ansehen ›</span>
      </button>`).join('')||'<div class="health-empty">Noch keine Ladepunkte erfasst.</div>'}</div>
      <p class="inline-help">Statuswerte sind in der Demo simuliert – erst mit echter OCPP-Anbindung sind sie live.</p>
    </section>
    <div class="layout-2"><section class="panel"><div class="panel-head"><div><h2>Ladeenergie im Zeitverlauf</h2><div class="panel-caption">Ausgewählter Kunde · kWh</div></div><span class="legend"><span class="legend-dot"></span>Geladene Energie</span></div>
      <div class="bars">${dayValues.map(d=>`<div class="bar-col"><span class="bar-value" style="--bottom:${Math.round(d.kwh/max*148)}px">${d.kwh?num(d.kwh):''}</span><div class="bar-track"><div class="bar-fill" title="${d.day}. November: ${num(d.kwh)} kWh" style="height:${Math.max(1,Math.round(d.kwh/max*100))}%"></div></div><span>${d.day}.11.</span></div>`).join('')}</div><p class="inline-help">Musterdaten, keine echte Messung.</p>
    </section><section class="panel"><div class="panel-head"><div><h2>Verbrauch je Ladepunkt</h2><div class="panel-caption">Top-Ladepunkte im gewählten Monat</div></div></div>
      ${tops.map(x=>`<div class="progress-line"><strong>${esc(x.name)}</strong><span>${num(x.kwh)} kWh</span></div><div class="progress"><div style="width:${Math.round(x.kwh/topMax*100)}%"></div></div>`).join('')||'<p class="empty">Keine Ladepunkte vorhanden.</p>'}
      <div class="panel-top-gap"><div class="panel-head"><h2>Verfügbarkeit</h2></div><div class="status-row"><span class="status-note">Online / lädt (Demo)</span><span class="status-num">${fleet.length-offline-disabled-warning} von ${fleet.length}</span></div><div class="progress"><div style="width:${fleet.length?(fleet.length-offline-disabled-warning)/fleet.length*100:0}%"></div></div></div>
    </section></div>
    <section class="panel panel-top-gap"><div class="panel-head"><div><h2>Letzte Ladevorgänge</h2><div class="panel-caption">Aktueller Monat · ausgewählter Kunde</div></div><button class="btn ghost small" data-page="sessions">Ladevorgänge filtern ›</button></div>${sessionTable(sessions.slice(0,5))}</section>`;
}
function sitesPage(){
  const assigned=myChargers();
  const sites=availableSites().filter(site=>state.role!=='user'||assigned.some(c=>chargerSite(c)===site.id));
  const filter=state.query.trim().toLowerCase();
  const visible=sites.filter(site=>(site.name+' '+site.address+' '+assigned.filter(c=>chargerSite(c)===site.id)
    .map(c=>c.location+' '+(getStation(c)?.name||'')).join(' ')).toLowerCase().includes(filter));
  const actions=state.role==='user'?'':'<button id="newSiteBtn" class="btn ghost">+ Standort</button><button id="newChargerBtn" class="btn">+ Ladestation</button>';
  const sections=visible.map(site=>{
    const list=assigned.filter(c=>chargerSite(c)===site.id);
    const groups=[];
    list.forEach(c=>{let g=groups.find(x=>x.key===stationKey(c));if(!g){g={key:stationKey(c),station:getStation(c),points:[]};groups.push(g)}g.points.push(c);});
    const open=state.siteOpen===site.id||!!filter;
    const ready=list.filter(c=>!c.disabled&&c.status!=='Offline').length;
    const stationMarkup=groups.map(group=>{
      const st=group.station;
      const multi=st?.type==='multi'||group.points.length>1;
      const points=group.points.map(c=>{
        const conn=mapInfo(c),persons=peopleForCharger(c.id),expanded=state.expanded===c.id;
        const personInput=state.role==='user'?`<span class="point-people">${esc(persons.map(p=>p.name).join(', ')||'Nicht zugewiesen')}</span>`
          :`<select class="assign-user" aria-label="Nutzer für ${esc(c.location)} zuweisen" data-assign="${esc(c.id)}">
            <option value="">Nicht zugewiesen</option>
            ${availablePeople().filter(p=>p.role!=='admin').map(p=>`<option value="${esc(p.id)}" ${persons.some(x=>x.id===p.id)?'selected':''}>${esc(p.name)}</option>`).join('')}
          </select>`;
        const status=pointStatus(c);
        const fw=c.firmware||st?.firmware||'Noch nicht gemeldet';
        const endpoint=c.ocppUrl||st?.ocppUrl||'Nicht hinterlegt';
        const model=c.model||st?.model||'Nicht hinterlegt';
        const vendor=c.vendor||st?.vendor||'Nicht hinterlegt';
        const actions=state.role==='user'?'':`<div class="point-actions">
          ${state.role==='super'?`<button class="btn small" data-edit-point="${esc(c.id)}">Bearbeiten</button>`:''}
          <button class="btn ghost small" data-toggle-point="${esc(c.id)}">${c.disabled?'Wieder aktivieren':'Stilllegen'}</button>
          ${state.role==='super'?`<button class="btn danger small" data-archive-point="${esc(c.id)}">Entfernen</button>`:''}
        </div>`;
        return `<div class="point-group ${c.disabled?'point-disabled':''}"><div class="point-row">
          <div class="point-name">${luminaPreview(c,true)}<span><strong>${esc(c.location)}</strong><small>${esc(c.power)} kW · ${esc(c.id)}</small></span></div>
          <div class="point-current">${statusIcon(status)} <span>${esc(status)}</span></div>
          <div class="point-connect"><strong>${esc(conn.cp)}</strong><small>Connector #${esc(conn.connector)}</small></div>
          <div>${personInput}</div>
          <button class="detail-button" data-expand="${esc(c.id)}" aria-expanded="${expanded}">${expanded?'Weniger':'Details'} <span>${expanded?'⌃':'⌄'}</span></button>
        </div>${expanded?`<div class="point-detail-panel">
          <div class="point-detail-grid">
            <div><small>Ladepunkt</small><strong>${esc(c.location)}</strong></div>
            <div><small>Ladestation / Master</small><strong>${esc(st?.name||c.location)}</strong></div>
            <div><small>Seriennummer</small><strong>${esc(c.serial||st?.serial||'Nicht hinterlegt')}</strong></div>
            <div><small>Hersteller</small><strong>${esc(vendor)}</strong></div>
            <div><small>Modell</small><strong>${esc(model)}</strong></div>
            <div><small>Firmwarestand (Demo / manuell)</small><strong>${esc(fw)}</strong></div>
            <div><small>OCPP-ID</small><strong>${esc(conn.cp)}</strong></div>
            <div><small>Connector</small><strong>#${esc(conn.connector)}</strong></div>
            <div class="point-wide"><small>OCPP-Serveradresse (manuell hinterlegt)</small><strong>${esc(endpoint)}</strong></div>
          </div>
          <p class="inline-help">Dies sind Konfigurations-/Demodaten, keine Live-Geräteabfrage. Firmwarestand und Serveradresse sind erst nach tatsächlicher Anbindung verlässlich.</p>
          ${actions}
        </div>`:''}</div>`;
      }).join('');
      return `<div class="station-group">${points}</div>`;
    }).join('')||'<div class="point-empty">Noch keine Ladestation angelegt.</div>';
    return `<section class="site-section"><button class="site-head" data-open-site="${esc(site.id)}" aria-expanded="${open}">
      <span class="site-visual">▦</span><span class="site-name"><strong>${esc(site.name)}</strong><small>${esc(site.address)}</small></span>
      <span class="site-numbers">${list.length} Ladepunkte<small>${groups.length} Ladestationen · ${ready} verfügbar/laden (Demo)</small></span><span class="site-arrow">${open?'⌃':'⌄'}</span>
    </button>${open?`<div class="site-details"><div class="points-header"><span>Ladepunkt</span><span>Status</span><span>OCPP-Anbindung</span><span>Nutzer</span><span></span></div>${stationMarkup}</div>`:''}</section>`;
  }).join('')||'<div class="panel empty">Keine Standorte gefunden.</div>';
  return head(state.role==='user'?'Meine Ladepunkte':'Standorte & Ladepunkte',
    state.role==='user'?'Nur deine zugewiesenen Ladepunkte.':'Einzelwallbox oder Master/Slave-Anlage: Ladepunkte einzeln benennen und zuweisen.',actions)
    +`<div class="toolbar"><input class="search" id="searchInput" aria-label="Standorte suchen" placeholder="Standort oder Ladepunkt suchen …" value="${esc(state.query)}"><span class="micro">${assigned.length} Ladepunkte · ${sites.length} Standorte</span></div>`
    +sections+'<p class="inline-help">OCPP ist noch nicht verbunden. Eine Master/Slave-Anlage kann je nach Hersteller eine gemeinsame oder mehrere OCPP-IDs haben.</p>';
}
  function chargerCards() {
    const list=myChargers().filter(c=>(c.id+' '+c.location+' '+c.serial).toLowerCase().includes(state.query.toLowerCase()));
    return `${head(state.role==='user'?'Meine Ladepunkte':'Ladepunkte verwalten',`${esc(tenant().name)} · ${esc(tenant().site)}`,state.role!=='user'?'<button class="btn" id="newChargerBtn">+ Ladepunkt hinzufügen</button>':'')}
    <div class="toolbar"><input class="search" id="searchInput" aria-label="Ladepunkte suchen" placeholder="⌕  Ladepunkt suchen ..." value="${esc(state.query)}"><span class="micro">${list.length} von ${myChargers().length} Ladepunkten</span></div>
    <div class="list-chargers">${list.map(c=>{const m=mapInfo(c);const owners=peopleForCharger(c.id).map(x=>x.name).join(', ')||'Nicht zugewiesen';return `<article class="charger-card"><div class="charger-head">${luminaPreview(c,true)}${badge(c.status)}</div><div class="charger-title">${esc(c.location)}</div><div class="charger-meta">${esc(c.power)} kW · ${esc(c.serial)}<br>OCPP-ID: ${esc(m.cp)} · Connector ${m.connector}</div><div class="charger-foot"><span>Zugeteilt: <strong>${esc(owners)}</strong></span><span class="pill">${esc(c.id)}</span></div></article>`;}).join('')}</div>${!list.length?'<div class="panel empty"><h3>Keine Ladepunkte gefunden</h3><p>Bitte Suche prüfen.</p></div>':''}`;
  }
  const sessionStatus = s => s.status||'Abgeschlossen';
  function filteredSessions(){
    const f=state.sessionFilters;
    return mySessions().filter(s=>{
      const c=db.chargers.find(x=>x.id===s.chargerId);
      const site=c?chargerSite(c):'';
      return (!f.from||s.date>=f.from)
        &&(!f.to||s.date<=f.to)
        &&(!f.user||s.personId===f.user)
        &&(!f.site||site===f.site)
        &&(!f.point||s.chargerId===f.point)
        &&(!f.status||sessionStatus(s)===f.status)
        &&(!state.query||(personName(s.personId)+' '+chargerName(s.chargerId)+' '+(db.sites.find(x=>x.id===site)?.name||'')+' '+s.date).toLowerCase().includes(state.query.toLowerCase()));
    }).sort((a,b)=>b.date.localeCompare(a.date));
  }
  function exportData(){
    const f=state.sessionFilters;
    return {company:tenant().name,from:f.from,to:f.to,
      rows:filteredSessions().map(s=>{
        const c=db.chargers.find(x=>x.id===s.chargerId);
        const site=db.sites.find(x=>x.id===chargerSite(c||{tenant:s.tenant}));
        return {date:s.date,user:personName(s.personId),site:site?.name||'Standort',
          point:chargerName(s.chargerId),kwh:Number(s.kwh)||0,duration:s.duration,status:sessionStatus(s),
          rfid:s.rfid||s.authType||'',rate:sessionRate(s),amount:sessionCost(s),
        station:getStation(c||{})?.name||chargerName(s.chargerId),
        connector:c?mapInfo(c).connector:'',sessionId:s.sessionId||'',
        start:s.startedAt||s.date,end:s.endedAt||'',stopReason:s.stopReason||'',
        meterStart:s.meterStart??'',meterStop:s.meterStop??''};
      })};
  }
  const personName=id=>db.people.find(x=>x.id===id)?.name||'Unbekannt';
  const chargerName=id=>db.chargers.find(x=>x.id===id)?.location||id;
  function sessionTable(s){
  return `<div class="table-wrap"><table class="data-table session-table">
    <thead><tr><th>Datum</th><th>Standort</th><th>Ladepunkt</th><th>${state.role==='user'?'Zugang':'Nutzer'}</th><th>Energie</th><th>Tarif</th><th>Betrag</th><th>Dauer</th><th>Status</th></tr></thead>
    <tbody>${s.map(x=>{
      const c=db.chargers.find(cp=>cp.id===x.chargerId),site=db.sites.find(z=>z.id===chargerSite(c||{tenant:x.tenant}));
      const status=sessionStatus(x),kind=status==='Abgeschlossen'?'success':/Fehler|Abgebrochen|Fault/i.test(status)?'blocked':'pending';
      return `<tr><td><strong>${esc(x.date.split('-').reverse().join('.'))}</strong></td>
        <td>${esc(site?.name||'–')}</td><td>${esc(chargerName(x.chargerId))}</td><td>${esc(personName(x.personId))}</td>
        <td><strong>${num(x.kwh)} kWh</strong></td>
        <td>${esc(rateText(sessionRate(x)))}</td><td><strong>${esc(euro(sessionCost(x)))}</strong></td><td>${esc(x.duration)}</td>
        <td><span class="chip ${kind}">${esc(status)}</span></td></tr>`;
    }).join('')||'<tr><td colspan="9" class="empty">Keine Ladevorgänge für diese Filter.</td></tr>'}</tbody></table></div>`;
}
  function sessions(){
  const f=state.sessionFilters,arr=filteredSessions(),userOnly=state.role==='user';
  const people=userOnly?availablePeople().filter(x=>x.id===user()?.id):availablePeople();
  const opts=(values,current)=>values.map(([v,label])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(label)}</option>`).join('');
  const siteOptions=[['','Alle Standorte'],...availableSites().map(x=>[x.id,x.name])];
  const pointOptions=[['','Alle Ladepunkte'],...myChargers().map(x=>[x.id,x.location])];
  const statuses=[['','Alle Status'],['Abgeschlossen','Abgeschlossen'],['Aktiv','Aktiv'],['Abgebrochen','Abgebrochen'],['Fehler','Fehler']];
  const reportControls='<button id="exportCsvBtn" class="btn ghost">CSV</button><button id="exportExcelBtn" class="btn ghost">Excel .xlsx</button><button id="exportPdfBtn" class="btn">PDF-Bericht</button>';
  return `${head(userOnly?'Meine Ladevorgänge':'Ladevorgänge & Berichte',
    userOnly?'Dein Verbrauch, deine Ladehistorie und persönliche Exporte.':'Wähle Zeitraum, Nutzer und Ladepunkt – der Export übernimmt genau deine Auswahl.',
    reportControls)}
    <section class="panel filter-panel">
      <div class="panel-head"><div><h2>Ladevorgänge filtern</h2><div class="panel-caption">Die Auswertung und alle Exporte verwenden dieselben Filter.</div></div><button type="button" id="resetSessionsBtn" class="btn ghost small">Filter zurücksetzen</button></div>
      <div class="session-filters">
        <label>Zeitraum<select id="filterPreset">${opts([['nov','November 2026 (Demo)'],['oct','Oktober 2026 (Demo)'],['last7','Letzte 7 Tage'],['all','Gesamter Zeitraum'],['custom','Eigener Zeitraum']],f.preset)}</select></label>
        <label>Von<input type="date" id="filterFrom" value="${esc(f.from)}"></label>
        <label>Bis<input type="date" id="filterTo" value="${esc(f.to)}"></label>
        ${userOnly?'':`<label>Nutzer<select id="filterUser">${opts([['','Alle Nutzer'],...people.map(p=>[p.id,p.name])],f.user)}</select></label>`}
        <label>Standort<select id="filterSite">${opts(siteOptions,f.site)}</select></label>
        <label>Ladepunkt<select id="filterPoint">${opts(pointOptions,f.point)}</select></label>
        <label>Status<select id="filterStatus">${opts(statuses,f.status)}</select></label>
        <label class="session-search-label">Suche<input class="search" id="searchInput" placeholder="Name, Standort, Ladepunkt…" value="${esc(state.query)}"></label>
      </div>
      <div class="filter-note">Demo-Musterdaten aus Oktober/November 2026. Kein Live-OCPP-Abgleich und keine abrechnungsfähigen Messdaten.</div>
    </section>
    <div class="metrics session-metrics">
      <div class="metric"><div class="metric-top"><span class="metric-label">Energie im Zeitraum</span><span class="metric-icon energy">${boltIcon('metric-bolt')}</span></div><div class="metric-value">${num(total(arr))} kWh</div><div class="metric-foot">Entsprechend deiner aktuellen Filter</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">Ladevorgänge</span><span class="metric-icon">▤</span></div><div class="metric-value">${arr.length}</div><div class="metric-foot">In der aktuellen Auswahl</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">Berechneter Betrag</span><span class="metric-icon">€</span></div><div class="metric-value">${esc(euro(arr.reduce((sum,row)=>sum+sessionCost(row),0)))}</div><div class="metric-foot">Demo-Berechnung · keine Rechnung</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">Beteiligte Nutzer</span><span class="metric-icon">♙</span></div><div class="metric-value">${new Set(arr.map(x=>x.personId)).size}</div><div class="metric-foot">Mit Ladevorgängen im Zeitraum</div></div>
    </div>
    <section class="panel"><div class="panel-head"><div><h2>Gefilterte Ladevorgänge</h2><div class="panel-caption">${arr.length} Einträge · ${num(total(arr))} kWh</div></div><span class="table-hint">Export: CSV · XLSX · PDF</span></div>${sessionTable(arr)}</section>`;
}
  function people(){
    const allowed=state.role!=='user';
    if(!allowed)return head('Kein Zugriff','RFID-Karten können nur durch Administratoren verwaltet werden.');
    const shown=availablePeople().filter(x=>(x.name+' '+x.email).toLowerCase().includes(state.query.toLowerCase()));
    const cards=availableTags();
    const tagSummary=cards.filter(t=>t.state==='active').length+' aktiv · '+cards.filter(t=>t.state==='blocked').length+' gesperrt';
    const personOptions=(selectedId)=>`<option value="">Nicht zugewiesen</option>${availablePeople().filter(p=>p.role!=='admin').map(p=>`<option value="${esc(p.id)}" ${p.id===selectedId?'selected':''}>${esc(p.name)}</option>`).join('')}`;
    return `${head('Nutzer & RFID','Nutzer einladen, Ladepunkte freigeben und RFID-Karten zuordnen.',
      '<button class="btn ghost" id="addRfidBtn">+ RFID-Karte</button><button class="btn" id="inviteBtn">+ Nutzer einladen</button>')}
    <div class="notice"><span class="notice-icon">ⓘ</span><div><strong>Demo:</strong> RFID-Karten und Zuweisungen werden nur in diesem Browser gespeichert.
    Es werden noch keine Karten an echte Wallboxen übertragen oder Ladevorgänge autorisiert.</div></div>
    <section class="panel">
      <div class="panel-head"><div><h2>Nutzer</h2><div class="panel-caption">Wer darf welche Ladepunkte und RFID-Karten benutzen?</div></div></div>
      <div class="toolbar"><input class="search" id="searchInput" placeholder="Name oder E-Mail suchen …" value="${esc(state.query)}"><span class="micro">${shown.length} Nutzer</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nutzer</th><th>E-Mail</th><th>Ladepunkte</th><th>RFID-Karten</th><th>Preis / kWh</th><th>Zugang</th><th>Aktion</th></tr></thead><tbody>
      ${shown.map(p=>{
        const mine=cards.filter(t=>t.personId===p.id);
        return `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.email)}</td>
          <td>${p.chargerIds.map(cid=>`<span class="chip">${esc(chargerName(cid))}</span>`).join(' ')||'<span class="td-muted">Keine</span>'}</td>
          <td>${mine.length?mine.map(t=>`<span class="chip ${t.state==='active'?'success':'blocked'}" title="${esc(t.name||'RFID-Karte')}">${esc(t.uid)}</span>`).join(' '):'<span class="td-muted">Keine</span>'}</td>
          <td><strong class="price-rate">${esc(rateText(rateForPerson(p.id)))}</strong><small class="rate-source">${p.rateOverride===undefined||p.rateOverride===null?'Standardtarif':'Individueller Tarif'}</small></td>
          <td><span class="chip ${p.state==='aktiv'?'success':'pending'}">${p.state==='aktiv'?'Aktiv':'Eingeladen'}</span></td>
          <td><div class="rfid-actions"><button class="btn ghost small" data-price-person="${esc(p.id)}">Preis ändern</button><button class="btn ghost small" data-rfid-person="${esc(p.id)}">+ RFID</button>${p.state==='eingeladen'?`<button class="btn ghost small" data-resend="${esc(p.id)}">Einladung erneut</button>`:''}</div></td></tr>`;
      }).join('')}</tbody></table></div>
    </section>
    <section class="panel panel-top-gap">
      <div class="panel-head"><div><h2>RFID-Karten</h2><div class="panel-caption">${cards.length} Karten · ${tagSummary}</div></div><button id="addRfidBtnSection" class="btn ghost small">+ Karte hinzufügen</button></div>
      ${cards.length?`<div class="table-wrap"><table class="data-table rfid-table">
        <thead><tr><th>Karten-ID / UID</th><th>Bezeichnung</th><th>Zugewiesener Nutzer</th><th>Status</th><th>Aktion</th></tr></thead><tbody>
        ${cards.map(t=>`<tr>
          <td><strong class="rfid-uid">${esc(t.uid)}</strong></td><td>${esc(t.name||'RFID-Karte')}</td>
          <td><select class="rfid-owner" data-rfid-owner="${esc(t.id)}" aria-label="Nutzer für ${esc(t.uid)} zuweisen">${personOptions(t.personId)}</select></td>
          <td><span class="chip ${t.state==='active'?'success':'blocked'}">${t.state==='active'?'Aktiv':'Gesperrt'}</span></td>
          <td><button class="btn ghost small" data-rfid-toggle="${esc(t.id)}">${t.state==='active'?'Sperren':'Entsperren'}</button></td>
        </tr>`).join('')}</tbody></table></div>`
      :'<div class="rfid-empty">Noch keine RFID-Karten angelegt. Über „+ RFID-Karte“ kannst du eine Karte erfassen und direkt einem Nutzer zuweisen.</div>'}
    </section>
    <p class="inline-help">Die RFID-Zuordnung allein erteilt später noch keinen unbegrenzten Zugriff: Welche Ladepunkte ein Nutzer verwenden darf, wird separat geprüft.</p>`;
  }
function settings(){
  const st=db.stations.filter(x=>x.tenant===state.tenant);
  const t=tenant();
  return head('Kundendaten & OCPP','Kontaktdaten und technische Zuordnung verwalten.')
    +`<section class="panel"><div class="panel-head"><div><h2>Kundenstammdaten</h2><div class="panel-caption">Kontaktdaten für ${esc(t.name)}</div></div>${state.role!=='user'?'<button class="btn ghost small" id="editTenantBtn">Bearbeiten</button>':''}</div>
      <div class="customer-data-grid">
        <div><small>Firma / WEG</small><strong>${esc(t.name)}</strong></div>
        <div><small>Ansprechpartner</small><strong>${esc(t.contactName||'Nicht hinterlegt')}</strong></div>
        <div><small>E-Mail-Adresse</small><strong>${esc(t.email||'Nicht hinterlegt')}</strong></div>
        <div><small>Telefonnummer</small><strong>${esc(t.phone||'Nicht hinterlegt')}</strong></div>
        <div><small>Standardpreis / kWh</small><strong>${esc(rateText(t.defaultRate??0.55))}</strong></div>
      </div></section>
    <div class="role-banner">Gerätedaten und OCPP-Verbindungen sind bisher nur simuliert. Änderungen steuern keine echte Hardware.</div>
    <section class="panel"><div class="panel-head"><div><h2>Einzelwallbox oder Master/Slave</h2></div></div>
    <p>Im Menü „Standorte & Ladepunkte“ legst du Einzelwallboxen oder Master/Slave-Anlagen an und bearbeitest die einzelnen Ladepunkte unter „Details“.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Ladestation</th><th>OCPP-Modell</th><th>Ladepunkte</th></tr></thead><tbody>
      ${st.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.topology==='separate'?'Getrennte OCPP-IDs':'Gemeinsame OCPP-ID'}</td><td>${db.chargers.filter(c=>c.stationId===x.id&&!c.archived).length}</td></tr>`).join('')||'<tr><td colspan="3">Noch keine neuen Ladestationen angelegt.</td></tr>'}
    </tbody></table></div></section>`;
}
  function render() {
    renderNav();
    $('roleSelect').value=state.role;
    $('crumb').textContent={overview:'Übersicht',chargers:'Ladepunkte',sessions:'Ladevorgänge',people:'Nutzer & RFID',settings:'Einstellungen'}[state.page];
    $('avatar').textContent=state.role==='super'?'WA':state.role==='admin'?'AD':'NU';
    $('content').innerHTML=({overview:dashboard,sites:sitesPage,chargers:chargerCards,sessions,people,settings})[state.page]();
  }
function openStationModal(){
  const options=availableSites().map(x=>`<option value="${esc(x.id)}" ${state.siteOpen===x.id?'selected':''}>${esc(x.name)}</option>`).join('');
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal station-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <h2 id="modalTitle">Ladestation anlegen</h2>
    <p>Eine einzelne Wallbox oder ein Master/Slave-Verbund mit mehreren Ladepunkten.</p>
    <form id="stationForm">
      <div class="field"><label for="stationSite">Standort</label><select id="stationSite">${options}</select></div>
      <div class="field"><label for="stationName">Name der Ladestation</label><input required maxlength="80" id="stationName" placeholder="z. B. Tiefgarage Master 01"></div>
      <div class="field"><label for="stationType">Art der Ladestation</label><select id="stationType">
        <option value="single">Einzelwallbox (1 Ladepunkt)</option>
        <option value="multi">Master/Slave / Mehrfachlader</option>
      </select></div>
      <div id="stationCountPanel" class="station-count-panel" hidden>
        <div class="field"><label for="stationCount">Anzahl Ladepunkte</label><input id="stationCount" type="number" min="2" max="64" value="6" step="1" disabled></div>
        <div class="field"><label for="stationTopology">OCPP-Verbindung</label><select id="stationTopology" disabled>
          <option value="shared">Eine OCPP-ID für alle Ladepunkte (Connector 1–n)</option>
          <option value="separate">Eigene OCPP-ID je Ladepunkt (Master und Slaves getrennt)</option>
        </select></div>
        <p class="inline-help">Das ist eine Vorlage. Ob der Hersteller eine oder mehrere OCPP-Verbindungen verwendet, klären wir später anhand der echten Wallbox.</p>
      </div>
      <div class="field"><label for="stationSerial">Seriennummer / Anlagenkennung (optional)</label><input id="stationSerial" maxlength="80" placeholder="z. B. MASTER-001"></div>
      <div class="field" id="stationOcppField"><label for="stationOcpp">OCPP-ID (optional)</label><input id="stationOcpp" maxlength="90" placeholder="Kann später ergänzt werden"></div>
      <div class="field"><label for="stationPower">Leistung je Ladepunkt</label><select id="stationPower">
        <option value="11">11 kW</option><option value="22">22 kW</option>
      </select></div>
      <div class="station-point-list"><h3>Ladepunkte individuell benennen</h3><div id="stationPointFields"></div></div>
      <div class="modal-actions"><button type="button" class="btn ghost" id="cancelStation">Abbrechen</button>
        <button type="submit" class="btn">Ladestation anlegen</button></div>
    </form></section></div>`;
  const countEl=$('stationCount'),modeEl=$('stationType'),topologyEl=$('stationTopology');
  const redraw=()=>{
    const multi=modeEl.value==='multi';
    $('stationCountPanel').hidden=!multi;
    countEl.disabled=!multi;topologyEl.disabled=!multi;
    const n=multi?Math.max(2,Math.min(64,Number(countEl.value)||2)):1;
    const names=Array.from({length:64},(_,i)=>$('stationPoint'+i)?.value);
    const identities=Array.from({length:64},(_,i)=>$('stationPointOcpp'+i)?.value);
    const assignees=Array.from({length:64},(_,i)=>$('stationAssign'+i)?.value);
    const separate=multi&&topologyEl.value==='separate';
    $('stationOcppField').hidden=separate;
    $('stationPointFields').innerHTML=Array.from({length:n},(_,i)=>`
      <div class="station-point-input"><span class="point-index">#${i+1}</span>
        <div class="field"><label for="stationPoint${i}">Name Ladepunkt ${i+1}</label>
          <input id="stationPoint${i}" required maxlength="80" value="${esc(names[i]||'Stellplatz '+(i+1))}" placeholder="z. B. Stellplatz ${i+1}"></div>
        ${separate?`<div class="field"><label for="stationPointOcpp${i}">OCPP-ID (optional)</label>
          <input id="stationPointOcpp${i}" maxlength="90" value="${esc(identities[i]||'')}" placeholder="OCPP-ID des Slaves"></div>`:''}
        <div class="field"><label for="stationAssign${i}">Nutzer (optional)</label><select id="stationAssign${i}">
          <option value="">Später zuweisen</option>
          ${availablePeople().filter(p=>p.role!=='admin').map(p=>`<option value="${esc(p.id)}" ${assignees[i]===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select></div>
      </div>`).join('');
  };
  modeEl.addEventListener('change',redraw);
  topologyEl.addEventListener('change',redraw);
  countEl.addEventListener('input',redraw);
  redraw();
  $('stationForm').addEventListener('submit',event=>{
    event.preventDefault();
    const name=$('stationName').value.trim(),siteId=$('stationSite').value,serial=$('stationSerial').value.trim();
    const multi=modeEl.value==='multi',count=multi?Number(countEl.value):1,topology=multi?topologyEl.value:'shared';
    const ocppId=$('stationOcpp').value.trim();
    if(!name||!availableSites().some(site=>site.id===siteId))return;
    if(!Number.isInteger(count)||count<1||count>64){toast('Anzahl Ladepunkte muss zwischen 1 und 64 liegen.');return;}
    const labels=Array.from({length:count},(_,i)=>$('stationPoint'+i)?.value.trim());
    if(labels.some(x=>!x)){toast('Bitte alle Ladepunkte benennen.');return;}
    if(new Set(labels.map(x=>x.toLocaleLowerCase('de-DE'))).size!==labels.length){toast('Ladepunktnamen innerhalb der Anlage müssen eindeutig sein.');return;}
    if(serial&&db.stations.some(st=>st.serial===serial)){toast('Diese Seriennummer wurde bereits eingetragen.');return;}
    const ids=topology==='separate'?Array.from({length:count},(_,i)=>$('stationPointOcpp'+i)?.value.trim()||''):[ocppId];
    const realIds=ids.filter(Boolean);
    if(new Set(realIds).size!==realIds.length){toast('Die OCPP-IDs dürfen nicht doppelt vorkommen.');return;}
    const key='station-'+Date.now()+'-'+Math.floor(Math.random()*1000000);
    db.stations.push({id:key,tenant:state.tenant,siteId,name,serial,ocppId:topology==='shared'?ocppId:'',topology,type:multi?'multi':'single'});
    const power=Number($('stationPower').value);
    for(let i=0;i<count;i++){
      const id=key+'-P'+(i+1);
      const assignee=$('stationAssign'+i).value;
      db.chargers.push({id,tenant:state.tenant,siteId,stationId:key,location:labels[i],serial:'',
        ocppId:topology==='separate'?ids[i]:'',connectorNumber:i+1,power,status:'Offline'});
      const p=availablePeople().find(x=>x.id===assignee&&x.role!=='admin');
      if(p&&!p.chargerIds.includes(id))p.chargerIds.push(id);
    }
    save();state.siteOpen=siteId;state.expanded='';state.query='';state.page='sites';
    $('modalHost').innerHTML='';render();
    toast(count+' Ladepunkt'+(count===1?'':'e')+' unter „'+name+'“ angelegt (Demo).');
  });
  $('cancelStation').addEventListener('click',()=>{$('modalHost').innerHTML='';});
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')$('modalHost').innerHTML='';});
  $('stationName').focus();
}
  function openRfidModal(personId=''){
  if(state.role==='user')return;
  const people=availablePeople().filter(p=>p.role!=='admin');
  const selected=people.some(p=>p.id===personId)?personId:'';
  const stationChoices=[];
  myChargers().forEach(c=>{
    const info=mapInfo(c);
    const station=getStation(c);
    const key=info.cp==='OCPP-ID offen' ? (station?.id||c.id) : info.cp;
    if(!stationChoices.some(x=>x.key===key))stationChoices.push({
      key,label:(station?.name||c.location)+' · '+info.cp,
      station:station?.name||c.location,ocpp:info.cp
    });
  });
  let scanActive=false;
  let scanned=null;
  let scanTimeout=null;
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal rfid-enroll-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <h2 id="modalTitle">RFID-Karte hinzufügen</h2>
    <p>RFID-Kennung selbst eingeben oder über das Kartenlesegerät einer Wallbox erfassen.</p>
    <form id="rfidForm">
      <div class="rfid-mode-tabs" role="group" aria-label="Methode der RFID-Erfassung">
        <button type="button" class="rfid-mode active" id="rfidManualMode" aria-pressed="true">Karten-ID eingeben</button>
        <button type="button" class="rfid-mode" id="rfidStationMode" aria-pressed="false">An Wallbox einlesen</button>
      </div>
      <div id="rfidManualPanel">
        <div class="field"><label for="rfidUid">RFID-Kennung / OCPP idTag *</label>
          <input id="rfidUid" maxlength="20" required autocomplete="off" spellcheck="false" placeholder="z. B. 04A1B2C3"></div>
        <p class="inline-help">Du kannst die Kennung von einem NFC-Lesegerät übernehmen oder manuell eintragen. Verwende genau die Kennung, die die Wallbox später sendet (OCPP 1.6: maximal 20 Zeichen).</p>
      </div>
      <div id="rfidStationPanel" hidden>
        <div class="field"><label for="rfidScanStation">Wallbox / OCPP-Station auswählen</label>
          <select id="rfidScanStation" ${stationChoices.length?'':'disabled'}>
            ${stationChoices.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}
          </select></div>
        <p class="inline-help">Später: Admin startet den Einlesemodus, hält die RFID-Karte an die ausgewählte Wallbox und bestätigt die empfangene Kennung. Ein unbekannter Tag wird dadurch nicht zum Laden berechtigt.</p>
        <div class="rfid-capture-actions">
          <button type="button" class="btn ghost small" id="rfidBeginScan" ${stationChoices.length?'':'disabled'}>Einlesemodus starten (Demo)</button>
          <button type="button" class="btn ghost small" id="rfidSimulateScan" disabled>Testscan simulieren</button>
        </div>
        <div id="rfidScanStatus" class="rfid-scan-status" role="status" aria-live="polite">Noch kein Einlesevorgang gestartet. Echte Wallbox-Daten sind derzeit nicht verbunden.</div>
        <div id="rfidScanResult" class="rfid-captured-tag" hidden>
          <strong>Kennung empfangen (simuliert)</strong>
          <code id="rfidCapturedUid"></code>
          <small>Bitte die Karte unten einem Nutzer zuweisen und speichern.</small>
        </div>
      </div>
      <div class="field"><label for="rfidLabel">Bezeichnung (optional)</label>
        <input id="rfidLabel" maxlength="80" placeholder="z. B. Schlüsselanhänger Müller"></div>
      <div class="field"><label for="rfidOwner">Zuweisen an</label>
        <select id="rfidOwner"><option value="">Noch keinen Nutzer zuweisen</option>
          ${people.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="modal-actions"><button class="btn ghost" type="button" id="cancelRfid">Abbrechen</button>
        <button class="btn" type="submit">RFID speichern</button></div>
    </form></section></div>`;
  let method='manual';
  const clearScan=()=>{
    scanActive=false;
    scanned=null;
    if(scanTimeout!==null){clearTimeout(scanTimeout);scanTimeout=null;}
    $('rfidSimulateScan').disabled=true;
    $('rfidScanResult').hidden=true;
  };
  const switchMethod=nextMethod=>{
    clearScan();
    method=nextMethod;
    const manual=method==='manual';
    $('rfidManualPanel').hidden=!manual;
    $('rfidStationPanel').hidden=manual;
    $('rfidUid').required=manual;
    $('rfidManualMode').classList.toggle('active',manual);
    $('rfidStationMode').classList.toggle('active',!manual);
    $('rfidManualMode').setAttribute('aria-pressed',String(manual));
    $('rfidStationMode').setAttribute('aria-pressed',String(!manual));
    $('rfidScanStatus').textContent='Noch kein Einlesevorgang gestartet. Echte Wallbox-Daten sind derzeit nicht verbunden.';
  };
  $('rfidManualMode').addEventListener('click',()=>switchMethod('manual'));
  $('rfidStationMode').addEventListener('click',()=>switchMethod('station'));
  $('rfidScanStation').addEventListener('change',()=>{
    clearScan();
    $('rfidScanStatus').textContent='Wallbox geändert. Starte den Einlesemodus erneut.';
  });
  $('rfidBeginScan').addEventListener('click',()=>{
    if(method!=='station'||!stationChoices.some(c=>c.key===$('rfidScanStation').value))return;
    clearScan();
    scanActive=true;
    const label=stationChoices.find(c=>c.key===$('rfidScanStation').value)?.station;
    $('rfidSimulateScan').disabled=false;
    $('rfidScanStatus').textContent='Demo-Einlesemodus aktiv für '+label+'. Testscan simulieren, um den Ablauf zu prüfen. Keine echte RFID-Erfassung.';
    // No server listener yet. Stop this UI-only enrollment window after 90 seconds.
    scanTimeout=setTimeout(()=>{
      if(!scanActive)return;
      scanActive=false;
      $('rfidSimulateScan').disabled=true;
      $('rfidScanStatus').textContent='Einlesefenster abgelaufen. Bei Bedarf erneut starten.';
    },90000);
  });
  $('rfidSimulateScan').addEventListener('click',()=>{
    if(method!=='station'||!scanActive)return;
    // Generated locally for a demonstration. This is NOT a tag read from OCPP.
    const candidate='DEMO'+Math.floor(Math.random()*0xFFFFFF).toString(16).toUpperCase().padStart(6,'0');
    scanned={uid:candidate,stationKey:$('rfidScanStation').value};
    scanActive=false;
    if(scanTimeout!==null){clearTimeout(scanTimeout);scanTimeout=null;}
    $('rfidSimulateScan').disabled=true;
    $('rfidCapturedUid').textContent=candidate;
    $('rfidScanResult').hidden=false;
    $('rfidScanStatus').textContent='Testscan empfangen. RFID-ID erst nach Bestätigung speichern.';
  });
  $('rfidForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(state.role==='user')return;
    const uid=(method==='station'?scanned?.uid:$('rfidUid').value.trim())||'';
    const name=$('rfidLabel').value.trim(),owner=$('rfidOwner').value;
    if(method==='station'&&!scanned){toast('Erst den Einlesemodus starten und einen Scan empfangen.');return;}
    if(!uid||uid.length>20){toast('Bitte eine gültige RFID-ID mit höchstens 20 Zeichen eingeben.');return;}
    if(db.tags.some(t=>t.uid.toUpperCase()===uid.toUpperCase())){toast('Diese RFID-ID ist bereits erfasst.');return;}
    if(owner&&!people.some(p=>p.id===owner)){toast('Ungültige Nutzerzuordnung.');return;}
    db.tags.push({
      id:'rfid-'+Date.now()+'-'+Math.floor(Math.random()*1000000),
      tenant:state.tenant,uid,name,personId:owner,state:'active',
      source:method==='station'?'demo-station-scan':'manual',
      stationKey:method==='station'?scanned.stationKey:null
    });
    clearScan();
    save();$('modalHost').innerHTML='';render();
    toast('RFID '+(method==='station'?'aus Testscan':'manuell')+' erfasst und '+(owner?'zugewiesen.':'noch nicht zugewiesen.')+' (Demo).');
  });
  const close=()=>{clearScan();$('modalHost').innerHTML='';};
  $('cancelRfid').addEventListener('click',close);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
  $('rfidUid').focus();
}
function openTenantEditModal(){
  if(state.role==='user')return;
  const t=tenant();
  if(!t)return;
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h2 id="modalTitle">Kundenstammdaten bearbeiten</h2>
      <p>Kontakt für ${esc(t.name)} hinterlegen. Demo: nur in diesem Browser gespeichert.</p>
      <form id="tenantEditForm">
        <div class="field"><label for="tenantEditName">Firma / WEG</label><input id="tenantEditName" maxlength="90" required value="${esc(t.name)}" ${state.role==='super'?'':'disabled'}></div>
        <div class="field"><label for="tenantEditContact">Ansprechpartner</label><input id="tenantEditContact" maxlength="90" value="${esc(t.contactName||'')}" placeholder="Vorname Nachname"></div>
        <div class="field"><label for="tenantEditEmail">E-Mail-Adresse</label><input id="tenantEditEmail" maxlength="150" type="email" value="${esc(t.email||'')}" placeholder="verwaltung@kunde.de"></div>
        <div class="field"><label for="tenantEditPhone">Telefonnummer</label><input id="tenantEditPhone" maxlength="45" type="tel" value="${esc(t.phone||'')}" placeholder="+49 ..."></div>
        <div class="field"><label for="tenantEditRate">Standardpreis pro kWh (€)</label><input id="tenantEditRate" type="number" min="0" max="10" step="0.01" required value="${Number(t.defaultRate??0.55)}"></div>
        <p class="inline-help">Demo-Beträge ändern sich bei einer Tarifänderung rückwirkend. Produktiv speichern wir den Tarif jeder Session beim Start fest.</p>
        <div class="modal-actions"><button type="button" class="btn ghost" id="cancelTenantEdit">Abbrechen</button><button type="submit" class="btn">Speichern</button></div>
      </form>
    </section></div>`;
  $('tenantEditForm').addEventListener('submit',e=>{
    e.preventDefault();
    if(state.role==='user')return;
    if(state.role==='super'){
      const name=$('tenantEditName').value.trim();
      if(!name){toast('Firmenname fehlt.');return;}
      t.name=name;
    }
    t.contactName=$('tenantEditContact').value.trim();
    t.email=$('tenantEditEmail').value.trim();
    t.phone=$('tenantEditPhone').value.trim();
    const rate=Number($('tenantEditRate').value);
    if(!validPrice(rate)){toast('Preis muss zwischen 0,00 und 10,00 € liegen.');return;}
    t.defaultRate=rate;
    save();$('modalHost').innerHTML='';render();toast('Kundenstammdaten gespeichert (Demo).');
  });
  const close=()=>{$('modalHost').innerHTML='';};
  $('cancelTenantEdit').addEventListener('click',close);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
  $('tenantEditContact').focus();
}
function openPointEditModal(id){
  if(state.role!=='super')return;
  const c=myChargers().find(p=>p.id===id);
  if(!c)return;
  const st=getStation(c), info=mapInfo(c);
  const shared=!!st&&st.topology==='shared';
  const physical=shared?st:c;
  const opts=(n)=>[11,22,43].map(k=>`<option value="${k}" ${Number(n)===k?'selected':''}>${k} kW</option>`).join('');
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal point-edit-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <h2 id="modalTitle">Ladepunkt bearbeiten</h2>
    <p>${esc(c.location)} · ${shared?'Technische Master-Daten gelten für alle Ladepunkte der Anlage.':'Technische Daten für diesen Ladepunkt.'}</p>
    <form id="pointEditForm">
      <div class="field"><label for="pointEditName">Name / Stellplatz</label><input id="pointEditName" required maxlength="80" value="${esc(c.location)}"></div>
      <div class="field"><label for="pointEditPower">Maximale Nennleistung</label><select id="pointEditPower">${opts(c.power)}</select></div>
      <div class="point-edit-section">Technische Angaben (manuell, keine Live-Abfrage)</div>
      <div class="field"><label for="pointEditStationName">${shared?'Name der Masteranlage':'Name der Ladestation'}</label><input id="pointEditStationName" maxlength="80" value="${esc(st?.name||c.location)}" ${st?'':'disabled'}></div>
      <div class="field"><label for="pointEditSerial">Seriennummer</label><input id="pointEditSerial" maxlength="80" value="${esc(physical.serial||'')}"></div>
      <div class="field"><label for="pointEditVendor">Hersteller</label><input id="pointEditVendor" maxlength="80" value="${esc(physical.vendor||'')}"></div>
      <div class="field"><label for="pointEditModel">Modell</label><input id="pointEditModel" maxlength="80" value="${esc(physical.model||'')}"></div>
      <div class="field"><label for="pointEditFirmware">Firmwarestand</label><input id="pointEditFirmware" maxlength="80" value="${esc(physical.firmware||'')}" placeholder="Noch nicht von der Wallbox gemeldet"></div>
      <div class="field"><label for="pointEditOcppId">OCPP-ID</label><input id="pointEditOcppId" maxlength="90" value="${esc(info.cp==='OCPP-ID offen'?'':info.cp)}"></div>
      <div class="field"><label for="pointEditOcppUrl">OCPP-Serveradresse</label><input id="pointEditOcppUrl" maxlength="250" value="${esc(physical.ocppUrl||'')}" placeholder="wss://..."></div>
      <p class="inline-help">Speichern ändert nur die ChargeVisor-Demodaten, nicht die Konfiguration der realen Wallbox. OCPP-IDs und Serveradresse müssen mit der Hardware abgeglichen werden.</p>
      <div class="modal-actions"><button type="button" class="btn ghost" id="pointEditCancel">Abbrechen</button><button type="submit" class="btn">Änderungen speichern</button></div>
    </form></section></div>`;
  $('pointEditForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(state.role!=='super'||c.tenant!==state.tenant||c.archived)return;
    const name=$('pointEditName').value.trim();
    const label=$('pointEditStationName').value.trim();
    if(!name){toast('Bitte einen Namen eingeben.');return;}
    if(st&&!label){toast('Bitte den Namen der Station eingeben.');return;}
    const ocppId=$('pointEditOcppId').value.trim();
    if(ocppId){
      const conflict=db.stations.some(x=>x.id!==st?.id&&x.ocppId===ocppId)
        || db.chargers.some(x=>x.id!==c.id&&x.ocppId===ocppId&&(!shared||x.stationId!==st?.id));
      if(conflict){toast('Diese OCPP-ID ist bereits einer anderen Station zugeordnet.');return;}
    }
    c.location=name;
    c.power=Number($('pointEditPower').value);
    if(st)st.name=label;
    physical.serial=$('pointEditSerial').value.trim();
    physical.vendor=$('pointEditVendor').value.trim();
    physical.model=$('pointEditModel').value.trim();
    physical.firmware=$('pointEditFirmware').value.trim();
    physical.ocppUrl=$('pointEditOcppUrl').value.trim();
    if(shared)st.ocppId=ocppId;
    else c.ocppId=ocppId;
    save();$('modalHost').innerHTML='';render();toast('Ladepunktdaten aktualisiert (Demo).');
  });
  const close=()=>{$('modalHost').innerHTML='';};
  $('pointEditCancel').addEventListener('click',close);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
  $('pointEditName').focus();
}
function openPointConfirmModal(id,action){
  if(state.role==='user')return;
  if(action==='archive'&&state.role!=='super')return;
  const c=myChargers().find(p=>p.id===id);
  if(!c)return;
  const archive=action==='archive';
  const activating=!archive&&!!c.disabled;
  const title=archive?'Ladepunkt entfernen?':activating?'Ladepunkt wieder aktivieren?':'Ladepunkt stilllegen?';
  const explain=archive?'Der Ladepunkt wird aus der Verwaltung ausgeblendet, die bestehende Ladehistorie bleibt erhalten. Entfernen kann nicht über diese Demo rückgängig gemacht werden.'
    :activating?'Der Ladepunkt wird in der Demo wieder als aktiv markiert. Für echte Wallboxen ist eine OCPP-Verbindung nötig.'
    :'Der Ladepunkt wird in ChargeVisor als stillgelegt markiert. Eine echte Wallbox wird dadurch derzeit NICHT gesperrt.';
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="confirmPointTitle">
    <h2 id="confirmPointTitle">${title}</h2><p><strong>${esc(c.location)}</strong> · ${esc(c.id)}</p><p>${explain}</p>
    <div class="modal-actions"><button type="button" class="btn ghost" id="pointConfirmCancel">Abbrechen</button>
      <button type="button" class="btn ${archive?'danger':''}" id="pointConfirmYes">${archive?'Entfernen':activating?'Aktivieren':'Stilllegen'}</button></div>
    </section></div>`;
  $('pointConfirmYes').addEventListener('click',()=>{
    if(state.role==='user'||c.tenant!==state.tenant||c.archived||(archive&&state.role!=='super'))return;
    if(archive){
      c.archived=true;c.disabled=true;
      db.people.filter(p=>p.tenant===state.tenant).forEach(p=>{p.chargerIds=p.chargerIds.filter(cid=>cid!==id);});
      toast('Ladepunkt entfernt, Historie erhalten (Demo).');
    } else {
      c.disabled=!c.disabled;
      toast(c.disabled?'Ladepunkt stillgelegt (Demo).':'Ladepunkt wieder aktiviert (Demo).');
    }
    save();$('modalHost').innerHTML='';state.expanded='';render();
  });
  const close=()=>{$('modalHost').innerHTML='';};
  $('pointConfirmCancel').addEventListener('click',close);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
}
function openPriceModal(id){
  if(state.role==='user')return;
  const person=availablePeople().find(p=>p.id===id);
  if(!person)return;
  const inherited=person.rateOverride===null||person.rateOverride===undefined;
  $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <h2 id="modalTitle">Strompreis festlegen</h2>
  <p>${esc(person.name)} · Standardtarif von ${esc(tenant().name)}: ${esc(rateText(tenant().defaultRate??0.55))}</p>
  <form id="priceForm">
    <div class="field"><label for="priceType">Tarif</label><select id="priceType">
      <option value="default" ${inherited?'selected':''}>Standardpreis des Kunden verwenden</option>
      <option value="individual" ${inherited?'':'selected'}>Individueller Preis</option>
    </select></div>
    <div class="field" id="priceValueField"><label for="priceValue">Preis pro kWh (€)</label>
      <input id="priceValue" type="number" required step="0.01" min="0" max="10" value="${person.rateOverride??tenant().defaultRate??0.55}"></div>
    <p class="inline-help">Die Preisberechnung in der Demo gilt für Musterdaten und ist keine Rechnung. Produktiv muss der zum Ladezeitpunkt geltende Tarif als Snapshot gespeichert werden.</p>
    <div class="modal-actions"><button class="btn ghost" type="button" id="cancelPrice">Abbrechen</button><button class="btn" type="submit">Preis speichern</button></div>
  </form></section></div>`;
  const update=()=>{$('priceValueField').hidden=$('priceType').value==='default';$('priceValue').disabled=$('priceType').value==='default';};
  $('priceType').addEventListener('change',update);update();
  $('priceForm').addEventListener('submit',e=>{
    e.preventDefault();
    if(state.role==='user'||person.tenant!==state.tenant)return;
    if($('priceType').value==='default')person.rateOverride=null;
    else {
      const v=Number($('priceValue').value);
      if(!validPrice(v)){toast('Gültigen kWh-Preis von 0,00 bis 10,00 € eingeben.');return;}
      person.rateOverride=v;
    }
    save();$('modalHost').innerHTML='';render();toast('Tarif für '+person.name+' gespeichert (Demo).');
  });
  const close=()=>{$('modalHost').innerHTML='';};
  $('cancelPrice').addEventListener('click',close);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')close();});
}
  function openModal(type) {
    if(type==='tenant'){
      $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">Neuen Kunden anlegen</h2><p>In einem Schritt anlegen. Du kannst Standorte und Ladepunkte anschließend ergänzen. Demo: keine echte Registrierung.</p><form id="modalForm">
      <div class="field"><label for="newTenantName">Firma oder WEG</label><input required maxlength="80" id="newTenantName" placeholder="Musterfirma GmbH"></div>
      <div class="field"><label for="newTenantSite">Erster Standort</label><input required maxlength="80" id="newTenantSite" placeholder="Hauptstandort"></div>
      <div class="field"><label for="newTenantContact">Ansprechpartner</label><input maxlength="90" id="newTenantContact" placeholder="Vorname Nachname"></div><div class="field"><label for="newTenantPhone">Telefonnummer</label><input type="tel" maxlength="45" id="newTenantPhone" placeholder="+49 ..."></div><div class="field"><label for="newTenantMail">E-Mail des Kunden-Admins</label><input required type="email" maxlength="150" id="newTenantMail" placeholder="verwaltung@beispiel.de"></div>
      <div class="modal-actions"><button class="btn ghost" type="button" id="cancelModal">Abbrechen</button><button class="btn" type="submit">Kunde anlegen</button></div></form></section></div>`;
      $('modalForm').addEventListener('submit',e=>{
        e.preventDefault();
        const name=$('newTenantName').value.trim(),site=$('newTenantSite').value.trim(),email=$('newTenantMail').value.trim();
        if(!name||!site||!email)return;
        const id='tenant-'+Date.now();
        db.tenants.push({id,name,site,defaultRate:0.55,contactName:$('newTenantContact').value.trim(),phone:$('newTenantPhone').value.trim(),email});
        db.sites.push({id:'site-'+id,tenant:id,name:site,address:'Adresse noch nicht hinterlegt'});
        db.people.push({id:'admin-'+id,tenant:id,name:'Kundenadministrator',email,chargerIds:[],state:'eingeladen',role:'admin'});
        state.tenant=id;state.person='admin-'+id;state.siteOpen='site-'+id;state.query='';
        save();$('modalHost').innerHTML='';state.page='sites';render();
        toast('Kunde und erster Standort angelegt. Einladung nur simuliert.');
      });
      $('cancelModal').addEventListener('click',()=>{$('modalHost').innerHTML='';});
      $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')$('modalHost').innerHTML='';});
      $('newTenantName').focus();return;
    }
    if(type==='site'){
      $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">Standort hinzufügen</h2><p>Neuer Standort für ${esc(tenant().name)}. Nur lokale Testdaten.</p><form id="modalForm"><div class="field"><label for="newSiteName">Standortname</label><input required maxlength="80" id="newSiteName" placeholder="Tiefgarage Gebäude B"></div><div class="field"><label for="newSiteAddress">Adresse</label><input required maxlength="120" id="newSiteAddress" placeholder="Straße, Ort"></div><div class="modal-actions"><button class="btn ghost" type="button" id="cancelModal">Abbrechen</button><button class="btn" type="submit">Standort anlegen</button></div></form></section></div>`;
      $('modalForm').addEventListener('submit',e=>{e.preventDefault();const name=$('newSiteName').value.trim(),address=$('newSiteAddress').value.trim();if(!name||!address)return;const id='site-'+Date.now();db.sites.push({id,tenant:state.tenant,name,address});state.siteOpen=id;save();$('modalHost').innerHTML='';state.query='';render();toast('Standort in der Demo angelegt.');});
      $('cancelModal').addEventListener('click',()=>{$('modalHost').innerHTML='';});
      $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')$('modalHost').innerHTML='';});
      $('newSiteName').focus();return;
    }
    const options=myChargers().map(c=>`<option value="${esc(c.id)}">${esc(c.location)} (${esc(c.id)})</option>`).join('');
    const isInvite=type==='invite';
    $('modalHost').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">${isInvite?'Nutzer einladen':'Ladepunkt hinzufügen'}</h2><p>${isInvite?'Der Nutzer erhält in der späteren Vollversion eine sichere E-Mail-Einladung.':'Lege hier einen weiteren Muster-Ladepunkt an. Keine echte OCPP-Registrierung.'}</p><form id="modalForm"><div class="field"><label for="newName">${isInvite?'Name':'Bezeichnung / Stellplatz'}</label><input required maxlength="80" id="newName" placeholder="${isInvite?'Vorname Nachname':'Stellplatz 07'}"></div>${isInvite?`<div class="field"><label for="newEmail">E-Mail-Adresse</label><input required type="email" id="newEmail" placeholder="name@unternehmen.de"></div><div class="field"><label for="newCharger">Zugriff auf Ladepunkt</label><select id="newCharger" required>${options}</select></div>`:`<div class="field"><label for="newSite">Standort</label><select id="newSite">${availableSites().map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label for="newSerial">Seriennummer</label><input required id="newSerial" maxlength="45" placeholder="CV-2026-1007"></div><div class="field"><label for="newPower">Nennleistung</label><select id="newPower"><option value="11">11 kW</option><option value="22">22 kW</option></select></div>`}<div class="modal-actions"><button type="button" id="cancelModal" class="btn ghost">Abbrechen</button><button type="submit" class="btn">${isInvite?'Einladung simulieren':'Ladepunkt anlegen'}</button></div></form></section></div>`;
    $('modalForm').addEventListener('submit', e=>{
      e.preventDefault();
      const name=$('newName').value.trim();if(!name)return;
      if(isInvite){
        const email=$('newEmail').value.trim();
        if(availablePeople().some(p=>p.email.toLowerCase()===email.toLowerCase())){toast('Diese Adresse ist bereits im Mandanten erfasst.');return;}
        db.people.push({id:'custom-'+Date.now(),tenant:state.tenant,name,email,chargerIds:[$('newCharger').value],state:'eingeladen'});
        toast('Einladung vorbereitet. Demo: Es wurde keine echte E-Mail versendet.');
      } else {
        const serial=$('newSerial').value.trim();if(db.chargers.some(c=>c.serial===serial)){toast('Seriennummer ist bereits vorhanden.');return;}
        db.chargers.push({id:`${state.tenant==='firma'?'F':'W'}-${String(db.chargers.filter(c=>c.tenant===state.tenant).length+1).padStart(2,'0')}`,tenant:state.tenant,siteId:$('newSite').value,location:name,serial,power:Number($('newPower').value),status:'Offline'});
        toast('Test-Ladepunkt angelegt. Keine Verbindung zum echten OCPP-Server.');
      }
      save();$('modalHost').innerHTML='';state.query='';render();
    });
    $('cancelModal').addEventListener('click',()=>{$('modalHost').innerHTML='';});
    $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')$('modalHost').innerHTML='';});
    $('newName').focus();
  }
  async function exportCurrent(format){
    if(!window.ChargeVisorExports){toast('Export ist momentan nicht verfügbar. Bitte neu laden.');return;}
    const data=exportData();
    try{
      if(format==='csv')window.ChargeVisorExports.exportCSV(data);
      else if(format==='xlsx')window.ChargeVisorExports.exportXLSX(data);
      else if(format==='pdf')await window.ChargeVisorExports.exportPDF(data);
      toast((format==='xlsx'?'Excel':format==='pdf'?'PDF':'CSV')+'-Bericht mit den gewählten Filtern erstellt.');
    }catch(e){console.error('Export failed',e);toast('Der Export konnte nicht erstellt werden.');}
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-page]');
    if(button){state.page=button.dataset.page;state.query='';$('sidebar').classList.remove('show');render();return;}
    if(e.target.closest('#addRfidBtn') || e.target.closest('#addRfidBtnSection')){if(state.role!=='user')openRfidModal();return;}
    const pricePerson=e.target.closest('[data-price-person]');
    if(pricePerson){if(state.role!=='user')openPriceModal(pricePerson.dataset.pricePerson);return;}
    const personRfid=e.target.closest('[data-rfid-person]');
    if(personRfid){if(state.role!=='user')openRfidModal(personRfid.dataset.rfidPerson);return;}
    const toggleRfid=e.target.closest('[data-rfid-toggle]');
    if(toggleRfid){
      if(state.role==='user')return;
      const tag=availableTags().find(t=>t.id===toggleRfid.dataset.rfidToggle);
      if(!tag)return;
      tag.state=tag.state==='active'?'blocked':'active';
      save();render();toast(tag.state==='active'?'RFID-Karte entsperrt (Demo).':'RFID-Karte gesperrt (Demo).');
      return;
    }
    const editPoint=e.target.closest('[data-edit-point]');
    if(editPoint){openPointEditModal(editPoint.dataset.editPoint);return;}
    const togglePoint=e.target.closest('[data-toggle-point]');
    if(togglePoint){openPointConfirmModal(togglePoint.dataset.togglePoint,'toggle');return;}
    const archivePoint=e.target.closest('[data-archive-point]');
    if(archivePoint){openPointConfirmModal(archivePoint.dataset.archivePoint,'archive');return;}
    if(e.target.closest('#inviteBtn'))openModal('invite');
    if(e.target.closest('#newChargerBtn'))openStationModal();
    if(e.target.closest('#newSiteBtn'))openModal('site');
    if(e.target.closest('#newTenantBtn'))openModal('tenant');
    if(e.target.closest('#editTenantBtn')){if(state.role!=='user')openTenantEditModal();return;}
    const health=e.target.closest('[data-site-health]');
    if(health){
      const requestedTenant=e.target.closest('[data-tenant-health]')?.dataset.tenantHealth||health.dataset.tenantHealth;
      if(state.role==='super'&&db.tenants.some(t=>t.id===requestedTenant)){state.tenant=requestedTenant;state.person=availablePeople()[0]?.id;}
      state.siteOpen=health.dataset.siteHealth;state.page='sites';state.query='';render();return;
    }
    const siteButton=e.target.closest('[data-open-site]');
    if(siteButton){state.siteOpen=state.siteOpen===siteButton.dataset.openSite?'':siteButton.dataset.openSite;render();return;}
    const detail=e.target.closest('[data-expand]');
    if(detail){state.expanded=state.expanded===detail.dataset.expand?'':detail.dataset.expand;render();return;}
    if(e.target.closest('#exportCsvBtn')){exportCurrent('csv');return;}
    if(e.target.closest('#exportExcelBtn')){exportCurrent('xlsx');return;}
    if(e.target.closest('#exportPdfBtn')){exportCurrent('pdf');return;}
    if(e.target.closest('#resetSessionsBtn')){
      state.sessionFilters={preset:'nov',from:'2026-11-01',to:'2026-11-30',user:'',site:'',point:'',status:''};
      state.query='';render();return;
    }
    const resend=e.target.closest('[data-resend]');if(resend)toast('Einladung erneut ausgelöst – nur Demo, kein E-Mail-Versand.');
  });
  document.addEventListener('change',e=>{
    const f=state.sessionFilters;
    const id=e.target.id;
    if(id==='filterPreset'){
      f.preset=e.target.value;
      if(f.preset==='nov'){f.from='2026-11-01';f.to='2026-11-30';}
      else if(f.preset==='oct'){f.from='2026-10-01';f.to='2026-10-31';}
      else if(f.preset==='all'){f.from='';f.to='';}
      else if(f.preset==='last7'){
        const now=new Date(),earlier=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6);
        const fmt=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        f.from=fmt(earlier);f.to=fmt(now);
      }
      render();return;
    }
    const field={filterFrom:'from',filterTo:'to',filterUser:'user',filterSite:'site',filterPoint:'point',filterStatus:'status'}[id];
    if(field){
      f[field]=e.target.value;
      if(field==='from'||field==='to')f.preset='custom';
      render();return;
    }
    const rfidOwner=e.target.closest('[data-rfid-owner]');
    if(rfidOwner){
      if(state.role==='user')return;
      const tag=availableTags().find(t=>t.id===rfidOwner.dataset.rfidOwner);
      if(!tag)return;
      const chosen=rfidOwner.value;
      if(chosen&&!availablePeople().some(p=>p.id===chosen&&p.role!=='admin'))return;
      tag.personId=chosen;save();render();
      toast(chosen?'RFID einem Nutzer zugewiesen (Demo).':'RFID-Zuweisung aufgehoben (Demo).');
      return;
    }
    const select=e.target.closest('[data-assign]');
    if(select){
      if(state.role==='user')return;
      const cid=select.dataset.assign;
      if(!myChargers().some(c=>c.id===cid))return;
      const person=availablePeople().find(p=>p.id===select.value&&p.role!=='admin');
      db.people.filter(p=>p.tenant===state.tenant).forEach(p=>{p.chargerIds=p.chargerIds.filter(id=>id!==cid);});
      if(person)person.chargerIds.push(cid);
      save();render();toast(person?'Ladepunkt an '+person.name+' zugewiesen.':'Zuweisung entfernt.');
      return;
    }
    if(e.target.id==='roleSelect'){state.role=e.target.value;state.page='overview';state.query='';render();}
    if(e.target.id==='tenantSelect'){state.tenant=e.target.value;state.person=availablePeople()[0]?.id;state.query='';render();}
    if(e.target.id==='monthSelect'){state.month=e.target.value;render();}
    if(e.target.name==='mode'){db.mode[state.tenant]=e.target.value;save();render();toast('OCPP-Anzeigemodell in der Demo aktualisiert.');}
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='searchInput'){const pos=e.target.selectionStart;state.query=e.target.value;const currentPage=state.page;render();const input=$('searchInput');if(input&&state.page===currentPage){input.focus();input.setSelectionRange(pos,pos);}}
  });
  $('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('show'));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('modalHost').innerHTML='';$('sidebar').classList.remove('show');}});
  render();
})();
