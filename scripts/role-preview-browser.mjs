// Run against a bootstrapped local ChargeVisor using a disposable chargevisor_ci*
// PostgreSQL database, without email delivery configured. Requires @playwright/test
// and Chromium. Set CV_DATABASE_URL, CV_BOOTSTRAP_EMAIL and CV_BOOTSTRAP_PASSWORD.
// CV_ONBOARDING_BASE defaults to https://127.0.0.1:10443. Optionally set
// CV_ROLE_PREVIEW_SCREENSHOT_DIR for desktop and mobile screenshots.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';

const origin = new URL(process.env.CV_ONBOARDING_BASE || 'https://127.0.0.1:10443').origin;
const database = new URL(process.env.CV_DATABASE_URL || 'postgresql://127.0.0.1/');
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
assert.ok(loopback.has(new URL(origin).hostname) && loopback.has(database.hostname),
  'Use loopback test services only.');
assert.match(database.pathname, /^\/chargevisor_ci(?:_[a-z0-9_]+)?$/);
const bootstrapEmail = process.env.CV_BOOTSTRAP_EMAIL;
const bootstrapPassword = process.env.CV_BOOTSTRAP_PASSWORD;
assert.ok(bootstrapEmail && bootstrapPassword, 'Set CV_BOOTSTRAP_EMAIL and CV_BOOTSTRAP_PASSWORD.');

const screenshotDirectory = process.env.CV_ROLE_PREVIEW_SCREENSHOT_DIR;
const suffix = randomUUID().slice(0, 8);
const bootstrap = {email: bootstrapEmail, password: bootstrapPassword};
const memberPassword = 'test-user-' + randomUUID();
const testTenant = 'Rollentest ' + suffix;
const otherTenant = 'Anderer Testkunde ' + suffix;
const assigned = 'Zugewiesener Stellplatz ' + suffix;
const unassigned = 'Nicht zugewiesener Stellplatz ' + suffix;
const adminName = 'Testadmin ' + suffix;
const driverName = 'Testfahrer ' + suffix;

async function login(page, {email, password}) {
  await page.goto(origin + '/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await page.waitForURL(origin + '/app');
}

async function post(page, path, data, status = 201) {
  const result = await page.request.post(origin + path, {headers: {Origin: origin}, data});
  assert.equal(result.status(), status, `Fixture request failed at ${path}.`);
  return result.json();
}

async function get(page, path, headers) {
  const result = await page.request.get(origin + path, {headers});
  assert.equal(result.status(), 200, `Unable to read ${path}.`);
  return result.json();
}

async function setupTenant(page, name, pointNames) {
  const created = await post(page, '/api/tenants', {
    name, contactName: 'Testkontakt', contactEmail: `kontakt-${randomUUID()}@chargevisor.test`, contactPhone: '+49 0000 12345',
  });
  const {id: siteId} = await post(page, '/api/structure/sites', {
    tenantId: created.id, name: 'Testgarage', street: 'Teststraße', houseNumber: '1',
    postalCode: '85276', city: 'Teststadt', country: 'Deutschland',
  });
  const station = await post(page, '/api/structure/stations', {
    tenantId: created.id, siteId, name: 'Teststation', topology: 'shared', isSimulator: true,
    pointSpecs: pointNames.map(pointName => ({name: pointName})),
  });
  return {id: created.id, name, points: station.points};
}

async function register(page, tenantId, name, role, pointIds = []) {
  const email = `${role}-${randomUUID()}@chargevisor.test`;
  const invitation = await post(page, '/api/invitations', {name, email, role, tenantId, pointIds});
  assert.equal(invitation.delivery, 'manual', 'Use the disposable test stack without configured email delivery.');
  const link = new URL(invitation.link);
  assert.equal(link.origin, origin);
  await post(page, '/api/auth/accept', {token: link.searchParams.get('invite'), password: memberPassword});
  const {users} = await get(page, '/api/users?tenantId=' + tenantId);
  const user = users.find(user => user.email === email);
  assert.ok(user && user.enabled);
  return {id: user.id, email, password: memberPassword};
}

function previewHeaders(tenantId, userId) {
  return {'X-CV-Preview-Tenant': tenantId, 'X-CV-Preview-User': userId};
}

async function navOrder(page, keys) {
  const nav = page.locator('#nav [data-page]');
  await expect(nav).toHaveCount(keys.length);
  assert.deepEqual(await nav.evaluateAll(links => links.map(link => link.dataset.page)), keys);
}

async function screenshot(page, filename) {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, {recursive: true});
  await page.screenshot({path: join(screenshotDirectory, filename), fullPage: true});
}

async function startPreview(page, role, userId, excludedUserId) {
  await page.locator('#rolePreviewBtn').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#previewRole').selectOption(role);
  const targets = dialog.locator('#previewUser');
  await expect(targets.locator(`option[value="${excludedUserId}"]`)).toHaveCount(0);
  await targets.selectOption(userId);
  await dialog.locator('#startRolePreview').click();
  await expect(page.locator('#rolePreviewBanner')).toBeVisible();
  await expect(page.locator('#globalTenantSelect')).toHaveCount(0);
  await expect(page.locator('#customerContext')).toContainText(testTenant);
}

const superNav = ['overview', 'sites', 'sessions', 'people', 'customers', 'settings'];
const adminNav = ['overview', 'sites', 'sessions', 'user-management', 'settings'];
const driverNav = ['overview', 'sites', 'sessions'];
const browser = await chromium.launch();

try {
  const contextOptions = {ignoreHTTPSErrors: true, viewport: {width: 1440, height: 900}};
  const superadmin = await browser.newPage(contextOptions);
  await login(superadmin, bootstrap);
  const tenant = await setupTenant(superadmin, testTenant, [assigned, unassigned]);
  const other = await setupTenant(superadmin, otherTenant, ['Fremder Stellplatz ' + suffix]);
  const admin = await register(superadmin, tenant.id, adminName, 'admin');
  const driver = await register(superadmin, tenant.id, driverName, 'user', [tenant.points[0].id]);
  const otherDriver = await register(superadmin, other.id, 'Fremder Fahrer ' + suffix, 'user', [other.points[0].id]);
  const otherAdmin = await register(superadmin, other.id, 'Fremder Admin ' + suffix, 'admin');

  const nav = superadmin.locator('#nav');
  await superadmin.reload();
  await superadmin.locator('#globalTenantSelect').selectOption(tenant.id);
  await navOrder(superadmin, superNav);
  await expect(nav.locator('[data-page=people]')).toContainText('RFID');
  await nav.locator('[data-page=people]').click();
  await expect(superadmin.locator('h1')).toHaveText('RFID');
  await nav.locator('[data-page=customers]').click();
  const userManagement = superadmin.locator(`[data-customer-users="${tenant.id}"]`);
  await userManagement.click();
  await expect(superadmin.locator('h1')).toHaveText('Nutzerverwaltung');
  await expect(nav.locator('[data-page=customers]')).toHaveAttribute('aria-current', 'page');
  await expect(superadmin.getByRole('button', {name: /Nutzer einladen/})).toBeEnabled();
  await superadmin.getByRole('button', {name: 'Zurück zur Kundenverwaltung'}).click();
  await expect(superadmin.locator('h1')).toHaveText('Kundenverwaltung');
  await userManagement.click();

  await startPreview(superadmin, 'admin', admin.id, otherAdmin.id);
  await navOrder(superadmin, adminNav);
  await nav.locator('[data-page=user-management]').click();
  await expect(superadmin.locator('h1')).toHaveText('Nutzerverwaltung');
  await screenshot(superadmin, 'chargevisor-kundenadmin-vorschau.png');
  await expect(superadmin.locator('#inviteBtn')).toBeDisabled();
  await expect(superadmin.locator('#createUserBtn')).toBeVisible();
  const adminHeaders = previewHeaders(tenant.id, admin.id);
  assert.equal((await get(superadmin, '/api/auth/me', adminHeaders)).user.id, admin.id);
  const scopedOverview = await get(superadmin, '/api/structure/overview?tenantId=' + other.id, adminHeaders);
  assert.equal(scopedOverview.tenant.id, tenant.id);
  const deniedWrite = await superadmin.request.post(origin + '/api/invitations', {
    headers: {Origin: origin, ...adminHeaders}, data: {},
  });
  assert.equal(deniedWrite.status(), 403);
  await superadmin.locator('#endRolePreview').click();
  await expect(superadmin.locator('#rolePreviewBanner')).toBeHidden();
  await expect(superadmin.locator('#globalTenantSelect')).toHaveValue(tenant.id);
  await navOrder(superadmin, superNav);

  await startPreview(superadmin, 'user', driver.id, otherDriver.id);
  await navOrder(superadmin, driverNav);
  await nav.locator('[data-page=sites]').click();
  await expect(superadmin.locator('h1')).toHaveText('Meine Ladepunkte');
  await expect(superadmin.getByText(assigned, {exact: true})).toBeVisible();
  await expect(superadmin.getByText(unassigned, {exact: true})).toHaveCount(0);
  const driverHeaders = previewHeaders(tenant.id, driver.id);
  assert.equal((await get(superadmin, '/api/auth/me', driverHeaders)).user.id, driver.id);
  const points = await get(superadmin, '/api/points', driverHeaders);
  assert.deepEqual(points.points.map(point => point.id), [tenant.points[0].id]);
  const unrelated = await superadmin.request.get(origin + '/api/auth/me', {
    headers: previewHeaders(tenant.id, otherDriver.id),
  });
  assert.equal(unrelated.status(), 404);

  const phoneWidth = 390;
  await superadmin.setViewportSize({width: phoneWidth, height: 844});
  const banner = await superadmin.locator('#rolePreviewBanner').boundingBox();
  const customer = await superadmin.locator('#customerContext').boundingBox();
  for (const bounds of [banner, customer]) {
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= phoneWidth,
      'Customer and role context must fit the mobile header.');
  }
  await screenshot(superadmin, 'chargevisor-nutzer-vorschau-mobil.png');
  await superadmin.locator('#endRolePreview').click();
  await superadmin.setViewportSize(contextOptions.viewport);
  await expect(superadmin.locator('#globalTenantSelect')).toHaveValue(tenant.id);
  await navOrder(superadmin, superNav);
  assert.equal((await get(superadmin, '/api/auth/me')).user.role, 'superadmin');

  const adminPage = await browser.newPage(contextOptions);
  await login(adminPage, admin);
  await navOrder(adminPage, adminNav);
  await expect(adminPage.locator('#rolePreviewBtn')).toBeHidden();
  await adminPage.locator('#nav [data-page=user-management]').click();
  await expect(adminPage.locator('#inviteBtn')).toBeDisabled();
  await expect(adminPage.locator('#createUserBtn')).toBeEnabled();
  const permissionPath = origin + '/api/users/' + admin.id + '/admin-permissions';
  async function setPermissions(page, tenantId, canInviteUsers, canDownloadPdf) {
    return page.request.put(permissionPath, {headers: {Origin: origin}, data: {tenantId, canInviteUsers, canDownloadPdf}});
  }
  assert.equal((await setPermissions(adminPage, tenant.id, true, true)).status(), 403);
  assert.equal((await setPermissions(superadmin, other.id, true, true)).status(), 404);
  assert.equal((await setPermissions(superadmin, tenant.id, false, true)).status(), 200);
  const pdfOnly = (await get(adminPage, '/api/auth/me')).user;
  assert.equal(pdfOnly.canInviteUsers, false);
  assert.equal(pdfOnly.canDownloadPdf, true);
  assert.equal((await setPermissions(superadmin, tenant.id, true, false)).status(), 200);
  const inviteOnly = (await get(adminPage, '/api/auth/me')).user;
  assert.equal(inviteOnly.canInviteUsers, true);
  assert.equal(inviteOnly.canDownloadPdf, false);
  await adminPage.reload();
  await adminPage.locator('#nav [data-page=user-management]').click();
  await expect(adminPage.locator('#inviteBtn')).toBeEnabled();
  const forbiddenPreview = await adminPage.request.get(origin + '/api/auth/me', {headers: driverHeaders});
  assert.equal(forbiddenPreview.status(), 403);

  const driverPage = await browser.newPage(contextOptions);
  await login(driverPage, driver);
  await navOrder(driverPage, driverNav);
  await expect(driverPage.locator('#rolePreviewBtn')).toBeHidden();
  console.log('Browser confirmed sidebar order, read-only role preview, assigned charger scope and return to the superadmin session.');
} finally {
  await browser.close();
}
