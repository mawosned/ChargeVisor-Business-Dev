// Requires @playwright/test, Chromium, a bootstrapped loopback ChargeVisor server
// with a local HTTPS/WSS endpoint, a disposable local PostgreSQL database named
// chargevisor_ci*, and the independent test wallbox running on loopback.
//
// CV_ONBOARDING_BASE=https://127.0.0.1:10443
// CV_ONBOARDING_WALLBOX=http://127.0.0.1:8765
// CV_BOOTSTRAP_EMAIL, CV_BOOTSTRAP_PASSWORD and CV_DATABASE_URL must be set.
// Optionally set CV_ONBOARDING_SCREENSHOT_DIR to capture the two test views.
// Run: node scripts/interactive-ocpp-onboarding.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {Pool} from 'pg';

function localUrl(value, protocols, allowCredentials = false) {
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && (allowCredentials || (!url.username && !url.password)), 'Use loopback test services only.');
  return url;
}

const origin = localUrl(process.env.CV_ONBOARDING_BASE || 'https://127.0.0.1:10443', ['https:']).origin;
const simulator = localUrl(process.env.CV_ONBOARDING_WALLBOX || 'http://127.0.0.1:8765', ['http:']).origin;
const database = localUrl(process.env.CV_DATABASE_URL || 'postgresql://127.0.0.1/', ['postgresql:', 'postgres:'], true);
// PostgreSQL needs credentials, unlike the HTTP and WebSocket endpoints.
const screenshotDirectory = process.env.CV_ONBOARDING_SCREENSHOT_DIR;
const email = process.env.CV_BOOTSTRAP_EMAIL;
const password = process.env.CV_BOOTSTRAP_PASSWORD;

assert.ok(/^\/chargevisor_ci(?:_[a-z0-9_]+)?$/.test(database.pathname), 'Use a disposable chargevisor_ci database.');
assert.ok(email && password, 'Set CV_BOOTSTRAP_EMAIL and CV_BOOTSTRAP_PASSWORD.');

async function command(action, fields = {}) {
  const response = await fetch(simulator + '/api/command', {
    method: 'POST',
    headers: {Origin: simulator, 'Content-Type': 'application/json'},
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({action, ...fields}),
  });
  assert.ok(response.ok, `Wallbox command ${action} failed (HTTP ${response.status}).`);
  return (await response.json()).result;
}

async function screenshot(page, file) {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, {recursive: true});
  await page.screenshot({path: join(screenshotDirectory, file), fullPage: true});
}

async function refreshLive(page) {
  const update = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/ocpp/live' && response.ok());
  await page.clock.fastForward(12000);
  await update;
}

const suffix = randomUUID().slice(0, 8);
const tenantName = 'OCPP-Testkunde ' + suffix;
const siteName = 'Testgarage';
const stationName = 'Lumina Test-Master';
const pointNames = ['Teststellplatz Master', 'Teststellplatz Slave'];
const pool = new Pool({connectionString: database.href, max: 1, connectionTimeoutMillis: 5000});
const browser = await chromium.launch();
let connected = false;

try {
  const page = await browser.newPage({ignoreHTTPSErrors: true, viewport: {width: 1440, height: 900}});
  await page.clock.install();
  await page.goto(origin + '/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await page.waitForURL(origin + '/app');
  const navigation = page.locator('#nav');
  await navigation.locator('[data-page=customers]').click();
  const dialog = page.getByRole('dialog');

  await page.locator('#newTenantBtn').click();
  await dialog.locator('[name=name]').fill(tenantName);
  await dialog.locator('[name=contactName]').fill('Kontakt Testkunde');
  await dialog.locator('[name=contactEmail]').fill(`kontakt-${suffix}@chargevisor.test`);
  await dialog.locator('[name=contactPhone]').fill('+49 0000 12345');
  await dialog.getByRole('button', {name: 'Kunde erstellen'}).click();
  const tenant = page.locator('#globalTenantSelect');
  await expect(tenant.locator('option:checked')).toHaveText(tenantName);
  const tenantId = await tenant.inputValue();

  await navigation.locator('[data-page=sites]').click();
  await page.locator('#newSiteBtn').click();
  await dialog.locator('[name=name]').fill(siteName);
  await dialog.locator('[name=street]').fill('Teststraße');
  await dialog.locator('[name=houseNumber]').fill('1');
  await dialog.locator('[name=postalCode]').fill('85276');
  await dialog.locator('[name=city]').fill('Teststadt');
  await dialog.getByRole('button', {name: 'Standort speichern'}).click();
  await expect(page.locator('.site-head').filter({hasText: siteName})).toBeVisible();

  await page.locator('#newChargerBtn').click();
  await dialog.locator('[name=name]').fill(stationName);
  await dialog.locator('[name=count]').fill('2');
  await dialog.locator('[name=count]').press('Tab');
  await dialog.locator('[name=topology]').selectOption('shared');
  for (const [i, pointName] of pointNames.entries()) {
    await dialog.locator('[name=pointName]').nth(i).fill(pointName);
  }
  const markVirtual = dialog.locator('[name=isSimulator]');
  if (!(await markVirtual.isVisible())) {
    await dialog.getByText('Erweiterte Angaben (optional)', {exact: true}).click();
  }
  await markVirtual.check();
  await dialog.getByRole('button', {name: /Speichern.*Verbindungsdaten/}).click();
  await expect(dialog.locator('#cv-ocpp-secret-0')).toBeVisible();
  const identity = await dialog.locator('#cv-ocpp-identity-0').inputValue();
  const secret = await dialog.locator('#cv-ocpp-secret-0').inputValue();
  const ocppUrl = localUrl(await dialog.locator('#cv-ocpp-url-0').inputValue(), ['wss:']);
  assert.match(identity, /^cv[a-z0-9]{8}$/);
  assert.ok(/^[A-Z2-9]{16}$/.test(secret), 'An OCPP password must be shown exactly once.');
  assert.equal(ocppUrl.pathname, '/ocpp/' + identity);
  await dialog.getByRole('button', {name: 'Schließen'}).click();

  const group = page.locator('.station-group').filter({hasText: stationName});
  const pointStatus = (i) => group.locator('.point-row').filter({hasText: pointNames[i]}).locator('.point-current');
  await expect(pointStatus(0)).toContainText('Nicht verbunden');
  await expect(pointStatus(1)).toContainText('Nicht verbunden');
  const credentialsButton = group.getByRole('button', {name: 'OCPP-Zugangsdaten'});
  const stationId = await credentialsButton.getAttribute('data-credentials');
  const response = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/structure/stations/${stationId}/credentials`);
  await credentialsButton.click();
  const metadata = await response;
  assert.equal(metadata.status(), 200);
  const {credentials} = await metadata.json();
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].identity, identity);
  assert.equal(credentials[0].wssUrl, ocppUrl.href);
  assert.ok(!Object.hasOwn(credentials[0], 'password') && !JSON.stringify(credentials[0]).includes(secret),
    'Saved credentials must never return the station password.');
  await expect(dialog.locator('#cv-ocpp-secret-0')).toHaveCount(0);
  await dialog.getByRole('button', {name: 'Schließen'}).click();
  console.log('Browser onboarding: created test tenant, site and two connectors, then verified one-time credentials.');

  const panel = await browser.newPage({viewport: {width: 1240, height: 900}});
  await panel.goto(simulator);
  await panel.locator('#url').fill(ocppUrl.href);
  await panel.locator('#identity').fill(identity);
  await panel.locator('#password').fill(secret);
  await panel.locator('#connector-count').fill('2');
  const connecting = panel.waitForResponse(response => new URL(response.url()).pathname === '/api/command');
  await panel.locator('#connect').click();
  assert.equal((await connecting).status(), 200, 'The wallbox control panel must accept the issued credentials.');
  connected = true;
  await page.bringToFront();
  await command('heartbeat');
  await refreshLive(page);
  await expect(pointStatus(0)).toContainText('Bereit');
  await expect(pointStatus(1)).toContainText('Bereit');

  await command('start', {connector: 1});
  await command('meter', {connector: 1, wh: 1750});
  await command('fault', {connector: 2});
  await refreshLive(page);
  await expect(pointStatus(0)).toContainText('Lädt');
  await expect(pointStatus(1)).toContainText('Fehler');
  await expect(panel.locator('#password')).toHaveValue('');
  await expect(panel.locator('#connector-state')).toContainText('Connector 2 · Störung');
  await screenshot(panel, 'ocpp-test-wallbox.png');

  await command('stop', {connector: 1});
  await command('recover', {connector: 2});
  await refreshLive(page);
  await expect(pointStatus(0)).toContainText('Bereit');
  await expect(pointStatus(1)).toContainText('Bereit');

  const {rows: transactions} = await pool.query(
    'SELECT connector_id, meter_start_wh, meter_stop_wh, simulated, stopped_at FROM cv_ocpp_transactions WHERE tenant_id = $1 AND identity = $2',
    [tenantId, identity],
  );
  assert.equal(transactions.length, 1);
  const [charging] = transactions;
  assert.equal(charging.connector_id, 1);
  assert.equal(charging.simulated, true);
  assert.ok(charging.stopped_at && Number(charging.meter_stop_wh) === 1750
    && Number(charging.meter_start_wh) < Number(charging.meter_stop_wh));
  const {rows: events} = await pool.query(
    'SELECT action, payload, simulated FROM cv_ocpp_events WHERE tenant_id = $1 AND identity = $2',
    [tenantId, identity],
  );
  assert.ok(events.every(({simulated}) => simulated));
  for (const action of ['BootNotification', 'Heartbeat', 'StartTransaction', 'MeterValues', 'StopTransaction']) {
    assert.ok(events.some(event => event.action === action), 'Missing persisted OCPP action ' + action);
  }
  assert.ok(events.some(({action, payload}) =>
    action === 'StatusNotification' && payload.connectorId === 2 && payload.status === 'Faulted'));
  console.log('Independent wallbox: authenticated over WSS, charged connector 1 and reproduced/recovered a connector 2 fault.');

  const {rows: points} = await pool.query(
    'SELECT id FROM cv_chargepoints WHERE tenant_id = $1 AND station_id = $2 AND connector_number = 1',
    [tenantId, stationId],
  );
  const testUser = 'Testnutzer ' + suffix;
  const invitation = await page.request.post(origin + '/api/invitations', {
    headers: {Origin: origin},
    data: {
      tenantId,
      name: testUser,
      email: `nutzer-${suffix}@chargevisor.test`,
      role: 'user',
      pointIds: [points[0].id],
    },
  });
  assert.equal(invitation.status(), 201, 'The test user must be invited to connector 1.');
  const {link} = await invitation.json();
  const inviteUrl = localUrl(link, ['https:']);
  assert.equal(inviteUrl.origin, origin);
  const acceptance = await page.request.post(origin + '/api/auth/accept', {
    headers: {Origin: origin},
    data: {
      token: inviteUrl.searchParams.get('invite'),
      password: 'test-user-' + randomUUID(),
    },
  });
  assert.equal(acceptance.status(), 201, 'The test user must be active before RFID enrollment.');
  await page.reload();
  await expect(tenant.locator('option:checked')).toHaveText(tenantName);
  await navigation.locator('[data-page=people]').click();
  await page.getByRole('button', {name: 'Testkarte anlernen'}).click();
  await dialog.locator('#testRfidUser').selectOption({label: testUser});
  await dialog.getByRole('button', {name: 'Einlesen starten'}).click();
  await expect(dialog.locator('#testRfidStatus')).toContainText('Halte im Simulator eine Testkarte');

  const tag = 'SIM-' + suffix.toUpperCase();
  const unknown = await command('authorize', {tag});
  assert.equal(unknown.status, 'Invalid');
  await page.clock.fastForward(1500);
  await expect(dialog.locator('#testRfidStatus')).toContainText(tag);
  await dialog.getByRole('button', {name: 'Testkarte zuordnen'}).click();
  await expect(dialog.locator('#testRfidCards')).toContainText(tag + ' · ' + testUser);
  await screenshot(page, 'chargevisor-testkarte.png');
  assert.equal((await command('authorize', {tag})).status, 'Accepted');
  assert.equal((await command('start', {connector: 2, tag})).status, 'Invalid');
  assert.equal((await command('start', {connector: 1, tag})).status, 'Accepted');
  await command('meter', {connector: 1, wh: 2250});
  await command('stop', {connector: 1});
  await dialog.getByRole('button', {name: 'Schließen'}).click();

  await navigation.locator('[data-page=sessions]').click();
  const historyResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/ocpp/test-sessions' && response.ok());
  await page.locator('#showTestSessions').click();
  const {sessions} = await (await historyResponse).json();
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every(session => session.simulated === true));
  const sessionRows = dialog.locator('#testSessionRows tbody tr');
  await expect(sessionRows).toHaveCount(2);
  for (const index of [0, 1]) {
    await expect(sessionRows.nth(index)).toContainText(pointNames[0]);
    await expect(sessionRows.nth(index)).toContainText('Beendet');
  }
  await expect(sessionRows.first()).toContainText('500 Wh');
  await dialog.getByRole('button', {name: 'Schließen'}).click();
  console.log('RFID: captured an unknown card, assigned it to an existing test user, rejected the unassigned connector and displayed both test transactions.');

  await navigation.locator('[data-page=sites]').click();
  await command('disconnect');
  connected = false;
  await refreshLive(page);
  await expect(pointStatus(0)).toContainText('Offline');
  await expect(pointStatus(1)).toContainText('Offline');
  console.log('Browser marked both connectors offline after disconnect.');
} finally {
  if (connected) await command('disconnect').catch(() => {});
  await browser.close();
  await pool.end();
}
