import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
const js=readFileSync(new URL('../app-live.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
test('Authenticated ChargeVisor dashboard parses without JavaScript errors',()=>{
  assert.doesNotThrow(()=>new Script(js,{filename:'app-live.js'}));
});
test('Authenticated UI keeps original design assets and layout',()=>{
  for(const s of ['styles.css','chargevisor-login-white.png','id="sidebar"','id="nav"','id="content"','/app-live.js'])
    assert.ok(html.includes(s),s+' missing');
});
test('Real dashboard has no demo role switch, localStorage or fabricated data',()=>{
  assert.ok(!html.includes('id="roleSelect"'));
  assert.ok(!js.includes('localStorage'));
  assert.ok(!js.includes('initial.sessions'));
  assert.ok(js.includes("'/api/auth/me'"));
  assert.ok(js.includes("'/api/structure/overview'"));
});
test('Real dashboard makes customer infrastructure read-only for customer admins',()=>{
  assert.ok(js.includes("state.role==='super'"));
  assert.ok(js.includes("state.role==='user'"));
  assert.ok(js.includes('type===\'station\''));
});

const TENANT_ID='44444444-4444-4444-4444-444444444444';
async function smoke(role,openCustomers=false,openPage=null,withCharger=false,switchCustomer=false){
  const elements=new Map(),listeners=new Map();
  const el=id=>{
    if(!elements.has(id))elements.set(id,{
      id,innerHTML:'',textContent:'',value:'',
      classList:{add(){},remove(){}},
      addEventListener(){},
      replaceChildren(){this.innerHTML='';},
      focus(){},
      setSelectionRange(){},
    });
    return elements.get(id);
  };
  const customer={id:TENANT_ID,name:'Walectra Test',status:'active',licensed_points:2};
  const other={...customer,id:'66666666-6666-4666-8666-666666666666',name:'WEG Sonnenhof'};
  const siteId='aaaa1111-aaaa-4111-8111-111111111111',stationId='cccc1111-cccc-4111-8111-111111111111';
  const pointId='bbbb1111-bbbb-4111-8111-111111111111';
  const user={id:'aaaabbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'test@example.com',
    name:'Test Kunde',role,tenantId:role==='superadmin'?null:TENANT_ID,
    tenantName:'Walectra Test',tenantStatus:'active',licensedPoints:2,testToolsEnabled:true};
  let redirects=[];
  const fetch=async(path)=>{
    const route=String(path);
    let data={};
    if(route==='/api/auth/me')data={user};
    else if(route==='/api/tenants')data={tenants:[customer,other]};
    else if(route.startsWith('/api/structure/overview'))data={
      tenant:customer,
      sites:[{id:siteId,name:'Test Standort',address:'München'}],
      stations:withCharger?[{id:stationId,site_id:siteId,name:'Enelion Lumina',
        topology:'shared',serial:'LUM-TEST-01',ocpp_identity:'cvci000001',is_simulator:true}]:[],
      points:withCharger?[{id:pointId,station_id:stationId,name:'Stellplatz 1',
        ocpp_identity:'cvci000001',connector_number:1,enabled:true}]:[],access:[]
    };
    else if(route.startsWith('/api/ocpp/live'))data={live:withCharger?[{
      identity:'cvci000001',station_id:stationId,connected:true,status:'Charging',
      action:'MeterValues',vendor:'Independent Virtual',model:'Test Wallbox',
      firmware:'1.0',simulated:true,last_seen:'2026-11-19T20:00:00Z',energy_wh:1210
    }]:[],connectors:withCharger?[{identity:'cvci000001',station_id:stationId,connector_id:1,status:'Charging',energy_wh:1210}]:[]};
    else if(route.startsWith('/api/users'))data={users:[]};
    else if(route.startsWith('/api/ocpp/analytics'))data={buckets:[],sessions:[]};
    else if(route.startsWith('/api/ocpp/sessions'))data={sessions:[]};
    else if(route.startsWith('/api/invitations'))data={invitations:[]};
    else if(route==='/api/points')data={points:[{id:pointId,
      name:'Privater Ladepunkt',enabled:true,
      station_id:withCharger?stationId:null,station_name:'Enelion Lumina',
      site_id:withCharger?siteId:null,site_name:'Test Standort',site_address:'München',
      connector_number:1}]};
    else throw Error('Unexpected request '+route);
    return {ok:true,json:async()=>data};
  };
  runInNewContext(js,{
    fetch,URLSearchParams,
    document:{getElementById:el,addEventListener(type,cb){listeners.set(type,cb);}},
    window:{location:{replace:path=>redirects.push(path),assign:path=>redirects.push(path)}},
    console,
    setTimeout,clearTimeout,
  },{filename:'app-live.js'});
  // vm microtasks from async fetches may require a full event-loop turn.
  await new Promise(resolve=>setTimeout(resolve,40));
  if(openCustomers&&listeners.has('click')){
    await listeners.get('click')({target:{closest(selector){
      return selector==='[data-page]'?{dataset:{page:'customers'}}:null;
    }}});
  }
  if(openPage&&listeners.has('click')){
    await listeners.get('click')({target:{closest(selector){
      return selector==='[data-page]'?{dataset:{page:openPage}}:null;
    }}});
  }
  if(switchCustomer&&listeners.has('change')){
    await listeners.get('change')({target:{id:'globalTenantSelect',value:other.id}});
  }
  return {content:el('content').innerHTML,contentText:el('content').textContent,
    nav:el('nav').innerHTML,context:el('customerContext').innerHTML,
    redirects,role:el('realRole').textContent};
}
test('Superadmin sees the original dashboard with real tenant data, not demo selector',async()=>{
  const result=await smoke('superadmin');
  assert.match(result.content,/Ladeinfrastruktur im Überblick/);
  assert.match(result.content,/Test Standort/);
  assert.match(result.content,/Kunde/);
  assert.match(result.role,/Superadmin/);
  assert.equal(result.redirects.length,0);
});
test('Customer admin sees customer dashboard but no Walectra-only provisioning button',async()=>{
  const result=await smoke('admin');
  assert.match(result.content,/Test Standort/);
  assert.ok(!result.content.includes('newTenantBtn'));
  assert.match(result.nav,/data-page="user-management"/);
  assert.doesNotMatch(result.nav,/data-page="people"/);
  assert.match(result.role,/Kunden-Admin/);
});
test('User sees only their assigned personal charger without a role selector',async()=>{
  const result=await smoke('user');
  assert.match(result.content,/zugewiesenen Ladepunkte/);
  assert.doesNotMatch(result.nav,/data-page="(?:people|user-management)"/);
  assert.match(result.role,/Nutzer/);
});

test('OCPP installer guide displays only provisioned connection data and no pretend online status',()=>{
  assert.match(js,/function showOcppCredentials/);
  for(const field of ['Wallbox verbinden','OCPP 1.6 JSON aktivieren','WSS-Serveradresse','Charge Point Identity','Hostname, Port und Pfad einzeln anzeigen','Basic Auth','WSS-Adresse hinterlegt · Verbindung ungeprüft'])
    assert.ok(js.includes(field),'Missing guide field: '+field);
  assert.match(js,/data-ocpp-copy-target/);
  assert.match(js,/data-ocpp-reveal-target/);
  assert.match(js,/data-ocpp-rotate/);
  assert.match(js,/OCPP-Server noch nicht eingerichtet/);
  assert.ok(!js.includes('PROVISIONED zu ONLINE'));
});

test('Station provisioning starts with a simple first step and automatically opens connection guide',()=>{
  assert.ok(js.includes('1 · Ladestation anlegen'));
  assert.ok(js.includes('2 · Wallbox verbinden'));
  assert.ok(js.includes('Speichern & Verbindungsdaten anzeigen'));
  assert.ok(js.includes('Erweiterte Angaben (optional)'));
  assert.ok(js.includes("$('pilotTopologyWrap').hidden=n===1"));
  assert.ok(js.includes('showOcppCredentials(provisioned.credentials'));
  assert.ok(js.includes('Wallbox verbinden · Schritt 2/2'));
});

test('Superadmin can view real customer contacts and editing controls',async()=>{
  const result=await smoke('superadmin',true);
  assert.match(result.content,/Kundenverwaltung/);
  assert.match(result.content,/Walectra Test/);
  assert.match(result.content,/data-edit-customer/);
  assert.match(result.content,/data-delete-customer/);
  assert.match(result.content,/data-customer-users/);
  assert.match(result.content,/Kontaktperson/);
  assert.doesNotMatch(result.nav,/data-page="user-management"/);
  assert.ok(!result.content.includes('Lizenzierte Ladepunkte'));
});
test('Customer admin cannot open customer administration or edit other customers',async()=>{
  const result=await smoke('admin');
  assert.ok(!result.nav.includes('data-page="customers"'));
  assert.ok(!result.content.includes('data-edit-customer'));
});
test('The real management UI requires full customer and address contact fields',()=>{
  for(const s of ['contactName','contactEmail','contactPhone','inviteContact','houseNumber','postalCode','street','city','country','edit-site','edit-tenant'])
    assert.ok(js.includes(s),'Missing form element '+s);
  assert.ok(!js.includes('licensedPoints'));
});

test('Existing customer accounts can receive further point access without a second invitation',()=>{
  assert.ok(js.includes('cvExistingAccountInfo'));
  assert.ok(js.includes('Bereits vorhandene Freigaben bleiben erhalten'));
  assert.ok(js.includes('result.existingUser'));
  assert.ok(js.includes("'/api/users/'+id+'/points'"));
  assert.ok(js.includes('name="notify" value="yes" checked'));
  assert.ok(js.includes('Weitere Ladepunkte freigeschaltet'));
});

test('UI REGRESSION: original black Lumina pictures and four true device LED states remain available',()=>{
  for(const part of [
    'luminaPreview(display,true)', 'lumina-preview', 'lumina-thumb.svg',
    'cv-station-heading', 'point-detail-panel', 'point-detail-grid',
    'lumina-charging', 'lumina-ready', 'lumina-warning', 'lumina-error', 'lumina-off'
  ]) assert.ok(js.includes(part)||css.includes(part),'Restored design element removed: '+part);
  for(const part of [
    '.lumina-charging .lumina-led', '.lumina-ready .lumina-led',
    '.lumina-warning .lumina-led', '.lumina-error .lumina-led',
    '.lumina-off .lumina-led', '@keyframes luminaPulse'
  ]) assert.ok(css.includes(part),'Lumina LED animation removed: '+part);
  assert.ok(js.includes("if(!live)return 'Nicht verbunden'"));
  assert.ok(js.includes("if(!live.connected)return 'Offline'"));
  assert.ok(js.includes("case 'Charging':return 'Lädt'"));
  assert.ok(js.includes("case 'Available':return 'Bereit'"));
  assert.ok(js.includes('TESTSIMULATOR'));
  assert.ok(!js.includes('Lumina Demo, Status'));
});
test('UI REGRESSION: customer context is permanent and cannot impersonate another tenant',()=>{
  assert.ok(html.includes('id="customerContext"'));
  assert.ok(js.includes('id="globalTenantSelect"'));
  assert.ok(js.includes("e.target.id==='globalTenantSelect'"));
  assert.ok(js.includes("if(state.role!=='super')return"));
  assert.ok(js.includes('cv-context-fixed'));
  assert.ok(js.includes('state.tenant!==tid'));
});
test('UI REGRESSION: user, customer and OCPP management actions still exist',()=>{
  for(const part of [
    "function customers()", "function sitesPage(", "function people()",
    "function settings()", "function showOcppCredentials(", "data-edit-customer",
    "data-delete-customer", "data-edit-site", "data-access", "data-user-access",
    "data-credentials", "data-run-ocpp-test", "'/api/invitations'"
  ]) assert.ok(js.includes(part),'Previously implemented functionality disappeared: '+part);
});

test('UI CONTRACT: customer switcher is present on every superadmin page and remains on the current page',async()=>{
  for(const page of ['overview','customers','sites','people','sessions','user-management','settings']){
    const result=await smoke('superadmin',false,page);
    assert.match(result.context,/globalTenantSelect/,'missing global customer selector on '+page);
    assert.match(result.context,/Walectra Test/);
    assert.match(result.context,/WEG Sonnenhof/);
  }
  const switched=await smoke('superadmin',false,'people',false,true);
  assert.match(switched.context,/value="66666666-6666-4666-8666-666666666666" selected/);
  assert.match(switched.content,/<h1>RFID<\/h1>/,'switching customers should not change active page');
});
test('UI CONTRACT: customer admin and users see a fixed customer, not another tenant selector',async()=>{
  for(const role of ['admin','user']){
    const result=await smoke(role);
    assert.match(result.context,/cv-context-fixed/);
    assert.match(result.context,/Walectra Test/);
    assert.ok(!result.context.includes('globalTenantSelect'));
  }
});
test('UI CONTRACT: one point row shows the original Lumina with its live charging state',async()=>{
  const result=await smoke('superadmin',false,'sites',true);
  assert.equal((result.content.match(/<img[^>]+src="\/assets\/lumina-thumb\.svg/g)||[]).length,1);
  assert.match(result.content,/class="station-group-title cv-station-heading"/);
  assert.match(result.content,/lumina-preview lumina-charging/);
  assert.match(result.content,/point-current/);
  assert.match(result.content,/Lädt/);
  assert.match(result.content,/Virtuelle Wallbox/);
  assert.match(result.content,/data-credentials/);
  assert.match(result.content,/data-expand/);
  assert.match(result.content,/TESTSIMULATOR/);
});
