const $=id=>document.getElementById(id);
const alternatePanels=['reset-request-panel','reset-panel','invite-panel','dashboard'];
const show=(id,yes=true)=>{
  $(id).hidden=!yes;
  if(id==='login-panel'||alternatePanels.includes(id)){
    document.body.classList.toggle('login-screen',!alternatePanels.some(panel=>!$(panel).hidden));
  }
};
const info=(msg,bad=false)=>{$('feedback').textContent=msg;$('feedback').className=bad?'error':'ok';};
async function api(path,method='GET',data){
  const opt={method,credentials:'same-origin',headers:{}};
  if(data!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data);}
  const r=await fetch(path,opt);
  let payload={};try{payload=await r.json();}catch{}
  if(!r.ok)throw new Error(payload.error||'Serverfehler ('+r.status+')');
  return payload;
}
const text=(tag,value,classes)=>{
  const node=document.createElement(tag);node.textContent=String(value??'');
  if(classes)node.className=classes;return node;
};
function options(sel,items){
  sel.replaceChildren(...items.map(x=>{const opt=document.createElement('option');opt.value=x.id;opt.textContent=x.name+' · '+x.status+' · '+x.licensed_points+' Ladepunkte';return opt;}));
}
let account=null,tenants=[];
async function updateUsers(){
  if(account.role==='user')return;
  const tenantId=account.role==='superadmin' ? $('invite-tenant').value:account.tenantId;
  if(!tenantId){
    $('users-list').replaceChildren(text('li','Bitte zuerst einen Kunden wählen.'));
    $('invites-list').replaceChildren();
    return;
  }
  const query='?tenantId='+encodeURIComponent(tenantId);
  const [response,pending]=await Promise.all([
    api('/api/users'+query),
    api('/api/invitations'+query)
  ]);
  const roleName=r=>r==='admin'?'Kunden-Admin':r==='user'?'Nutzer':'Superadmin';
  $('users-list').replaceChildren(...(response.users.length
    ?response.users.map(x=>text('li',x.name+' · '+roleName(x.role)+' · '+x.email))
    :[text('li','Noch keine aktiven Nutzer.')]));
  const outstanding=pending.invitations.filter(x=>!x.accepted_at);
  $('invites-list').replaceChildren(...(outstanding.length
    ?outstanding.map(x=>{
      const expires=new Date(x.expires_at);
      const expired=expires.getTime()<=Date.now();
      const status=expired?'Abgelaufen':'Wartet auf Annahme';
      const assigned=Array.isArray(x.point_names)&&x.point_names.length
        ?' · Ladepunkte: '+x.point_names.join(', '):'';
      return text('li',x.name+' · '+roleName(x.role)+' · '+x.email+assigned+' · '+status+' (bis '+expires.toLocaleString('de-DE')+')',expired?'error':undefined);
    })
    :[text('li','Keine ausstehenden Einladungen.')]));
}

// Invited users are assigned to Walectra-provisioned physical points at invitation time.
async function updateInvitePointOptions(){
  if(!account||account.role==='user')return;
  const role=account.role==='superadmin' ? $('invite-role').value : 'user';
  const isUser=role==='user';
  show('invite-point-wrap',isUser);
  if(!isUser){
    $('invite-point-options').replaceChildren();
    return;
  }
  const tid=account.role==='superadmin' ? $('invite-tenant').value:account.tenantId;
  const host=$('invite-point-options');
  host.replaceChildren();
  if(!tid)return;
  try{
    const data=await api('/api/structure/overview?tenantId='+encodeURIComponent(tid));
    const current=account.role==='superadmin' ? $('invite-tenant').value:account.tenantId;
    const currentRole=account.role==='superadmin' ? $('invite-role').value:'user';
    if(tid!==current||currentRole!=='user')return;
    const enabled=data.points.filter(p=>p.enabled);
    if(!enabled.length){
      host.append(text('div','Noch keine Ladepunkte eingerichtet. Walectra muss zuerst die Ladeinfrastruktur konfigurieren.','invite-empty'));
      return;
    }
    const groups=new Map();
    for(const point of enabled){
      const station=data.stations.find(st=>st.id===point.station_id);
      const site=station ? data.sites.find(s=>s.id===station.site_id):null;
      const label=(site?.name||'Ohne Standort')+' · '+(station?.name||'Einzelner Ladepunkt');
      if(!groups.has(label))groups.set(label,[]);
      groups.get(label).push(point);
    }
    for(const [label,points] of groups){
      const group=document.createElement('div');
      group.className='invite-point-group';
      const title=document.createElement('strong');
      title.textContent=label;
      group.append(title);
      if(points.length>1){
        const allLabel=document.createElement('label'),all=document.createElement('input');
        all.type='checkbox';all.setAttribute('aria-label','Alle Ladepunkte der Anlage wählen: '+label);
        const allText=text('span','Gesamte Anlage auswählen');
        all.addEventListener('change',()=>{
          group.querySelectorAll('[data-invite-point]').forEach(input=>{input.checked=all.checked;});
        });
        allLabel.append(all,allText);group.append(allLabel);
      }
      for(const point of points){
        const row=document.createElement('label');
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.value=point.id;checkbox.dataset.invitePoint='';
        row.append(checkbox,text('span',point.name+' · Connector '+point.connector_number));
        group.append(row);
      }
      host.append(group);
    }
  }catch(e){
    host.replaceChildren(text('div','Ladepunkte können gerade nicht geladen werden: '+e.message,'error'));
  }
}

let structureData=null;
const structureTenant=()=>account?.role==='superadmin' ? $('license-tenant').value : account?.tenantId;
function structureOption(value,label){
  const opt=document.createElement('option');opt.value=value;opt.textContent=label;return opt;
}
function structureEl(tag,cls,content){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(content!==undefined)el.textContent=String(content);
  return el;
}
function structureLine(parent,label,value){
  const line=structureEl('div','structure-hint');
  line.textContent=label+': '+(value||'–');parent.append(line);
}
function renderPointSpecs(){
  const count=Math.max(1,Math.min(32,Number($('station-count').value)||1));
  $('station-count').value=count;
  const shared=$('station-topology').value==='shared';
  show('station-ocpp-wrap',shared);
  $('station-ocpp').required=shared;
  $('station-hint').textContent=shared
    ?'Eine OCPP-Geräte-ID für alle Connectoren (1 bis '+count+'). Die ID muss exakt mit dem Gerät übereinstimmen.'
    :'Jeder Ladepunkt braucht die eigene OCPP-ID der tatsächlichen Wallbox (jeweils Connector 1).';
  const old=[...$('point-specs').querySelectorAll('.structure-spec')].map(el=>({
    name:el.querySelector('[data-point-name]')?.value||'',
    ocpp:el.querySelector('[data-point-ocpp]')?.value||''
  }));
  $('point-specs').replaceChildren();
  for(let i=0;i<count;i++){
    const wrap=structureEl('div','structure-spec'),heading=structureEl('strong',null,'Ladepunkt '+(i+1));
    const grid=structureEl('div','structure-spec-grid');
    const nameWrap=structureEl('div');
    const nameLabel=structureEl('label',null,'Name / Stellplatz');
    const name=document.createElement('input');
    name.dataset.pointName='';name.maxLength=160;name.required=true;
    name.value=old[i]?.name||'Ladepunkt '+(i+1);
    nameWrap.append(nameLabel,name);grid.append(nameWrap);
    if(!shared){
      const idWrap=structureEl('div'),idLabel=structureEl('label',null,'OCPP-ID der Wallbox');
      const identity=document.createElement('input');
      identity.dataset.pointOcpp='';identity.maxLength=120;identity.required=true;
      identity.placeholder='Exakte OCPP-ID';identity.value=old[i]?.ocpp||'';
      idWrap.append(idLabel,identity);grid.append(idWrap);
    }else{
      const note=structureEl('div','structure-hint','Connector '+(i+1));grid.append(note);
    }
    wrap.append(heading,grid);$('point-specs').append(wrap);
  }
}
function scopedPayload(){return account.role==='superadmin'?{tenantId:structureTenant()}:{};}
async function updateStructure(){
  if(!account||account.role==='user')return;
  const tid=structureTenant();
  if(!tid){$('structure-list').replaceChildren(structureEl('div','structure-empty','Bitte zuerst einen Kunden auswählen.'));return;}
  const qs='?tenantId='+encodeURIComponent(tid);
  const [data,u]=await Promise.all([
    api('/api/structure/overview'+qs),
    api('/api/users'+qs)
  ]);
  if(tid!==structureTenant())return;
  structureData={...data,users:u.users.filter(x=>x.role==='user'&&x.enabled)};
  $('structure-customer').textContent=data.tenant.name+' · '+(data.tenant.status==='active'?'Aktiv':'Nicht freigeschaltet');
  const enabled=data.points.filter(p=>p.enabled).length;
  $('structure-count').textContent=enabled+' / '+data.tenant.licensed_points+' lizenzierte Ladepunkte';
  const siteSelect=$('station-site'),selected=siteSelect.value;
  siteSelect.replaceChildren(...data.sites.map(site=>structureOption(site.id,site.name)));
  if(data.sites.some(x=>x.id===selected))siteSelect.value=selected;
  const provisioning=account.role==='superadmin';
  show('structure-forms',provisioning);
  $('station-form').querySelector('button[type="submit"]').disabled=!provisioning||!data.sites.length||data.tenant.status!=='active';
  $('site-form').querySelector('button[type="submit"]').disabled=!provisioning||data.tenant.status!=='active';
  const host=$('structure-list');host.replaceChildren();
  if(!data.sites.length){
    host.append(structureEl('div','structure-empty',account.role==='superadmin'
      ?'Noch kein Standort vorhanden. Lege oben zuerst einen Standort an.'
      :'Walectra hat noch keinen Standort für dein Kundenkonto eingerichtet.'));
  }
  const drawPoint=(point)=>{
    const item=structureEl('div','structure-point');
    const main=structureEl('div','structure-point-main');
    main.append(structureEl('strong',null,point.name));
    if(account.role==='superadmin')structureLine(main,'OCPP-ID',point.ocpp_identity);
    structureLine(main,'Connector',point.connector_number);
    const assigned=data.access.filter(x=>x.chargepoint_id===point.id);
    structureLine(main,'Zugewiesen',assigned.length?assigned.map(x=>x.name).join(', '):'Niemand');
    main.append(structureEl('span','structure-pill'+(point.enabled?'':' off'),
      point.enabled?'Aktiviert · kein Live-Status':'Deaktiviert'));
    const actions=structureEl('div','structure-point-actions');
    const toggle=account.role==='superadmin' ?structureEl('button','secondary',point.enabled?'Deaktivieren':'Aktivieren'):null;
    if(toggle){
      toggle.type='button';
      toggle.addEventListener('click',async()=>{
        try{
          await api('/api/structure/points/'+point.id,'PATCH',{...scopedPayload(),enabled:!point.enabled});
          info('Ladepunkt geändert');await updateStructure();
        }catch(e){info(e.message,true);}
      });
      actions.append(toggle);
    }
    if(structureData.users.length){
      const selector=document.createElement('select');
      selector.setAttribute('aria-label','Nutzer zuweisen');
      selector.append(structureOption('','Nutzer auswählen …'));
      for(const u of structureData.users)selector.append(structureOption(u.id,u.name));
      const assign=structureEl('button','secondary','Zuweisen');assign.type='button';
      assign.addEventListener('click',async()=>{
        if(!selector.value){info('Bitte einen Nutzer auswählen',true);return;}
        try{
          await api('/api/points/'+point.id+'/access','PUT',{...scopedPayload(),userId:selector.value,allowed:true});
          info('Ladepunkt zugewiesen');await updateStructure();
        }catch(e){info(e.message,true);}
      });
      actions.append(selector,assign);
      for(const a of assigned){
        const remove=structureEl('button','secondary','× '+a.name);remove.type='button';
        remove.title='Zuweisung für '+a.name+' aufheben';
        remove.addEventListener('click',async()=>{
          try{
            await api('/api/points/'+point.id+'/access','PUT',{...scopedPayload(),userId:a.user_id,allowed:false});
            info('Zuweisung entfernt');await updateStructure();
          }catch(e){info(e.message,true);}
        });
        actions.append(remove);
      }
    }
    item.append(main,actions);return item;
  };
  for(const site of data.sites){
    const section=structureEl('section','structure-section');
    const head=structureEl('div','structure-site-head');
    head.append(structureEl('strong',null,site.name));
    if(site.address)head.append(structureEl('p','small',site.address));
    const siteStations=data.stations.filter(x=>x.site_id===site.id);
    const total=siteStations.reduce((n,st)=>n+data.points.filter(p=>p.station_id===st.id).length,0);
    head.append(structureEl('p','small',siteStations.length+' Ladestationen · '+total+' Ladepunkte'));
    section.append(head);
    for(const station of siteStations){
      const group=structureEl('div','structure-station');
      const title=structureEl('div','structure-station-title');
      title.append(structureEl('strong',null,station.name));
      title.append(structureEl('span','structure-pill',station.topology==='shared'?'OCPP Mehrfach-Connector':'Einzelgeräte'));
      group.append(title);
      if(account.role==='superadmin')structureLine(group,'Seriennummer',station.serial);
      if(station.ocpp_identity&&account.role==='superadmin')
        structureLine(group,'Gemeinsame OCPP-ID',station.ocpp_identity);
      for(const p of data.points.filter(x=>x.station_id===station.id))group.append(drawPoint(p));
      section.append(group);
    }
    if(!siteStations.length)section.append(structureEl('div','structure-empty','Hier ist noch keine Ladestation angelegt.'));
    host.append(section);
  }
  const legacy=data.points.filter(p=>!p.station_id);
  if(legacy.length){
    const legacySection=structureEl('section','structure-section');
    const head=structureEl('div','structure-site-head','Bestehende Ladepunkte ohne Stationszuordnung');
    legacySection.append(head,...legacy.map(drawPoint));
    host.append(legacySection);
  }
}
$('station-count').addEventListener('change',renderPointSpecs);
$('station-topology').addEventListener('change',renderPointSpecs);
renderPointSpecs();
$('site-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    const result=await api('/api/structure/sites','POST',{
      ...scopedPayload(),name:$('site-name').value,address:$('site-address').value
    });
    $('site-name').value='';$('site-address').value='';
    info('Standort gespeichert: '+result.name);
    await updateStructure();$('station-site').value=result.id;
  }catch(err){info(err.message,true);}
});
$('station-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    const topology=$('station-topology').value;
    const pointSpecs=[...$('point-specs').querySelectorAll('.structure-spec')].map(box=>({
      name:box.querySelector('[data-point-name]').value,
      ocppIdentity:topology==='individual'?box.querySelector('[data-point-ocpp]').value:undefined
    }));
    const result=await api('/api/structure/stations','POST',{
      ...scopedPayload(),siteId:$('station-site').value,
      name:$('station-name').value,serial:$('station-serial').value,
      topology,ocppIdentity:$('station-ocpp').value,pointSpecs
    });
    $('station-name').value='';$('station-serial').value='';$('station-ocpp').value='';
    $('station-count').value='1';renderPointSpecs();
    info('Ladestation mit '+result.points.length+' Ladepunkt(en) gespeichert.');
    await updateStructure();
  }catch(err){info(err.message,true);}
});

async function updatePoints(){
  const p=await api('/api/points');
  $('points-list').replaceChildren(...(p.points.length
    ?p.points.map(x=>text('li',x.name+' · '+(x.enabled?'Freigeschaltet':'Derzeit deaktiviert')))
    :[text('li','Noch kein Ladepunkt zugewiesen.')]));
}
async function updateMicrosoftStatus(){
  try{
    const r=await api('/api/microsoft/status');
    $('ms-status').textContent=r.connected
      ?'Verbundenes Microsoft-Konto: '+r.account
      :'Noch kein Outlook-Geschäftskonto verbunden.';
    show('ms-connect',!r.connected);
    show('ms-disconnect',r.connected);
  }catch{
    $('ms-status').textContent='Microsoft-Versand noch nicht eingerichtet: Es fehlen Datenbank und/oder sichere Render-Konfiguration.';
    show('ms-connect',false);show('ms-disconnect',false);
  }
}
async function refreshTenants(){
  if(account.role!=='superadmin')return;
  const r=await api('/api/tenants');tenants=r.tenants;
  const selected=$('license-tenant').value;
  options($('license-tenant'),tenants);options($('invite-tenant'),tenants);
  if(tenants.some(x=>x.id===selected))$('license-tenant').value=selected;
  $('invite-tenant').value=$('license-tenant').value;
  showLicense();
  if(account.role==='superadmin'&&!$('structure-panel').hidden)
    await updateStructure();
}
function showLicense(){
  const t=tenants.find(x=>x.id===$('license-tenant').value);
  if(t){$('license-status').value=t.status;$('license-points').value=t.licensed_points;}
}
async function dashboard(){
  const r=await api('/api/auth/me');account=r.user;
  show('state-panel',false);show('login-panel',false);show('invite-panel',false);show('dashboard');
  $('greeting').textContent='Hallo, '+account.name;
  $('account-details').textContent=account.role==='superadmin'?'Walectra Superadmin – alle Kunden':
    (account.tenantName||'Kunde')+' · '+(account.role==='admin'?'Kunden-Admin':'Nutzer')+
    ' · Status: '+account.tenantStatus;
  // This legacy page is only for linking the Walectra Microsoft 365 mail account.
  // All customer, location, and user management now belongs to the main /app UI.
  show('create-tenant',false);
  show('license-panel',false);
  show('structure-panel',false);
  show('invite-user',false);
  show('users-panel',false);
  show('points-panel',false);
  show('ms-panel',account.role==='superadmin');
  if(account.role==='superadmin')await updateMicrosoftStatus();
  $('account-details').textContent='Microsoft 365 – E-Mail-Verbindung verwalten. Kunden und Ladepunkte im ChargeVisor Dashboard bearbeiten.';

}
function resetToken(params){
  const value=params.get('reset')||'';
  // Older reset messages could attach literal newline escapes to the URL.
  return value.replace(/^([A-Za-z0-9_-]{43})\\n.*$/,'$1');
}

function finishAcceptedInvite(invitation){
  if(invitation.status!=='accepted')return false;
  if(invitation.signedIn){
    window.location.replace('/app');
    return true;
  }
  history.replaceState({},'',location.pathname);
  show('state-panel',false);
  show('invite-panel',false);
  show('login-panel',true);
  info('Diese Einladung wurde bereits angenommen. Melde dich mit deinem bestehenden Zugang an.');
  return true;
}

async function start(){
  const params=new URLSearchParams(location.search);
  const invite=params.get('invite')||'',reset=resetToken(params);
  try{
    const r=await api('/api/auth/status');
    if(!r.ready){
      $('state-text').textContent='Die neue Anmeldung ist technisch vorbereitet, aber noch nicht aktiviert: Eine separate ChargeVisor-Datenbank fehlt. Die Demo bleibt weiterhin verfügbar.';
      return;
    }
    if(params.has('reset')){
      const link=await api('/api/auth/password-reset/status?'+new URLSearchParams({token:reset}));
      show('state-panel',false);
      if(link.status==='pending'){
        show('reset-panel');
      }else{
        history.replaceState({},'',location.pathname);
        show('reset-request-panel');
        info('Dieser Link ist ungültig, abgelaufen oder bereits verwendet. Fordere bitte einen neuen Link an.',true);
      }
      return;
    }
    if(params.has('invite')){
      const invitation=await api('/api/auth/invite-status?'+new URLSearchParams({token:invite}));
      if(finishAcceptedInvite(invitation))return;
      show('state-panel',false);
      if(invitation.status==='pending'){
        show('invite-panel');
      }else{
        history.replaceState({},'',location.pathname);
        show('login-panel');
        info('Diese Einladung ist ungültig oder abgelaufen. Falls du bereits ein Konto hast, kannst du dich anmelden.',true);
      }
      return;
    }
    // The original ChargeVisor interface is the authenticated application.
    // Only explicit mailbox-management visits retain the transitional admin panel.
    const manage=params.has('manage')||params.has('mail');
    if(!manage){
      try{await api('/api/auth/me');window.location.replace('/app');return;}catch{}
    }else{
      try{await dashboard();return;}catch{}
    }
    show('state-panel',false);
    show('login-panel',true);
  }catch(e){$('state-text').textContent='Serverstatus nicht erreichbar: '+e.message;}
}
// Password visibility is always opt-in, also for invited accounts and reset forms.
document.querySelectorAll('.toggle-password').forEach(button=>{
  const field=$(button.dataset.passwordInput);
  if(!field)return;
  button.addEventListener('click',()=>{
    const visible=field.type==='password';
    field.type=visible?'text':'password';
    button.textContent=visible?'Verbergen':'Anzeigen';
    button.setAttribute('aria-pressed',String(visible));
    field.focus();
  });
});
$('forgot-password').addEventListener('click',()=>{
  $('reset-email').value=$('email').value||'';
  show('login-panel',false);
  show('reset-request-panel',true);
  info('');
});
$('reset-request-back').addEventListener('click',()=>{
  show('reset-request-panel',false);
  show('login-panel',true);
  info('');
});
$('reset-request-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    const requested=await api('/api/auth/password-reset/request','POST',{email:$('reset-email').value});
    info(requested.message);
  }catch(err){info(err.message,true);}
});
$('reset-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if($('reset-password').value!==$('reset-password-confirm').value){
    info('Die beiden Passwörter stimmen nicht überein.',true);
    return;
  }
  try{
    const reset=resetToken(new URLSearchParams(location.search));
    await api('/api/auth/password-reset/confirm','POST',{token:reset,password:$('reset-password').value});
    history.replaceState({},'',location.pathname);
    try{await api('/api/auth/logout','POST',{});}catch{}
    account=null;
    $('password').value='';
    $('reset-password').value='';
    $('reset-password-confirm').value='';
    if($('reset-email').value)$('email').value=$('reset-email').value;
    show('dashboard',false);
    show('reset-panel',false);
    show('login-panel',true);
    info('Passwort geändert. Melde dich jetzt mit deinem neuen Passwort an.');
  }catch(err){info(err.message,true);}
});
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('/api/auth/login','POST',{email:$('email').value,password:$('password').value});
    $('password').value='';window.location.assign('/app');
  }catch(err){info(err.message,true);}
});
$('accept-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const invite=new URLSearchParams(location.search).get('invite')||'';
  try{
    const accepted=await api('/api/auth/accept','POST',{token:invite,password:$('new-password').value});
    history.replaceState({},'',location.pathname);
    // End an existing superadmin session before presenting the invited user's login.
    let logoutOk=true;
    try{await api('/api/auth/logout','POST',{});}catch{logoutOk=false;}
    account=null;
    show('dashboard',false);
    show('invite-panel',false);
    show('login-panel',true);
    $('new-password').value='';
    $('email').value=accepted.email||'';
    $('password').value='';
    info(logoutOk
      ?'Zugang aktiviert. Bitte mit der eingeladenen E-Mail-Adresse und deinem neuen Passwort anmelden.'
      :'Zugang aktiviert. Bitte melde dich vom bisherigen Konto ab, bevor du dich mit dem neuen Benutzer anmeldest.',!logoutOk);
  }catch(err){
    const invitation=await api('/api/auth/invite-status?'+new URLSearchParams({token:invite})).catch(()=>null);
    if(!invitation||!finishAcceptedInvite(invitation))info(err.message,true);
  }
});
$('logout').addEventListener('click',async()=>{
  try{await api('/api/auth/logout','POST',{});account=null;show('dashboard',false);show('login-panel');info('Abgemeldet');}
  catch(err){info(err.message,true);}
});
$('tenant-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    const r=await api('/api/tenants','POST',{name:$('tenant-name').value});
    info('Kunde angelegt – noch nicht freigeschaltet: '+r.name);
    $('tenant-name').value='';await refreshTenants();
  }catch(err){info(err.message,true);}
});
$('license-tenant').addEventListener('change',()=>{
  showLicense();$('invite-tenant').value=$('license-tenant').value;
  updateUsers().catch(e=>info(e.message,true));
  updateStructure().catch(e=>info(e.message,true));
});
$('invite-tenant').addEventListener('change',()=>{
  updateUsers().catch(e=>info(e.message,true));
  updateInvitePointOptions().catch(e=>info(e.message,true));
});
$('invite-role').addEventListener('change',()=>updateInvitePointOptions().catch(e=>info(e.message,true)));
$('license-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    const id=$('license-tenant').value;if(!id)throw new Error('Bitte Kunden auswählen');
    await api('/api/tenants/'+id,'PATCH',{status:$('license-status').value,licensedPoints:Number($('license-points').value)});
    info('Lizenz und Freigabe gespeichert');await refreshTenants();
  }catch(err){info(err.message,true);}
});
$('user-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    const p={name:$('invite-name').value,email:$('invite-email').value,
      role:account.role==='superadmin'?$('invite-role').value:'user'};
    if(account.role==='superadmin')p.tenantId=$('invite-tenant').value;
    if(p.role==='user'){
      p.pointIds=[...document.querySelectorAll('#invite-point-options [data-invite-point]:checked')]
        .map(el=>el.value);
      if(!p.pointIds.length)throw new Error('Bitte zuerst mindestens einen Ladepunkt auswählen.');
    }
    const r=await api('/api/invitations','POST',p);
    $('invite-email').value='';$('invite-name').value='';
    await updateUsers();
    await updateInvitePointOptions();
    info(r.delivery==='email'?'Einladung an Microsoft 365 zum Versand übergeben. Der neue Nutzer erscheint nach Annahme unten in der aktiven Benutzerliste.':'Einladung erstellt, automatischer E-Mail-Versand nicht erfolgreich. Diesen einmaligen Link jetzt sicher weitergeben: '+r.link);
  }catch(err){info(err.message,true);}
});
$('ms-disconnect').addEventListener('click',async()=>{
  if(!window.confirm('Microsoft-Outlook-Verbindung wirklich trennen?'))return;
  try{await api('/api/microsoft/disconnect','POST',{});info('Microsoft-Konto getrennt');await updateMicrosoftStatus();}
  catch(e){info(e.message,true);}
});
const mailResult=new URLSearchParams(location.search).get('mail');
if(mailResult){
  history.replaceState({},'',location.pathname);
  if(mailResult==='connected')info('Microsoft 365 wurde erfolgreich für ChargeVisor verbunden.');
  else info('Microsoft-Verbindung nicht abgeschlossen. Bitte den Status im Admin-Bereich prüfen.',true);
}
start();
