// Run against a freshly bootstrapped loopback ChargeVisor server and disposable PostgreSQL.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {Pool} from 'pg';

const origin=new URL(process.env.CV_PUBLIC_URL);
const db=new URL(process.env.CV_DATABASE_URL);
const local=new Set(['127.0.0.1','localhost','[::1]']);
assert.ok(local.has(origin.hostname)&&local.has(db.hostname)&&/^\/chargevisor_ci(?:_[a-z0-9_]+)?$/.test(db.pathname));
const pool=new Pool({connectionString:db.href});
const password='disposable-testing-'+randomUUID();
const suffix=randomUUID().slice(0,8);
const sockets=[];
let requestNumber=0;

async function request(path,{method='GET',body,cookie,status=200}={}){
  const headers={Origin:origin.origin};
  if(cookie)headers.Cookie=cookie;
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(new URL(path,origin),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,status,path);
  return {data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function post(path,cookie,body,status=201){
  return (await request(path,{method:'POST',cookie,body,status})).data;
}

async function register(superadmin,tenantId,role,pointIds=[]){
  const email=role+'-'+randomUUID()+'@chargevisor.test';
  const invite=await post('/api/invitations',superadmin,{tenantId,name:role+' '+suffix,email,role,pointIds});
  assert.equal(invite.delivery,'manual');
  const link=new URL(invite.link);
  assert.equal(link.origin,origin.origin);
  const registered=await post('/api/auth/accept',null,{token:link.searchParams.get('invite'),password});
  assert.equal(registered.email,email);
  const {cookie}=await request('/api/auth/login',{method:'POST',body:{email,password}});
  const {data}=await request('/api/auth/me',{cookie});
  return {cookie,id:data.user.id};
}

async function connect(credentials){
  const url=new URL('/ocpp/'+credentials.identity,origin);
  url.protocol=origin.protocol==='https:'?'wss:':'ws:';
  const socket=new WebSocket(url,['ocpp2.0.1','ocpp1.6'],{
    headers:{Authorization:'Basic '+Buffer.from(credentials.identity+':'+credentials.password).toString('base64')},
    handshakeTimeout:5000
  });
  sockets.push(socket);
  await once(socket,'open',{signal:AbortSignal.timeout(5000)});
  assert.equal(socket.protocol,'ocpp1.6');
  return socket;
}

async function call(socket,action,payload={}){
  const id=String(++requestNumber);
  const answer=once(socket,'message',{signal:AbortSignal.timeout(5000)});
  socket.send(JSON.stringify([2,id,action,payload]));
  const [buffer]=await answer;
  const frame=JSON.parse(buffer.toString('utf8'));
  assert.equal(frame[1],id);
  return frame;
}

try{
  const {cookie:superadmin}=await request('/api/auth/login',{
    method:'POST',body:{email:process.env.CV_BOOTSTRAP_EMAIL,password:process.env.CV_BOOTSTRAP_PASSWORD}});
  const tenant=await post('/api/tenants',superadmin,{name:'Hardwarepilot '+suffix,
    contactName:'Testkontakt',contactEmail:'pilot@chargevisor.test',contactPhone:'+49 000 1234'});
  // Existing callers can still create a customer without any address.
  const fields=['street','house_number','postal_code','city','country'];
  for(const key of fields)assert.equal(tenant[key],'');
  const address={street:'Teststraße',houseNumber:'12a',postalCode:'01234',city:'Testort',country:'Deutschland'};
  const addressTenant=await post('/api/tenants',superadmin,{name:'Adress-Test '+suffix,
    contactName:'Testkontakt',contactEmail:'address-test@chargevisor.test',contactPhone:'+49 000 1234',...address});
  assert.deepEqual(fields.map(k=>addressTenant[k]),Object.values(address));
  const path='/api/tenants/'+addressTenant.id;
  const updated=(await request(path,{method:'PATCH',cookie:superadmin,body:{city:'Neuer Testort',houseNumber:''}})).data.tenant;
  assert.equal(updated.street,address.street);
  assert.equal(updated.postal_code,'01234');
  assert.equal(updated.house_number,'');
  assert.equal(updated.city,'Neuer Testort');
  assert.equal(updated.contact_email,'address-test@chargevisor.test');
  await request(path,{method:'PATCH',cookie:superadmin,body:{street:['bad']},status:400});
  const list=(await request('/api/tenants',{cookie:superadmin})).data.tenants;
  assert.equal(list.find(x=>x.id===addressTenant.id).city,'Neuer Testort');
  const cleared=(await request(path,{method:'PATCH',cookie:superadmin,body:{street:'',postalCode:'',city:'',country:''}})).data.tenant;
  assert.deepEqual(fields.map(k=>cleared[k]),['','','','','']);
  const site=await post('/api/structure/sites',superadmin,{tenantId:tenant.id,name:'Garage',
    street:'Testweg',houseNumber:'1',postalCode:'80331',city:'München',country:'Deutschland'});
  const station=await post('/api/structure/stations',superadmin,{tenantId:tenant.id,siteId:site.id,
    name:'Test-Master',topology:'shared',pointSpecs:[{name:'Master'},{name:'Slave'}],isSimulator:false});
  const [credentials]=station.credentials;
  const connector=station.points[0].id;
  const admin=await register(superadmin,tenant.id,'admin');
  await request('/api/tenants',{cookie:admin.cookie,status:403});
  await request('/api/tenants/'+tenant.id,{method:'PATCH',cookie:admin.cookie,body:{city:'Forbidden'},status:403});
  const check=(await pool.query('SELECT city FROM cv_tenants WHERE id=$1',[tenant.id])).rows[0];
  assert.equal(check.city,'');
  console.log('PASS optional customer address create, partial edit, clear, validation and role isolation');
  // Basic tenant-local driver creation and point access must not depend on premium portal invitations.
  const driverEmail='rfid-only-'+randomUUID()+'@chargevisor.test';
  const driver=await post('/api/users',admin.cookie,{name:'RFID-only driver',email:driverEmail,pointIds:station.points.map(p=>p.id)});
  assert.equal(driver.portal_enabled,false);
  assert.equal(driver.addedPoints,2);
  await post('/api/invitations',admin.cookie,{name:'RFID-only driver',email:driverEmail,role:'user',pointIds:[connector]},403);
  const owner=await register(superadmin,tenant.id,'user',[connector]);
  await post('/api/users',owner.cookie,{name:'Forbidden driver',email:'forbidden-'+randomUUID()+'@chargevisor.test',pointIds:[connector]},403);
  const other=await register(superadmin,tenant.id,'user',[station.points[1].id]);
  for(const allowed of [true,false]){
    const grant=await request('/api/points/'+connector+'/access',{method:'PUT',cookie:admin.cookie,
      body:{userId:other.id,allowed,notify:false}});
    assert.equal(grant.data.addedPoints,allowed?1:0);
    const points=await request('/api/points',{cookie:other.cookie});
    assert.deepEqual(new Set(points.data.points.map(p=>p.id)),
      new Set(allowed?[station.points[1].id,connector]:[station.points[1].id]));
  }
  const socket=await connect(credentials);
  const boot=await call(socket,'BootNotification',{chargePointVendor:'Pilot Test',chargePointModel:'Two Connector'});
  assert.equal(boot[2].status,'Accepted');
  const card='A5C8D0E1';
  const recentCard='B3F9A7C2';
  const rfid='/api/ocpp/rfid';
  const rfidScope={stationId:station.id,identity:credentials.identity};
  const deniedStart={connectorId:2,idTag:recentCard,meterStart:2400,timestamp:new Date().toISOString()};
  assert.equal((await call(socket,'Authorize',{idTag:recentCard}))[2].idTagInfo.status,'Invalid');
  const {recent:[detected]}=(await request(rfid,{cookie:admin.cookie})).data;
  assert.ok(detected.id&&detected.last_seen);
  assert.equal(detected.station_name,'Test-Master');
  assert.equal(detected.point_id,null);
  assert.equal(detected.id_tag,recentCard);
  assert.ok(!('tag_hash' in detected)&&!('tag_cipher' in detected));
  const storedRead=(await pool.query('SELECT tag_cipher,tag_hash FROM cv_rfid_recent_reads WHERE id=$1',[detected.id])).rows[0];
  assert.ok(storedRead.tag_cipher&&!JSON.stringify(storedRead).includes(recentCard));
  await request(rfid,{cookie:owner.cookie,status:403});
  assert.equal((await call(socket,'StartTransaction',deniedStart))[2].idTagInfo.status,'Invalid');
  assert.equal((await call(socket,'Authorize',{idTag:recentCard}))[2].idTagInfo.status,'Invalid');
  const {recent:[withConnector]}=(await request(rfid,{cookie:admin.cookie})).data;
  assert.equal(withConnector.id,detected.id);
  assert.equal(withConnector.point_id,station.points[1].id);
  assert.equal(withConnector.connector_id,2);
  const seenAssignment={action:'assign-seen',readId:detected.id,userId:other.id,label:'Erkannte Testkarte',pointIds:[connector]};
  await post(rfid,owner.cookie,seenAssignment,403);
  const foreign=await post('/api/tenants',superadmin,{name:'Fremdkunde '+suffix,
    contactName:'Testkontakt',contactEmail:'separate@chargevisor.test',contactPhone:'+49 000 1234'});
  await post(rfid,superadmin,{...seenAssignment,tenantId:foreign.id},409);
  await post(rfid,admin.cookie,{...seenAssignment,pointIds:[randomUUID()]},403);
  const assigned=await post(rfid,admin.cookie,seenAssignment,200);
  assert.equal(assigned.recent.length,0);
  assert.equal(assigned.cards[0].label,'Erkannte Testkarte');
  assert.equal(assigned.cards[0].id_tag,recentCard);
  await post(rfid,admin.cookie,seenAssignment,409);
  const resultingAccess=await request('/api/points',{cookie:other.cookie});
  assert.deepEqual(new Set(resultingAccess.data.points.map(p=>p.id)),new Set(station.points.map(p=>p.id)));
  assert.equal((await call(socket,'Authorize',{idTag:recentCard}))[2].idTagInfo.status,'Accepted');

  await post(rfid,owner.cookie,{...rfidScope,action:'open'},403);
  await post(rfid,admin.cookie,{...rfidScope,action:'open'},200);
  assert.equal((await call(socket,'Authorize',{idTag:card}))[2].idTagInfo.status,'Invalid');
  const capture=await request(rfid+'?'+new URLSearchParams(rfidScope),{cookie:admin.cookie});
  assert.equal(capture.data.window.candidate,card);
  const confirmed=await post(rfid,admin.cookie,{...rfidScope,action:'confirm',tag:card,label:'Pilotkarte',userId:owner.id},200);
  assert.equal(confirmed.window,null);
  const enrolled=confirmed.cards.find(item=>item.label==='Pilotkarte');
  assert.ok(enrolled);
  assert.equal(enrolled.id_tag,card);
  assert.ok(!('tag_hash' in enrolled)&&!('tag_cipher' in enrolled));
  // A legacy hash-only card recovers its display ID on the next successful scan.
  await pool.query('UPDATE cv_rfid_cards SET tag_cipher=NULL WHERE id=$1',[enrolled.id]);
  assert.equal((await request(rfid,{cookie:admin.cookie})).data.cards.find(x=>x.id===enrolled.id).id_tag,null);
  assert.equal((await call(socket,'Authorize',{idTag:'CV-SIM-TEST'}))[2].idTagInfo.status,'Invalid');
  assert.equal((await call(socket,'Authorize',{idTag:card}))[2].idTagInfo.status,'Accepted');
  assert.equal((await request(rfid,{cookie:admin.cookie})).data.cards.find(x=>x.id===enrolled.id).id_tag,card);
  const tariffPath='/api/tenants/'+tenant.id+'/tariff';
  await request(tariffPath,{method:'PUT',cookie:admin.cookie,body:{pricePerKwh:0.30}});
  const time=new Date().toISOString();
  const start={connectorId:1,idTag:card,meterStart:2400,timestamp:time};
  assert.equal((await call(socket,'StartTransaction',{...start,connectorId:2}))[2].idTagInfo.status,'Invalid');
  const approved=(await call(socket,'StartTransaction',start))[2];
  assert.equal(approved.idTagInfo.status,'Accepted');
  const id=approved.transactionId;
  assert.ok(Number.isInteger(id)&&id>0);
  assert.equal((await call(socket,'StartTransaction',start))[2].transactionId,id);
  await request(tariffPath,{method:'PUT',cookie:admin.cookie,body:{pricePerKwh:0.55}});
  const reading={connectorId:1,transactionId:id,meterValue:[{timestamp:time,sampledValue:[
    {value:'2.55',measurand:'Energy.Active.Import.Register',unit:'kWh'},
    {value:'2.35',measurand:'Energy.Active.Import.Register',unit:'kWh',phase:'L1'}]}]};
  assert.equal((await call(socket,'MeterValues',{...reading,connectorId:2}))[0],4);
  assert.equal((await call(socket,'MeterValues',reading))[0],3);
  const disconnected=once(socket,'close');
  socket.close();
  await disconnected;
  for(let n=0;n<40;n++){
    const {rows}=await pool.query('SELECT connected FROM cv_ocpp_live WHERE identity=$1',[credentials.identity]);
    if(!rows[0]?.connected)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const resumed=await connect(credentials);
  const ended={transactionId:id,meterStop:2850,timestamp:new Date().toISOString(),reason:'EVDisconnected',
    transactionData:[{timestamp:time,sampledValue:[{value:'synthetic-signed-sample',format:'SignedData'}]}]};
  assert.equal((await call(resumed,'StopTransaction',ended))[0],3);
  assert.equal((await call(resumed,'StopTransaction',ended))[0],3);
  const {rows:[row]}=await pool.query('SELECT meter_last_wh,simulated,user_id FROM cv_ocpp_transactions WHERE id=$1',[id]);
  assert.equal(Number(row.meter_last_wh),2550);
  assert.equal(row.simulated,false);
  assert.equal(row.user_id,owner.id);
  const events=await pool.query('SELECT payload FROM cv_ocpp_events WHERE identity=$1',[credentials.identity]);
  assert.ok(events.rows.every(event=>[card,recentCard].every(tag=>!JSON.stringify(event.payload).includes(tag))));
  const own=await request('/api/ocpp/sessions',{cookie:owner.cookie});
  assert.equal(own.data.sessions.length,1);
  const [session]=own.data.sessions;
  assert.equal(Number(session.energy_wh),450);
  assert.equal(session.site_id,site.id);
  assert.equal(session.station_id,station.id);
  assert.equal(session.organization_name,tenant.name);
  assert.equal(session.card_id,enrolled.id);
  assert.equal(session.card_name,'Pilotkarte');
  assert.equal(session.stop_reason,'EVDisconnected');
  assert.equal(session.signed_meter,true);
  assert.equal(Number(session.meter_start_wh),2400);
  assert.equal(Number(session.meter_stop_wh),2850);
  assert.equal(Number(session.price_per_kwh),0.30);
  assert.equal(Number(session.amount_eur),0.14);
  assert.ok(events.rows.every(event=>!JSON.stringify(event.payload).includes('synthetic-signed-sample')));
  assert.deepEqual((await request('/api/ocpp/sessions',{cookie:other.cookie})).data.sessions,[]);

  // Same timestamps expose skipped or duplicate rows if the cursor ignores the transaction ID.
  await pool.query(`
    INSERT INTO cv_ocpp_transactions(identity,tenant_id,connector_id,meter_start_wh,meter_stop_wh,started_at,
      stopped_at,simulated,chargepoint_id,user_id)
    SELECT identity,tenant_id,connector_id,meter_start_wh,meter_stop_wh,started_at,stopped_at,
      g=502,chargepoint_id,user_id
    FROM cv_ocpp_transactions CROSS JOIN generate_series(1,502) AS g WHERE id=$1`,[id]);
  const url='/api/ocpp/sessions?export=1&userId='+owner.id;
  const first=(await request(url,{cookie:admin.cookie})).data;
  const second=(await request(url+'&beforeId='+first.nextCursor,{cookie:admin.cookie})).data;
  assert.equal(first.sessions.length,500);
  assert.equal(second.sessions.length,2);
  assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.sessions,...second.sessions].map(x=>x.id)).size,502);
  assert.equal(second.sessions.at(-1).id,String(id));
  assert.equal(first.sessions[0].signed_meter,null);
  assert.equal(first.sessions[0].amount_eur,null);
  assert.deepEqual((await request(url,{cookie:other.cookie})).data.sessions,[]);
  assert.equal((await request('/api/ocpp/sessions',{cookie:admin.cookie})).data.sessions.length,100);
  await post(rfid,admin.cookie,{action:'set-enabled',cardId:enrolled.id,enabled:false},200);
  assert.equal((await call(resumed,'Authorize',{idTag:card}))[2].idTagInfo.status,'Invalid');
  assert.equal((await call(resumed,'StartTransaction',{...start,timestamp:new Date().toISOString()}))[2].idTagInfo.status,'Invalid');
  assert.deepEqual((await request(rfid,{cookie:admin.cookie})).data.recent,[]);

  assert.equal((await call(resumed,'Authorize',{idTag:'4AE6CA91'}))[2].idTagInfo.status,'Invalid');
  const {recent:[allPointsRead]}=(await request(rfid,{cookie:admin.cookie})).data;
  await post(rfid,admin.cookie,{action:'assign-seen',readId:allPointsRead.id,userId:owner.id,
    label:'Karte für alle Ladepunkte',allPoints:true},200);
  const allAccess=await request('/api/points',{cookie:owner.cookie});
  assert.deepEqual(new Set(allAccess.data.points.map(p=>p.id)),new Set(station.points.map(p=>p.id)));

  assert.equal((await call(resumed,'Authorize',{idTag:'61C7AAE0'}))[2].idTagInfo.status,'Invalid');
  const {recent:[expired]}=(await request(rfid,{cookie:admin.cookie})).data;
  await pool.query("UPDATE cv_rfid_recent_reads SET last_seen=now()-interval '25 hours' WHERE id=$1",[expired.id]);
  assert.deepEqual((await request(rfid,{cookie:admin.cookie})).data.recent,[]);
  await post(rfid,admin.cookie,{action:'assign-seen',readId:expired.id,userId:owner.id,label:'Abgelaufen'},409);
  const addPoints='/api/structure/stations/'+station.id+'/points';
  await post(addPoints,admin.cookie,{names:['Weiterer Stellplatz']},403);
  const added=await post(addPoints,superadmin,{tenantId:tenant.id,names:['Weiterer Stellplatz']});
  assert.equal(added.points[0].connectorNumber,3);
  assert.equal(added.points[0].ocppIdentity,credentials.identity);
  assert.deepEqual(added.credentials,[]);
  await call(resumed,'StatusNotification',{connectorId:1,status:'Preparing',errorCode:'NoError'});
  const control='/api/ocpp/control';
  await post(control,admin.cookie,{pointId:connector,command:'start'},403);
  await request('/api/users/'+admin.id+'/charging-permissions',{method:'PUT',cookie:superadmin,
    body:{tenantId:tenant.id,canControlCharging:true,canResetStation:true}});
  const command=async(name,expected)=>{
    const response=post(control,admin.cookie,{pointId:connector,command:name},200);
    const [raw]=await once(resumed,'message',{signal:AbortSignal.timeout(5000)});
    const [type,requestId,action,payload]=JSON.parse(raw);
    assert.equal(type,2);
    assert.equal(action,expected);
    resumed.send(JSON.stringify([3,requestId,{status:'Accepted'}]));
    assert.equal((await response).status,'Accepted');
    return payload;
  };
  const remote=await command('start','RemoteStartTransaction');
  assert.equal(remote.connectorId,1);
  const remoteAt=new Date().toISOString();
  assert.equal((await call(resumed,'StartTransaction',{connectorId:2,idTag:remote.idTag,meterStart:3000,timestamp:remoteAt}))[2].transactionId,0);
  const tx=(await call(resumed,'StartTransaction',{connectorId:1,idTag:remote.idTag,meterStart:3000,timestamp:remoteAt}))[2].transactionId;
  assert.ok(tx>0);
  await post(control,admin.cookie,{pointId:connector,command:'reset'},409);
  const pause=await command('pause','SetChargingProfile');
  assert.equal(pause.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit,0);
  const live=await request('/api/ocpp/live',{cookie:admin.cookie});
  assert.ok(live.data.transactions.some(t=>t.point_id===connector&&t.remote_paused));
  assert.equal((await command('start','ClearChargingProfile')).id,tx);
  assert.equal((await command('stop','RemoteStopTransaction')).transactionId,tx);
  await call(resumed,'StopTransaction',{transactionId:tx,meterStop:3100,timestamp:new Date().toISOString(),reason:'Remote'});
  assert.equal((await command('reset','Reset')).type,'Soft');
  assert.equal((await call(resumed,'StartTransaction',{connectorId:1,idTag:remote.idTag,meterStart:3100,timestamp:remoteAt}))[2].transactionId,0);
  const statusUpdate={connectorId:2,status:'Faulted',errorCode:'ConnectorLockFailure',info:'Test lock fault'};
  await call(resumed,'StatusNotification',statusUpdate);
  const status=(await request('/api/ocpp/live',{cookie:admin.cookie})).data.connectors.find(c=>c.connector_id===2);
  assert.equal(status.error_code,'ConnectorLockFailure');
  assert.equal(status.error_info,'Test lock fault');
  assert.ok(status.status_changed_at);
  await call(resumed,'StatusNotification',statusUpdate);
  const repeat=(await request('/api/ocpp/live',{cookie:admin.cookie})).data.connectors.find(c=>c.connector_id===2);
  assert.equal(repeat.status_changed_at,status.status_changed_at);
  assert.equal((await call(resumed,'MeterValues',{connectorId:1,meterValue:[{
    timestamp:new Date().toISOString(),sampledValue:['L1','L2','L3'].map(phase=>({
      value:'2',unit:'kW',measurand:'Power.Active.Import',phase
    }))
  }]}))[0],3);
  const power=(await request('/api/ocpp/analytics?period=day&metric=power&siteId='+site.id,{cookie:admin.cookie})).data.power;
  assert.equal(Number(power.at(-1).kw),6);
  assert.ok(power.at(-1).reported>=1);
  const otherSite=await post('/api/structure/sites',superadmin,{tenantId:tenant.id,name:'Zweite Garage',
    street:'Testweg',houseNumber:'2',postalCode:'80331',city:'München',country:'Deutschland'});
  const filtered=requestPath=>request('/api/ocpp/sessions?'+requestPath,{cookie:admin.cookie});
  assert.deepEqual((await filtered('siteId='+otherSite.id)).data.sessions,[]);
  assert.equal((await filtered('siteId='+site.id)).data.sessions.length,100);
  assert.equal((await filtered('siteId='+site.id+'&export=1')).data.sessions.length,500);
  assert.match((await filtered('months=1')).data.firstMonth,/^\d{4}-\d{2}$/);
  await request('/api/users/'+admin.id+'/admin-permissions',{method:'PUT',cookie:superadmin,
    body:{tenantId:tenant.id,canInviteUsers:false,canDownloadPdf:true}});
  const report=await fetch(new URL('/api/ocpp/reports/charging.pdf?siteId='+otherSite.id,origin),{
    headers:{Cookie:admin.cookie},signal:AbortSignal.timeout(5000)
  });
  assert.equal(report.status,200);
  assert.match(report.headers.get('content-type'),/application\/pdf/);
  const pdf=Buffer.from(await report.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF')&&pdf.includes('Noch keine Ladevorgänge')&&!pdf.includes('Garage'));
  assert.deepEqual((await request('/api/ocpp/analytics?period=day&metric=power&siteId='+otherSite.id,{cookie:admin.cookie})).data.power,[]);
  const analytics=await request('/api/ocpp/analytics?period=all&siteId='+site.id,{cookie:admin.cookie});
  assert.equal(analytics.data.buckets.length,1);
  assert.equal(analytics.data.buckets[0].sessions,503);
  assert.ok(analytics.data.sessions.some(x=>x.id===String(tx)));

  // Power-outage acceptance: abrupt TCP loss (no graceful WebSocket close).
  // ChargeVisor MUST NOT fabricate a StopTransaction or a billable value.
  // The original physical card was deliberately disabled earlier in this
  // regression. Use the separately enrolled, still active all-points card.
  const recoveryCard='4AE6CA91';
  const crashStart={connectorId:1,idTag:recoveryCard,meterStart:4000,timestamp:new Date().toISOString()};
  assert.equal((await call(resumed,'Authorize',{idTag:recoveryCard}))[2].idTagInfo.status,'Accepted');
  const crashedTx=(await call(resumed,'StartTransaction',crashStart))[2].transactionId;
  assert.ok(crashedTx>0,'Physical transaction missing before simulated power loss');
  const killed=once(resumed,'close');
  resumed.terminate();
  await killed;
  let outage=null;
  for(let tries=0;tries<35;tries++){
    outage=(await request('/api/ocpp/power-recovery',{cookie:admin.cookie})).data;
    const item=outage.openSessions.find(x=>Number(x.transactionId)===crashedTx);
    if(item&&item.connected===false)break;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  const unconfirmed=outage.openSessions.find(x=>Number(x.transactionId)===crashedTx);
  assert.ok(unconfirmed,'Physical open transaction must survive abrupt disconnect');
  assert.equal(unconfirmed.connected,false);
  assert.equal(unconfirmed.billingState,'unconfirmed');
  assert.equal(unconfirmed.recovery,'awaiting_stop_transaction');
  const dbBefore=await pool.query(
    'SELECT stopped_at,meter_stop_wh FROM cv_ocpp_transactions WHERE id=$1',[crashedTx]);
  assert.equal(dbBefore.rows[0].stopped_at,null);
  assert.equal(dbBefore.rows[0].meter_stop_wh,null,'No invented energy at disconnect');
  assert.ok(!(await request('/api/ocpp/power-recovery',{cookie:other.cookie}))
    .data.openSessions.some(x=>Number(x.transactionId)===crashedTx),
    'Unrelated user must not see the interrupted transaction');
  const recovered=await connect(credentials);
  assert.equal((await call(recovered,'BootNotification',{
    chargePointVendor:'Pilot Test',chargePointModel:'Two Connector',
    firmwareVersion:'1.0'
  }))[2].status,'Accepted');
  assert.equal((await call(recovered,'StopTransaction',{
    transactionId:crashedTx,meterStop:4120,timestamp:new Date().toISOString(),reason:'PowerLoss'
  }))[0],3);
  const afterStop=(await request('/api/ocpp/power-recovery',{cookie:admin.cookie}))
    .data.openSessions;
  assert.ok(!afterStop.some(x=>Number(x.transactionId)===crashedTx),
    'Confirmed transaction must leave the recovery queue');
  const complete=await pool.query(
    'SELECT stop_reason,meter_stop_wh,stopped_at FROM cv_ocpp_transactions WHERE id=$1',
    [crashedTx]);
  assert.equal(complete.rows[0].stop_reason,'PowerLoss');
  assert.equal(Number(complete.rows[0].meter_stop_wh),4120);
  assert.ok(complete.rows[0].stopped_at);
  console.log('PASS physical power loss: open transaction unbilled after abrupt disconnect, '+
    'then closed with actual PowerLoss StopTransaction on reconnect');
  await request('/api/tenants/'+tenant.id,{method:'PATCH',cookie:superadmin,body:{status:'suspended'}});
  await request('/api/users',{cookie:admin.cookie,status:401});
  console.log('Verified two physical connectors: scoped RFID, reconnect, signed meter metadata, tariff snapshot, complete paginated exports and tenant suspension.');
}finally{
  for(const socket of sockets)socket.terminate();
  await pool.end();
}
