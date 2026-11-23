import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const A='44444444-4444-4444-4444-444444444444';
const B='66666666-6666-4666-8666-666666666666';
const SITE='aaaa1111-aaaa-4111-8111-111111111111';
const STATION='cccc1111-cccc-4111-8111-111111111111';
const POINT='bbbb1111-bbbb-4111-8111-111111111111';
const LUMINA_IMAGE='img[src^="/assets/lumina-thumb.svg"]';
const tenants=[
  {id:A,name:'Walectra Test',status:'active',contact_name:'Test Ansprechpartner'},
  {id:B,name:'WEG Sonnenhof',status:'active',contact_name:'Anna Test'},
];
function mockOverview(tid,topology='shared'){
  const basePoint={station_id:STATION,ocpp_identity:'cvci000001',enabled:true,power_kw:11};
  const point={...basePoint,id:POINT,name:'Stellplatz A1',connector_number:1};
  const points=topology==='shared'?[
    {...basePoint,id:'eeee1111-eeee-4111-8111-111111111111',name:'Stellplatz A3',connector_number:3},
    point,
    {...basePoint,id:'dddd1111-dddd-4111-8111-111111111111',name:'Stellplatz A2',connector_number:2},
  ]:[point];
  return {tenant:tenants.find(x=>x.id===tid)||tenants[0],
    sites:[{id:SITE,tenant_id:tid,name:'Tiefgarage Test',address:'Musterstraße 1, München'}],
    stations:[{id:STATION,site_id:SITE,name:'Enelion Lumina',topology,
      serial:'LUMINA-TEST',ocpp_identity:'cvci000001',is_simulator:true}],
    points,access:[]};
}
async function mockBackend(page,role='superadmin',topology='shared'){
  const user={id:'aaaabbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role,name:'Test Kunde',
    tenantId:role==='superadmin'?null:A,tenantName:'Walectra Test',
    tenantStatus:'active',testToolsEnabled:true,email:'test@chargevisor.test'};
  const {points}=mockOverview(A,topology);
  const assigned=points.find(point=>point.connector_number===(topology==='shared'?2:1));
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const tid=url.searchParams.get('tenantId')||A;
    let data={};
    if(path==='/api/auth/me')data={user};
    else if(path==='/api/tenants')data={tenants};
    else if(path==='/api/structure/overview')data=mockOverview(tid,topology);
    else if(path==='/api/ocpp/live'){
      const station={station_id:STATION,connected:true,vendor:'Virtual OCPP',model:'CI Simulator',
        firmware:'1.0',simulated:true,last_seen:new Date().toISOString()};
      const connectors=[
        {connector_id:1,status:'Charging',energy_wh:3200},
        ...(topology==='shared'?[
          {connector_id:2,status:'Available',energy_wh:1200},
          {connector_id:3,status:'Faulted',energy_wh:830},
        ]:[])
      ];
      if(role==='user'){
        const scoped={station_id:STATION,point_id:assigned.id,simulated:true};
        data={live:[{...station,point_id:assigned.id}],connectors:[
          {...scoped,...connectors.find(connector=>connector.connector_id===assigned.connector_number)}
        ]};
      }else{
        data={live:[{...station,identity:'cvci000001',status:'Charging',action:'MeterValues',energy_wh:3200}],
          connectors:connectors.map(connector=>({...connector,identity:'cvci000001',station_id:STATION,simulated:true}))};
      }
    }
    else if(path==='/api/users')data={users:[]};
    else if(path==='/api/ocpp/analytics')data={buckets:[],sessions:[]};
    else if(path==='/api/ocpp/sessions')data={sessions:[]};
    else if(path==='/api/invitations')data={invitations:[]};
    else if(path==='/api/points')data={points:[{
      id:assigned.id,name:assigned.name,enabled:assigned.enabled,connector_number:assigned.connector_number,
      station_id:STATION,station_name:'Enelion Lumina',station_topology:topology,site_id:SITE,
      site_name:'Tiefgarage Test',site_address:'Musterstraße 1, München'
    }]};
    else throw Error('Unmocked API request '+path);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
}

test('Superadmin sees a customer selector in EVERY menu and can change customers without losing the page',async({page})=>{
  await mockBackend(page);
  await page.goto('http://127.0.0.1:10000/app');
  await expect(page.locator('#globalTenantSelect')).toBeVisible();
  for(const key of ['overview','customers','sites','people','sessions','settings']){
    await page.locator('[data-page="'+key+'"]').click();
    await expect(page.locator('#globalTenantSelect')).toBeVisible();
    await expect(page.locator('#globalTenantSelect')).toHaveValue(A);
  }
  const menu = page.locator('#nav');
  await expect(menu.locator('[data-page="user-management"]')).toHaveCount(0);
  await menu.locator('[data-page="people"]').click();
  await page.locator('#globalTenantSelect').selectOption(B);
  await expect(page.locator('#globalTenantSelect')).toHaveValue(B);
  await expect(page.locator('h1')).toHaveText('RFID');
  await expect(page.locator('#crumb')).toHaveText('RFID');
  await expect(page.locator('.cv-customer-context')).toContainText('AKTUELLER KUNDE');
  await menu.locator('[data-page="customers"]').click();
  await page.locator(`[data-customer-users="${A}"]`).click();
  await expect(page.locator('h1')).toHaveText('Nutzerverwaltung');
  await expect(page.locator('#globalTenantSelect')).toHaveValue(A);
  await expect(menu.locator('[data-page="customers"]')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button',{name:'Zurück zur Kundenverwaltung'}).click();
  await expect(page.locator('h1')).toHaveText('Kundenverwaltung');
});
test('Shared wallbox connectors are ordered and retain their individual Lumina and OCPP status',async({page})=>{
  await mockBackend(page);
  await page.goto('http://127.0.0.1:10000/app');
  await page.locator('[data-page="sites"]').click();
  const station=page.locator('.station-group');
  await expect(station).toHaveCount(1);
  const heading=station.locator('.station-group-title.cv-station-heading');
  await expect(heading).toContainText('Enelion Lumina');
  await expect(heading.locator('img')).toHaveCount(0);
  await expect(heading.locator('[data-credentials]')).toBeVisible();
  await expect(heading.locator('.cv-virtual-pill').first()).toContainText('Virtuelle');

  const rows=station.locator('.point-row');
  await expect(rows.locator('.point-name strong')).toHaveText(['Stellplatz A1','Stellplatz A2','Stellplatz A3']);
  const labels=['Connector #1 · Master','Connector #2 · Slave','Connector #3 · Slave'];
  const statuses=['Lädt','Bereit','Fehler'];
  for(const [index,label] of labels.entries()){
    const row=rows.nth(index);
    await expect(row.getByText(label,{exact:true})).toBeVisible();
    await expect(row.locator(LUMINA_IMAGE)).toHaveCount(1);
    await expect(row.locator(LUMINA_IMAGE)).toBeVisible();
    await expect(row.locator('.point-current')).toContainText(statuses[index]);
  }
  const led=rows.first().locator('.lumina-charging .lumina-led');
  await expect(led).toBeVisible();
  expect(await led.evaluate(el=>getComputedStyle(el).animationName)).toContain('luminaPulse');
  await expect(rows.nth(1).locator('.lumina-ready .lumina-led')).toBeVisible();
  await expect(rows.nth(2).locator('.lumina-error .lumina-led')).toBeVisible();

  await rows.first().locator('[data-expand]').click();
  const details=station.locator('.point-detail-panel');
  await expect(details).toBeVisible();
  await expect(details.locator('img')).toHaveCount(0);
  await expect(details).toContainText('Firmwarestand');
  await expect(details).toContainText('Hersteller');
  await expect(details).toContainText('Virtual OCPP');
  await expect(details.locator('[data-access]')).toBeVisible();
  await expect(details.locator('[data-edit-point]')).toBeVisible();
  await expect(details.locator('[data-toggle-point]')).toBeVisible();
  await expect(page.locator(LUMINA_IMAGE)).toHaveCount(3);
  await page.screenshot({path:'ui-regression-lumina.png',fullPage:true});
});

test('An independent wallbox shows one device preview and its hardware connector label',async({page})=>{
  await mockBackend(page,'superadmin','individual');
  await page.goto('http://127.0.0.1:10000/app');
  await page.locator('[data-page="sites"]').click();
  const station=page.locator('.station-group');
  await expect(station).toHaveCount(1);
  await expect(station.locator('.cv-station-heading')).toContainText('Enelion Lumina');
  await expect(station.locator('.cv-station-heading img')).toHaveCount(0);
  const row=station.locator('.point-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Connector #1',{exact:true})).toBeVisible();
  await expect(row.locator(LUMINA_IMAGE)).toBeVisible();
  await row.locator('[data-expand]').click();
  await expect(station.locator('.point-detail-panel')).toBeVisible();
  await expect(station.locator('.point-detail-panel img')).toHaveCount(0);
  await expect(page.locator(LUMINA_IMAGE)).toHaveCount(1);

  await page.route('**/api/structure/overview?*',route=>{
    const data=mockOverview(A,'individual');
    data.points.push({...data.points[0],id:'ffff1111-ffff-4111-8111-111111111111',
      name:'Stellplatz A4',ocpp_identity:'cvci000004'});
    return route.fulfill({json:data});
  });
  await page.reload();
  await page.locator('[data-page="sites"]').click();
  const connected=station.locator('.point-row').filter({hasText:'Stellplatz A1'});
  const unconnected=station.locator('.point-row').filter({hasText:'Stellplatz A4'});
  await expect(connected.locator('.point-current')).toContainText('Lädt');
  await expect(unconnected.locator('.point-current').getByText('Nicht verbunden',{exact:true})).toBeVisible();
  await expect(unconnected.locator('.lumina-off .lumina-led')).toBeVisible();
});

test('Customer admin sees fixed customer, original Lumina but no technical provisioning',async({page})=>{
  await mockBackend(page,'admin');
  await page.goto('http://127.0.0.1:10000/app');
  await expect(page.locator('#globalTenantSelect')).toHaveCount(0);
  await expect(page.locator('.cv-context-fixed')).toContainText('Walectra Test');
  await page.locator('[data-page="sites"]').click();
  await expect(page.locator('img[src^="/assets/lumina-thumb.svg"]').first()).toBeVisible();
  await expect(page.locator('#newChargerBtn')).toHaveCount(0);
  await expect(page.locator('[data-credentials]')).toHaveCount(0);
  await expect(page.locator('#nav [data-page="people"]')).toHaveCount(0);
  await page.locator('#nav [data-page="user-management"]').click();
  await expect(page.locator('h1')).toHaveText('Nutzerverwaltung');
  await expect(page.locator('#content')).toContainText('RFID');
});
test('User sees only assigned charger and never sees customer-switch or user-management actions',async({page})=>{
  await mockBackend(page,'user');
  await page.goto('http://127.0.0.1:10000/app');
  await expect(page.locator('#globalTenantSelect')).toHaveCount(0);
  await expect(page.locator('.cv-context-fixed')).toContainText('Walectra Test');
  await page.locator('[data-page="sites"]').click();
  const row=page.locator('.point-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.point-name strong')).toHaveText('Stellplatz A2');
  await expect(row.getByText('Connector #2 · Slave',{exact:true})).toBeVisible();
  await expect(row.locator('.point-current')).toContainText('Bereit');
  await expect(row.locator(LUMINA_IMAGE)).toBeVisible();
  await expect(page.locator(LUMINA_IMAGE)).toHaveCount(1);
  await expect(page.locator('[data-access]')).toHaveCount(0);
  await expect(page.locator('#nav [data-page="people"]')).toHaveCount(0);
  await expect(page.locator('#nav [data-page="user-management"]')).toHaveCount(0);
});

test('Customer admin filters charging history, exports files and sees the PDF activation notice',async({page})=>{
  const person='aaaabbbb-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  await page.clock.setFixedTime(new Date('2026-11-22T11:30:00Z'));
  await mockBackend(page,'admin');
  await page.route('**/api/users?**',route=>route.fulfill({json:{users:[{id:person,name:'Alex Test',role:'user',tenant_id:A,status:'active'}]}}));
  const session={
    id:'52',started_at:'2026-11-20T13:05:00Z',stopped_at:'2026-11-20T14:05:00Z',
    site_id:SITE,station_id:STATION,site_name:'Tiefgarage Test',station_name:'Enelion Lumina',
    point_name:'Stellplatz A1',connector_id:1,authorization_kind:'rfid',card_id:person,card_name:'Testkarte',
    organization_name:'Walectra Test',user_name:'Alex Test',stop_reason:'EVDisconnected',
    meter_start_wh:'12000',meter_stop_wh:'22000',signed_meter:false,energy_wh:10000,price_per_kwh:'0.3500',amount_eur:'3.50'
  };
  await page.route('**/api/ocpp/sessions?**',route=>{
    const params=new URL(route.request().url()).searchParams;
    if(params.get('months')==='1')return route.fulfill({json:{firstMonth:'2025-04'}});
    if(params.get('export')==='1'){
      expect(params.get('from')).toBe('2026-11-01');
      expect(params.get('to')).toBe('2026-11-21');
      expect(params.get('siteId')).toBe(SITE);
      expect(params.get('userId')).toBe(person);
    }
    if(params.get('beforeId')==='52')
      return route.fulfill({json:{sessions:[{...session,id:'51',card_name:'Zweite Seite'}],nextCursor:null}});
    return route.fulfill({json:{sessions:[session],nextCursor:params.get('export')==='1'?'52':null}});
  });
  await page.goto('/app');
  await page.locator('[data-page="sessions"]').click();
  const row=page.locator('#chargingHistory tbody tr');
  await expect(row).toContainText('3,50 €');
  await expect(page.locator('#sessionMonth')).toHaveValue('2026-11');
  const previous=page.waitForRequest(req=>{
    const url=new URL(req.url());
    return url.pathname==='/api/ocpp/sessions'&&url.searchParams.get('from')==='2026-10-01'&&url.searchParams.get('to')==='2026-10-31';
  });
  await page.getByRole('button',{name:'Vorheriger Monat'}).click();
  await previous;
  await expect(page.locator('#sessionMonth')).toHaveValue('2026-10');
  await page.getByRole('button',{name:'Nächster Monat'}).click();
  await page.getByRole('button',{name:'Zeitraum frei wählen'}).click();
  await page.locator('[name=site]').selectOption(SITE);
  await page.locator('[name=from]').fill('2026-11-01');
  await page.locator('[name=to]').fill('2026-11-21');
  await page.locator('[name=user]').selectOption(person);
  const filtered=page.waitForRequest(req=>{
    const url=new URL(req.url());
    return url.pathname==='/api/ocpp/sessions'&&url.searchParams.get('from')==='2026-11-01'&&
      url.searchParams.get('to')==='2026-11-21'&&url.searchParams.get('userId')===person&&url.searchParams.get('siteId')===SITE;
  });
  await page.getByRole('button',{name:'Filtern'}).click();
  await filtered;
  for(const [label,extension] of [['CSV','csv'],['Excel','xlsx']]){
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:label+' herunterladen'}).click();
    const file=await download;
    expect(file.suggestedFilename()).toMatch(new RegExp('\\.'+extension+'$','i'));
    const content=await readFile(await file.path(),'utf8');
    expect(content).toContain('Zweite Seite');
    if(extension==='csv'){
      const [header,detail]=content.trim().split(/\r?\n/);
      expect(header.replace(/^\uFEFF/,'').split(';').slice(0,29)).toEqual([
        'Session ID','Started','Ended','Location ID','Charge Station ID','EVSE','Connector ID','Location Name',
        'Charge Station Name','Type','Authorization','Charge Key Name','Organization Name','User Name','Stop Reason',
        'Meter Start','Meter Stop','Signed Meter','Energy in kWh','Duration in Minutes','Invoicing Type','Price Type',
        'Currency','Start Fee Price','Time Price','Energy Price','Session Price Sum','Platform Fee','Payout Price'
      ].map(label=>'"'+label+'"'));
      expect(detail).toContain('"EVDisconnected";"12000";"22000";"false";"10,000";"60,0";"";"";"EUR";"0,00";"0,00";"";"3,50"');
    }else{
      expect(content).toContain('Payout Price');
      expect(content).toContain('<c r="R2" t="b"><v>0</v></c>');
      expect(content).toContain('<c r="AA2" s="3"><v>3.5</v></c>');
      expect(content).toContain('<autoFilter ref="A1:AF3"/>');
    }
  }
  await expect(page.locator('#downloadChargingReport')).toHaveAttribute('aria-disabled','true');
  await page.locator('#downloadChargingReport').press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Kontaktiere Walectra');
  if(process.env.CHARGEVISOR_REVIEW_DIR){
    await page.screenshot({path:process.env.CHARGEVISOR_REVIEW_DIR+'/pdf-freischaltung.png'});
    await page.getByRole('button',{name:'Schließen'}).click();
    await page.screenshot({path:process.env.CHARGEVISOR_REVIEW_DIR+'/ladevorgaenge.png'});
  }
});

for(const role of ['admin','superadmin']){
  test(role+' saves the selected tenant tariff',async({page})=>{
    await mockBackend(page,role);
    await page.route('**/api/tenants/*/tariff',route=>route.fulfill({json:{price_per_kwh:0.35}}));
    await page.goto('/app');
    await page.locator('[data-page="settings"]').click();
    await page.locator('#tenantTariff [name=price]').fill('0.35');
    const save=page.waitForRequest(req=>req.method()==='PUT'&&req.url().endsWith('/api/tenants/'+A+'/tariff'));
    await page.getByRole('button',{name:'Tarif speichern'}).click();
    expect((await save).postDataJSON()).toEqual({pricePerKwh:0.35});
    if(role==='superadmin'&&process.env.CHARGEVISOR_REVIEW_DIR)
      await page.screenshot({path:process.env.CHARGEVISOR_REVIEW_DIR+'/ladetarif.png'});
  });
}

test('Live telemetry, premium commands and English are visible in the portal',async({page})=>{
  await mockBackend(page,'admin','individual');
  const structure=mockOverview(A,'individual');
  structure.stations[0].is_simulator=false;
  await page.route('**/api/structure/overview?**',route=>route.fulfill({json:structure}));
  await page.route('**/api/ocpp/live?**',route=>route.fulfill({json:{
    live:[{station_id:STATION,identity:'cvci000001',connected:true}],
    connectors:[{station_id:STATION,identity:'cvci000001',connector_id:1,status:'Preparing',
      power_w:6000,power_updated_at:new Date().toISOString()}]
  }}));
  await page.route('**/api/ocpp/analytics?**',route=>route.fulfill({json:{
    buckets:[{bucket:'2026-11-05 00:00:00',kwh:6,sessions:1},{bucket:'2026-11-06 00:00:00',kwh:10,sessions:1}],sessions:[]
  }}));
  await page.goto('/app');
  await expect(page.locator('.cv-overview-status')).toContainText('Alles OK');
  await expect(page.locator('#analyticsTotal')).toHaveText('6 kW');
  await page.locator('#analyticsPeriod').selectOption('month');
  await expect(page.locator('#analyticsTotal')).toHaveText('16,0 kWh');
  await page.locator('#overviewStations').scrollIntoViewIfNeeded();
  await expect(page.locator('#overviewStations .point-row')).toContainText('6 kW');
  await expect(page.locator('#overviewStations .point-current')).toContainText('Verbunden');
  const start=page.getByRole('button',{name:'Ladevorgang starten'});
  await expect(start).toHaveAttribute('aria-disabled','true');
  await start.press('Enter');
  await expect(page.getByRole('dialog').getByRole('link',{name:'In Outlook schreiben'})).toHaveAttribute('href',/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?to=info%40walectra\.de/);
  const review=process.env.CHARGEVISOR_STATION_REVIEW_DIR;
  if(review)await page.screenshot({path:review+'/premium.png'});
  await page.getByRole('button',{name:'Schließen'}).click();
  if(review){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:review+'/overview.png',fullPage:true});}
  await page.locator('#portalLanguage').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('heading',{name:'Charging infrastructure overview'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start charging'})).toHaveAttribute('title',/Premium feature/);
  if(review)await page.screenshot({path:review+'/overview-en.png',fullPage:true});
});

test('Reference layout renders actual states and retains the pause, resume and confirmed stop flow',async({page})=>{
  await mockBackend(page);
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{
    id:'aaaabbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Test Konto',role:'superadmin',tenantStatus:'active',testToolsEnabled:false
  }}}));
  await page.clock.setFixedTime(new Date('2026-11-22T11:59:00Z'));
  await page.setViewportSize({width:1600,height:950});
  const structure=mockOverview(A);
  const points=structure.points.sort((a,b)=>a.connector_number-b.connector_number);
  const station=structure.stations[0];
  station.is_simulator=false;
  station.name='Ladekette Tiefgarage Süd';
  structure.sites[0].name='Tiefgarage Nord';
  structure.stations.unshift({...station,id:B,name:'Lumina Garage',ocpp_identity:'anotherCV'});
  points.push({...points[2],id:'91111111-1111-4111-8111-111111111111',station_id:B,
    name:'Stellplatz Garage',connector_number:1,ocpp_identity:'anotherCV'});
  structure.points=[points.at(-1),...points.slice(0,-1)];
  const recent=new Date('2026-11-22T11:58:00Z').toISOString();
  const live=structure.stations.map(s=>({station_id:s.id,identity:s.ocpp_identity,connected:true}));
  const connectors=['Charging','Charging','Available','Available'].map((status,i)=>({
    station_id:points[i].station_id,identity:points[i].ocpp_identity,connector_id:points[i].connector_number,
    status,power_updated_at:recent,power_w:i<2?11000:0
  }));
  let fault=false,plugged=false,paused=false,stopConfirmed=false;
  const dated=new Date('2026-11-22T05:00:00Z').getTime();
  const power=Array.from({length:180},(_,i)=>({
    bucket:new Date(dated+i*120000).toISOString(),kw:i>=120?22:i>=90||i>=30&&i<60?11:0,reported:4,points:4
  }));
  const sessions=Array.from({length:8},(_,i)=>({
    id:String(8-i),started_at:new Date(dated+18000000-1800000*i).toISOString(),stopped_at:recent,
    point_name:points[i%4].name,user_name:'Alex Muster',energy_wh:12200,price_per_kwh:'0.34',amount_eur:'4.15'
  }));
  await page.route('**/api/structure/overview?**',route=>route.fulfill({json:structure}));
  await page.route('**/api/ocpp/live?**',route=>{
    const rows=connectors.map(c=>({...c}));
    if(fault)Object.assign(rows[2],{status:'Faulted',error_code:'ConnectorLockFailure',status_changed_at:'2026-11-22T10:42:00Z'});
    if(plugged)Object.assign(rows[2],{status:'Preparing'});
    if(paused)Object.assign(rows[0],{status:'SuspendedEVSE',power_w:0});
    return route.fulfill({json:{live,connectors:rows,transactions:points.slice(0,2).map((p,i)=>({
      point_id:p.id,remote_paused:i===0&&paused
    }))}});
  });
  await page.route('**/api/ocpp/analytics?**',route=>route.fulfill({json:{power,buckets:[{bucket:'2026-11-22 11:00:00',kwh:6}],sessions}}));
  await page.route('**/api/ocpp/sessions?**',route=>route.fulfill({json:{sessions,firstMonth:'2025-07'}}));
  await page.route('**/api/ocpp/control',route=>{
    const {command}=route.request().postDataJSON();
    if(command==='pause')paused=true;
    if(command==='start')paused=false;
    if(command==='stop')stopConfirmed=true;
    return route.fulfill({json:{status:'Accepted'}});
  });
  const review=process.env.CHARGEVISOR_REFERENCE_REVIEW;
  const baseline=process.env.CHARGEVISOR_REFERENCE_BASELINE;
  if(review&&baseline){
    for(const [path,contentType,pattern] of [['app.html','text/html','**/app'],['styles.css','text/css','**/styles.css'],['app-live.js','text/javascript','**/app-live.js']])
      await page.route(pattern,route=>route.fulfill({path:baseline+'/'+path,contentType}));
    await page.goto('/app');
    await expect(page.getByRole('heading',{name:'Ladeinfrastruktur im Überblick'})).toBeVisible();
    await page.screenshot({path:review+'/uebersicht-vorher.png'});
    await page.locator('#nav [data-page="sites"]').click();
    await page.screenshot({path:review+'/ladepunkte-vorher.png'});
    await page.locator('#nav [data-page="sessions"]').click();
    await expect(page.locator('#chargingHistory tbody tr')).toHaveCount(8);
    await page.screenshot({path:review+'/ladevorgaenge-vorher.png'});
    for(const pattern of ['**/app','**/styles.css','**/app-live.js'])await page.unroute(pattern);
  }
  await page.goto('/app');
  await expect(page.locator('.cv-overview-status')).toContainText('Alles OK');
  await expect(page.locator('.cv-overview-stats > div')).toHaveCount(5);
  await expect(page.locator('#analyticsTotal')).toHaveText('22 kW');
  await expect(page.locator('#analyticsChart svg path.cv-chart-area')).toHaveCount(1);
  if(review)await page.screenshot({path:review+'/uebersicht-alles-ok.png'});
  fault=true;
  await page.reload();
  await expect(page.locator('.cv-overview-fault')).toContainText('Ladestecker verriegelt nicht');
  await expect(page.locator('.cv-overview-fault')).toContainText('11:42');
  await expect(page.locator('#analyticsChart svg')).toBeVisible();
  if(review)await page.screenshot({path:review+'/uebersicht-stoerung.png'});
  await page.locator('[data-fault-point]').click();
  await expect(page.locator('.point-detail-panel')).toContainText('Ladestecker verriegelt nicht');
  const stateOne=page.locator('.point-row').filter({hasText:'Stellplatz A1'});
  const available=page.locator('.point-row').filter({hasText:'Stellplatz Garage'});
  await expect(available.locator('.cv-point-controls button')).toHaveCount(0);
  await expect(available.locator('.charge-symbol.ready')).toBeVisible();
  await expect(page.locator('.cv-station-power')).toHaveText(['Total aktuell: 0 kW','Total aktuell: 22 kW']);
  await expect(stateOne.locator('.cv-point-power')).toHaveText('11 kW');
  // User-approved control sequence: while charging ONLY Pause; after a
  // confirmed Pause exactly Resume + Stop, with Stop requiring confirmation.
  await expect(stateOne.locator('.cv-point-controls button')).toHaveCount(1);
  await stateOne.getByRole('button',{name:'Ladevorgang pausieren'}).click();
  await expect(stateOne.locator('.cv-point-status')).toContainText('Pausiert');
  await expect(stateOne.locator('.cv-point-controls button')).toHaveCount(2);
  await expect(stateOne.locator('.cv-point-controls button').first()).toHaveAttribute('aria-label','Ladevorgang fortsetzen');
  await stateOne.getByRole('button',{name:'Ladevorgang stoppen'}).click();
  await expect(page.getByRole('dialog')).toContainText('wirklich stoppen?');
  expect(stopConfirmed).toBe(false);
  await page.getByRole('button',{name:'Abbrechen'}).click();
  await stateOne.getByRole('button',{name:'Ladevorgang fortsetzen'}).click();
  await expect(stateOne.locator('.cv-point-status')).toContainText('Lädt');
  await expect(stateOne.locator('.cv-point-controls button')).toHaveCount(1);
  await expect(stateOne.getByRole('button',{name:'Ladevorgang pausieren'})).toBeVisible();
  await stateOne.getByRole('button',{name:'Ladevorgang pausieren'}).click();
  await expect(stateOne.locator('.cv-point-controls button')).toHaveCount(2);
  await stateOne.getByRole('button',{name:'Ladevorgang stoppen'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Ladevorgang stoppen'}).click();
  await expect.poll(()=>stopConfirmed).toBe(true);
  fault=false;plugged=true;
  await page.reload();
  await page.locator('#nav [data-page="sites"]').click();
  const connected=page.locator('.point-row').filter({hasText:'Stellplatz A3'});
  await expect(connected.locator('.cv-point-status')).toContainText('Verbunden');
  await expect(connected.getByRole('button',{name:'Ladevorgang starten'})).toBeVisible();
  if(review)await page.screenshot({path:review+'/ladepunkte.png'});
  await page.locator('#nav [data-page="sessions"]').click();
  await expect(page.locator('#chargingHistory tbody tr')).toHaveCount(8);
  await expect(page.locator('#sessionMonth')).toHaveValue('2026-11');
  if(review)await page.screenshot({path:review+'/ladevorgaenge.png'});
});

test('Live polling keeps existing Lumina, customer selector and chart DOM while updating status',async({page})=>{
  await page.addInitScript(()=>{
    const interval=window.setInterval.bind(window);
    window.setInterval=(callback,ms,...args)=>{
      if(ms===12000){window.__cvTestLiveTick=callback;return 123456;}
      return interval(callback,ms,...args);
    };
  });
  await mockBackend(page);
  let cp1Status='Charging';
  await page.route('**/api/ocpp/live?**',route=>{
    const connectors=['Charging','Available','Faulted'].map((fallback,i)=>({
      station_id:STATION,identity:'cvci000001',connector_id:i+1,
      status:i===0?cp1Status:fallback,simulated:true,
      power_w:i===0&&cp1Status==='Charging'?11000:0,
      power_updated_at:new Date().toISOString()
    }));
    return route.fulfill({json:{live:[{station_id:STATION,identity:'cvci000001',
      connected:true,simulated:true,vendor:'Enelion',model:'Lumina'}],
      connectors,transactions:[]}});
  });
  await page.goto('http://127.0.0.1:10000/app');
  const row=page.locator('.point-row').filter({hasText:'Stellplatz A1'});
  await expect(row.locator('.cv-point-status')).toContainText('Lädt');
  await expect(page.locator('#analyticsChart .cv-chart-empty')).toBeVisible();
  await page.evaluate(()=>{
    window.__cvStableNodes={
      main:document.querySelector('#content'),
      tenant:document.querySelector('#globalTenantSelect'),
      chart:document.querySelector('#analyticsChart'),
      chartPlaceholder:document.querySelector('#analyticsChart .cv-chart-empty'),
      station:document.querySelector('[data-live-station]'),
      site:document.querySelector('[data-live-site]'),
      point:[...document.querySelectorAll('[data-live-point]')]
        .find(x=>x.textContent.includes('Stellplatz A1')),
      lumina:[...document.querySelectorAll('[data-live-point]')]
        .find(x=>x.textContent.includes('Stellplatz A1'))?.querySelector('.lumina-preview')
    };
  });
  cp1Status='Available';
  await page.evaluate(()=>window.__cvTestLiveTick());
  await expect(row.locator('.cv-point-status')).toContainText('Bereit');
  const identities=await page.evaluate(()=>{
    const before=window.__cvStableNodes;
    return {
      main:before.main===document.querySelector('#content'),
      tenant:before.tenant===document.querySelector('#globalTenantSelect'),
      chart:before.chart===document.querySelector('#analyticsChart'),
      chartPlaceholder:before.chartPlaceholder===document.querySelector('#analyticsChart .cv-chart-empty'),
      station:before.station===document.querySelector('[data-live-station]'),
      site:before.site===document.querySelector('[data-live-site]'),
      point:before.point?.isConnected===true,
      lumina:before.lumina?.isConnected===true,
      image:before.lumina?.querySelector('img')?.isConnected===true,
      led:before.lumina?.classList.contains('lumina-ready')===true
    };
  });
  for(const [part,preserved] of Object.entries(identities))
    expect(preserved,part+' must not flash/recreate on poll').toBe(true);
});
