// Requires @playwright/test and Chromium, a bootstrapped local ChargeVisor
// instance backed by disposable chargevisor_ci* PostgreSQL, and a loopback
// SMTP sink that writes {to: string[], raw: string} records to a JSONL mailbox.
// Configure the app to use only this sink, with no Microsoft 365 account.
// Set CV_DATABASE_URL, CV_BOOTSTRAP_EMAIL, CV_BOOTSTRAP_PASSWORD, CV_SMTP_HOST,
// and CV_INVITE_TEST_MAILBOX. CV_INVITE_TEST_BASE defaults to http://127.0.0.1:10042.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {Pool} from 'pg';

const app = new URL(process.env.CV_INVITE_TEST_BASE || 'http://127.0.0.1:10042');
const database = new URL(process.env.CV_DATABASE_URL || 'postgresql://127.0.0.1/');
const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
assert.ok(['http:', 'https:'].includes(app.protocol) && loopback.has(app.hostname)
  && loopback.has(database.hostname) && loopback.has(process.env.CV_SMTP_HOST), 'Use only local test services.');
assert.match(database.pathname, /^\/chargevisor_ci(?:_[a-z0-9_]+)?$/);
const origin = app.origin;
const inbox = process.env.CV_INVITE_TEST_MAILBOX;
const superEmail = process.env.CV_BOOTSTRAP_EMAIL;
const superPassword = process.env.CV_BOOTSTRAP_PASSWORD;
assert.ok(inbox && superEmail?.endsWith('@chargevisor.test') && superPassword,
  'Configure the local mailbox and a disposable superadmin.');

const suffix = randomUUID().slice(0, 8);
const tenantName = 'Einladungstest ' + suffix;
const adminName = 'Testadmin ' + suffix;
const driverName = 'Testfahrer ' + suffix;
const adminEmail = `admin-${suffix}@chargevisor.test`;
const driverEmail = `fahrer+${suffix}@chargevisor.test`;
const initialPassword = 'Browser-Invite-' + randomUUID();
const updatedPassword = 'Browser-Reset-' + randomUUID();

async function post(page, path, data, status = 201) {
  const response = await page.request.post(origin + path, {headers: {Origin: origin}, data});
  assert.equal(response.status(), status, 'Unexpected response for ' + path);
  return response.json();
}

async function enterCredentials(page, email, password) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
}

async function waitForDashboard(page) {
  await page.waitForURL(url => url.origin === origin && url.pathname === '/app');
  await expect(page.locator('#nav [data-page=overview]')).toBeVisible();
}

async function login(page, email, password) {
  await page.goto(origin + '/login');
  await enterCredentials(page, email, password);
  await waitForDashboard(page);
}

function mailBody(raw) {
  const [headers, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const body = bodyParts.join('\n\n');
  if (/^Content-Transfer-Encoding: base64\s*$/mi.test(headers)) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  if (/^Content-Transfer-Encoding: quoted-printable\s*$/mi.test(headers)) {
    return body.replace(/=\r?\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

async function receivedLink(email, kind, ...previousLinks) {
  let link;
  await expect.poll(async () => {
    const mailbox = await readFile(inbox, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const messages = mailbox.split('\n').filter(Boolean).map(record => JSON.parse(record));
    const prefix = `${origin}/login?${kind}=`;
    link = messages.filter(message => message.to.includes(email)).map(message => mailBody(message.raw))
      .flatMap(body => body.split(/\r?\n/))
      .find(line => !previousLinks.includes(line) && line.startsWith(prefix)
        && /^[A-Za-z0-9_-]{43}$/.test(line.slice(prefix.length)));
    return Boolean(link);
  }, {message: `The local SMTP sink must receive an isolated ${kind} link.`}).toBe(true);
  return link;
}

async function inviteStatus(page, link, expected, signedIn) {
  const token = new URL(link).searchParams.get('invite');
  const response = await page.request.get(origin + '/api/auth/invite-status', {params: {token}});
  assert.equal(response.status(), 200);
  const status = await response.json();
  assert.equal(status.status, expected);
  assert.equal(status.signedIn === true, signedIn);
  assert.ok(Object.keys(status).every(key => ['status', 'signedIn'].includes(key)), 'Invite status must not expose account details.');
}

async function currentUser(page) {
  const response = await page.request.get(origin + '/api/auth/me');
  assert.equal(response.status(), 200);
  return (await response.json()).user;
}

async function grantPortalInvites(page, tenantId, userId) {
  const response = await page.request.put(origin + '/api/users/' + userId + '/admin-permissions', {
    headers: {Origin: origin}, data: {tenantId, canInviteUsers: true, canDownloadPdf: false},
  });
  assert.equal(response.status(), 200);
}

async function contactState(page, tenantId) {
  const response = await page.request.get(origin + '/api/tenants');
  assert.equal(response.status(), 200);
  const {tenants} = await response.json();
  return tenants.find(tenant => tenant.id === tenantId)?.contact_access;
}

async function deniedContactReset(page, tenantId) {
  const response = await page.request.post(origin + '/api/tenants/' + tenantId + '/contact-password-reset', {
    headers: {Origin: origin}, data: {},
  });
  assert.ok([404,409].includes(response.status()), 'An ineligible contact must not receive a password reset.');
}

async function confirmContactAction(page, button, path, expectedStatus) {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === path && response.request().method() === 'POST');
  page.once('dialog', dialog => dialog.accept());
  await button.click();
  const response = await responsePromise;
  assert.equal(response.status(), expectedStatus);
  return response.json();
}

async function register(page, link, email, password) {
  await page.goto(link);
  await expect(page.locator('#invite-panel')).toBeVisible();
  await page.locator('#new-password').fill(password);
  await page.locator('#accept-form button[type=submit]').click();
  await expect(page.locator('#login-panel')).toBeVisible();
  await expect(page.locator('#email')).toHaveValue(email);
  await enterCredentials(page, email, password);
  await waitForDashboard(page);
}

const browser = await chromium.launch();
const pool = new Pool({connectionString: database.href, max: 1, connectionTimeoutMillis: 5000});
const contextOptions = {ignoreHTTPSErrors: true, viewport: {width: 1440, height: 900}};
try {
  const superadmin = await browser.newPage(contextOptions);
  await login(superadmin, superEmail, superPassword);
  const {id: tenantId} = await post(superadmin, '/api/tenants', {
    name: tenantName, contactName: adminName, contactEmail: adminEmail, contactPhone: '+49 0000 12345',
  });
  assert.equal(await contactState(superadmin, tenantId), 'available');
  const {id: siteId} = await post(superadmin, '/api/structure/sites', {
    tenantId, name: 'Testgarage', street: 'Teststraße', houseNumber: '1',
    postalCode: '85276', city: 'Teststadt',
  });
  const {points: [testPoint]} = await post(superadmin, '/api/structure/stations', {
    tenantId, siteId, name: 'Virtuelle Teststation', topology: 'shared', isSimulator: true,
    pointSpecs: [{name: 'Teststellplatz'}],
  });
  const customers = superadmin.locator('#nav [data-page=customers]');
  const inviteContact = superadmin.locator('[data-invite-contact="' + tenantId + '"]');
  await superadmin.reload();
  await customers.click();
  await expect(inviteContact).toHaveText('Kontakt als Admin einladen');
  assert.equal((await confirmContactAction(superadmin, inviteContact, '/api/invitations', 201)).delivery, 'email');
  const expiredAdminLink = await receivedLink(adminEmail, 'invite');
  assert.equal(await contactState(superadmin, tenantId), 'invited');
  await deniedContactReset(superadmin, tenantId);
  await pool.query("UPDATE cv_invitations SET expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND email=$2",
    [tenantId, adminEmail]);
  assert.equal(await contactState(superadmin, tenantId), 'expired');
  await inviteStatus(superadmin, expiredAdminLink, 'invalid', false);

  await superadmin.reload();
  await customers.click();
  await expect(inviteContact).toHaveText('Neue Einladung senden');
  assert.equal((await confirmContactAction(superadmin, inviteContact, '/api/invitations', 201)).delivery, 'email');
  const adminLink = await receivedLink(adminEmail, 'invite', expiredAdminLink);
  await expect(inviteContact).toHaveText('Einladung erneut senden');
  assert.equal((await confirmContactAction(superadmin, inviteContact, '/api/invitations', 201)).delivery, 'email');
  const resentAdminLink = await receivedLink(adminEmail, 'invite', expiredAdminLink, adminLink);
  await inviteStatus(superadmin, adminLink, 'pending', false);
  await inviteStatus(superadmin, resentAdminLink, 'pending', false);
  const admin = await browser.newPage(contextOptions);
  await post(admin, '/api/auth/accept', {token: new URL(adminLink).searchParams.get('invite'), password: initialPassword});
  await login(admin, adminEmail, initialPassword);
  await inviteStatus(admin, resentAdminLink, 'accepted', true);
  assert.equal(await contactState(superadmin, tenantId), 'registered');

  const contactResetPath = '/api/tenants/' + tenantId + '/contact-password-reset';
  await post(admin, contactResetPath, {}, 403);
  const {id: registeredAdminId} = await currentUser(admin);
  await pool.query('UPDATE cv_users SET enabled=false WHERE id=$1', [registeredAdminId]);
  assert.equal(await contactState(superadmin, tenantId), 'disabled');
  await deniedContactReset(superadmin, tenantId);
  await pool.query('UPDATE cv_users SET enabled=true WHERE id=$1', [registeredAdminId]);

  await superadmin.reload();
  await customers.click();
  const resetContact = superadmin.locator('[data-reset-contact-password="' + tenantId + '"]');
  await expect(resetContact).toHaveText('Passwort-Link senden');
  const contactReset = await confirmContactAction(superadmin, resetContact, contactResetPath, 200);
  assert.equal(Object.keys(contactReset).join(','), 'delivery', 'Recovery response must not disclose a link or token.');
  assert.equal(contactReset.delivery, 'email');
  const contactResetLink = await receivedLink(adminEmail, 'reset');
  assert.equal((await currentUser(admin)).id, registeredAdminId, 'Sending the reset link must preserve the current session.');
  const contactPassword = 'Browser-Contact-Reset-' + randomUUID();
  const contactRecovery = await browser.newPage(contextOptions);
  await contactRecovery.goto(contactResetLink);
  await expect(contactRecovery.locator('#reset-panel')).toBeVisible();
  await contactRecovery.locator('#reset-password').fill(contactPassword);
  await contactRecovery.locator('#reset-password-confirm').fill(contactPassword);
  await contactRecovery.locator('#reset-form button[type=submit]').click();
  await expect(contactRecovery.locator('#feedback')).toContainText('Passwort geändert');
  assert.equal((await admin.request.get(origin + '/api/auth/me')).status(), 401);
  await post(contactRecovery, '/api/auth/login', {email: adminEmail, password: initialPassword}, 401);
  await login(admin, adminEmail, contactPassword);
  await contactRecovery.close();
  console.log('Browser verified contact invitation states, repeat invitation, and email-only contact password recovery without revoking sessions before redemption.');

  await admin.locator('#nav [data-page=user-management]').click();
  const defaultAdmin = await currentUser(admin);
  assert.equal(defaultAdmin.canInviteUsers, false);
  assert.equal(defaultAdmin.canDownloadPdf, false);
  await expect(admin.locator('#inviteBtn')).toBeDisabled();
  const rfidEmail = 'rfid-' + suffix + '@chargevisor.test';
  const rfidName = 'RFID Zugang ' + suffix;
  const rfidOnly = await post(admin, '/api/users', {name: rfidName, email: rfidEmail, allPoints: true});
  assert.equal(rfidOnly.portal_enabled, false);
  assert.equal(rfidOnly.addedPoints, 1);
  await post(admin, '/api/invitations', {name: rfidName, email: rfidEmail, role: 'user'}, 403);
  await post(admin, '/api/auth/login', {email: rfidEmail, password: initialPassword}, 401);
  await post(admin, '/api/auth/password-reset/request', {email: rfidEmail}, 200);
  const {rowCount: rfidResetTokens} = await pool.query('SELECT 1 FROM cv_password_resets WHERE user_id=$1', [rfidOnly.id]);
  assert.equal(rfidResetTokens, 0);

  await grantPortalInvites(superadmin, tenantId, defaultAdmin.id);
  await admin.reload();
  await admin.locator('#nav [data-page=user-management]').click();
  assert.equal((await currentUser(admin)).canInviteUsers, true);
  assert.equal((await currentUser(admin)).canDownloadPdf, false);
  const rfidInvite = await post(admin, '/api/invitations', {name: rfidName, email: rfidEmail, role: 'user'});
  assert.equal(rfidInvite.delivery, 'email');
  const rfidPage = await browser.newPage(contextOptions);
  await register(rfidPage, await receivedLink(rfidEmail, 'invite'), rfidEmail, initialPassword);
  assert.equal((await currentUser(rfidPage)).id, rfidOnly.id);
  const rfidPoints = await rfidPage.request.get(origin + '/api/points');
  assert.equal(rfidPoints.status(), 200);
  assert.deepEqual((await rfidPoints.json()).points.map(point => point.id), [testPoint.id]);
  await rfidPage.close();
  console.log('Browser verified default admin grants, RFID-only access, and activation of the same user through an emailed invitation.');

  await admin.locator('#inviteBtn').click();
  const inviteDialog = admin.getByRole('dialog');
  await inviteDialog.locator('[name=name]').fill(driverName);
  await inviteDialog.locator('[name=email]').fill(driverEmail);
  await inviteDialog.locator('[name=pointIds]').check();
  const invitation = admin.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/invitations' && response.request().method() === 'POST');
  await inviteDialog.locator('#pilotForm button:not([type])').click();
  const invitationResult = await invitation;
  assert.equal(invitationResult.status(), 201);
  assert.equal((await invitationResult.json()).delivery, 'email');
  const driverLink = await receivedLink(driverEmail, 'invite');

  const driver = await browser.newPage(contextOptions);
  await inviteStatus(driver, driverLink, 'pending', false);
  await driver.goto(driverLink);
  await expect(driver.locator('#invite-panel')).toBeVisible();
  await driver.locator('#new-password').fill(initialPassword);
  await driver.locator('#accept-form button[type=submit]').click();
  await expect(driver.locator('#login-panel')).toBeVisible();
  await expect(driver.locator('#invite-panel')).toBeHidden();
  await expect(driver.locator('#email')).toHaveValue(driverEmail);
  await enterCredentials(driver, driverEmail, initialPassword);
  await waitForDashboard(driver);

  await inviteStatus(driver, driverLink, 'accepted', true);
  await driver.goto(driverLink);
  await waitForDashboard(driver);
  await expect(driver.locator('#customerContext')).toContainText(tenantName);
  await expect(driver.locator('#realRole')).toContainText(driverName);
  await post(driver, contactResetPath, {}, 403);
  const changeContact = async contactEmail => {
    const response = await superadmin.request.patch(origin + '/api/tenants/' + tenantId, {
      headers: {Origin: origin}, data: {contactEmail},
    });
    assert.equal(response.status(), 200);
  };
  await changeContact(driverEmail);
  assert.equal(await contactState(superadmin, tenantId), 'reserved');
  await deniedContactReset(superadmin, tenantId);
  await changeContact(adminEmail);

  const visitor = await browser.newPage(contextOptions);
  await inviteStatus(visitor, driverLink, 'accepted', false);
  await visitor.goto(driverLink);
  await expect(visitor.locator('#login-panel')).toBeVisible();
  await expect(visitor.locator('#invite-panel')).toBeHidden();
  await expect(visitor.locator('#feedback')).toContainText('bereits angenommen');
  await expect(visitor.locator('#email')).toHaveValue('');
  await inviteStatus(admin, driverLink, 'accepted', false);
  await admin.goto(driverLink);
  await expect(admin.locator('#login-panel')).toBeVisible();
  await expect(admin.locator('#invite-panel')).toBeHidden();
  await expect(admin.locator('#feedback')).toContainText('bereits angenommen');
  console.log('Browser verified invitation registration, repeat access with the matching account, and sign-in for other visitors.');

  await visitor.locator('#forgot-password').click();
  const resetRequest = visitor.locator('#reset-request-panel');
  await expect(resetRequest).toBeVisible();
  await visitor.locator('#reset-email').fill(driverEmail);
  const requestResponse = visitor.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/password-reset/request');
  await resetRequest.locator('button[type=submit]').click();
  assert.equal((await requestResponse).status(), 200);
  const resetLink = await receivedLink(driverEmail, 'reset');
  const legacyResetLink = new URL(resetLink);
  legacyResetLink.searchParams.set('reset', legacyResetLink.searchParams.get('reset') + String.raw`\n\nWenn`);
  await visitor.goto(legacyResetLink.href);
  await expect(visitor.locator('#reset-panel')).toBeVisible();
  await visitor.locator('#reset-password').fill(updatedPassword);
  await visitor.locator('#reset-password-confirm').fill(initialPassword);
  await visitor.locator('#reset-form button[type=submit]').click();
  await expect(visitor.locator('#feedback')).toContainText('stimmen nicht überein');
  await visitor.locator('#reset-password-confirm').fill(updatedPassword);
  await visitor.locator('#reset-form button[type=submit]').click();
  await expect(visitor.locator('#login-panel')).toBeVisible();
  await expect(visitor.locator('#feedback')).toContainText('Passwort geändert');

  const revokedSession = await driver.request.get(origin + '/api/auth/me');
  assert.equal(revokedSession.status(), 401);
  const rejectedLogin = visitor.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/login');
  await enterCredentials(visitor, driverEmail, initialPassword);
  assert.equal((await rejectedLogin).status(), 401);
  await enterCredentials(visitor, driverEmail, updatedPassword);
  await waitForDashboard(visitor);

  await visitor.goto(resetLink);
  await expect(visitor.locator('#reset-request-panel')).toBeVisible();
  await expect(visitor.locator('#reset-panel')).toBeHidden();
  console.log('Browser verified local SMTP password recovery, session revocation, new-password sign-in, and rejection of a reused reset link.');

  const oldAdmin = await currentUser(admin);
  const oldDriver = await currentUser(visitor);
  const replacementName = 'Neuanlage ' + suffix;
  const {id: replacementId} = await post(superadmin, '/api/tenants', {
    name: replacementName, contactName: adminName, contactEmail: adminEmail, contactPhone: '+49 0000 67890',
  });
  const replacementAdmin = {tenantId: replacementId, role: 'admin', name: adminName, email: adminEmail};
  assert.equal(await contactState(superadmin, replacementId), 'reserved');
  await deniedContactReset(superadmin, replacementId);
  await post(superadmin, '/api/invitations', replacementAdmin, 409);
  await post(visitor, '/api/auth/password-reset/request', {email: driverEmail}, 200);
  const oldPendingReset = await receivedLink(driverEmail, 'reset', resetLink);

  const archived = await superadmin.request.delete(origin + '/api/tenants/' + tenantId, {
    headers: {Origin: origin},
  });
  assert.equal(archived.status(), 200);
  assert.equal((await archived.json()).archived, true);
  assert.equal((await admin.request.get(origin + '/api/auth/me')).status(), 401);
  assert.equal((await visitor.request.get(origin + '/api/auth/me')).status(), 401);
  await inviteStatus(superadmin, adminLink, 'invalid', false);
  await inviteStatus(superadmin, driverLink, 'invalid', false);

  assert.equal((await post(superadmin, '/api/invitations', replacementAdmin)).delivery, 'email');
  const freshAdminLink = await receivedLink(adminEmail, 'invite', expiredAdminLink, adminLink, resentAdminLink);
  await inviteStatus(superadmin, freshAdminLink, 'pending', false);
  const readArchived = async userId => (await pool.query(
    'SELECT id,tenant_id,email,enabled,archived_login_email FROM cv_users WHERE id=$1', [userId],
  )).rows[0];
  assert.equal((await readArchived(oldAdmin.id)).email, adminEmail, 'Issuing a new invite must leave the archived login in place.');

  const replacementPassword = 'Browser-Reinvite-' + randomUUID();
  const newAdmin = await browser.newPage(contextOptions);
  await register(newAdmin, freshAdminLink, adminEmail, replacementPassword);
  const activeAdmin = await currentUser(newAdmin);
  assert.notEqual(activeAdmin.id, oldAdmin.id);
  assert.equal(activeAdmin.role, 'admin');
  assert.equal(activeAdmin.tenantId, replacementId);
  await expect(newAdmin.locator('#customerContext')).toContainText(replacementName);

  const {id: replacementSiteId} = await post(superadmin, '/api/structure/sites', {
    tenantId: replacementId, name: 'Neue Testgarage', street: 'Teststraße', houseNumber: '2',
    postalCode: '85276', city: 'Teststadt',
  });
  const {points: [replacementPoint]} = await post(superadmin, '/api/structure/stations', {
    tenantId: replacementId, siteId: replacementSiteId, name: 'Neue Teststation', topology: 'shared',
    isSimulator: true, pointSpecs: [{name: 'Neuer Teststellplatz'}],
  });
  await grantPortalInvites(superadmin, replacementId, activeAdmin.id);
  const freshDriverInvite = await post(newAdmin, '/api/invitations', {
    role: 'user', name: driverName, email: driverEmail, pointIds: [replacementPoint.id],
  });
  assert.equal(freshDriverInvite.delivery, 'email');
  const freshDriverLink = await receivedLink(driverEmail, 'invite', driverLink);
  const newDriver = await browser.newPage(contextOptions);
  await register(newDriver, freshDriverLink, driverEmail, replacementPassword);
  const activeDriver = await currentUser(newDriver);
  assert.notEqual(activeDriver.id, oldDriver.id);
  assert.equal(activeDriver.role, 'user');
  assert.equal(activeDriver.tenantId, replacementId);

  const points = await newDriver.request.get(origin + '/api/points');
  assert.equal(points.status(), 200);
  assert.deepEqual((await points.json()).points.map(point => point.id), [replacementPoint.id]);
  for (const old of [oldAdmin, oldDriver]) {
    assert.deepEqual(await readArchived(old.id), {
      id: old.id, tenant_id: tenantId, email: 'archived:' + old.id, enabled: false, archived_login_email: old.email,
    });
  }
  const {rowCount: archivedAssignments} = await pool.query(
    'SELECT 1 FROM cv_point_access WHERE tenant_id=$1 AND user_id=$2', [tenantId, oldDriver.id],
  );
  assert.equal(archivedAssignments, 1);

  await post(superadmin, '/api/auth/login', {email: adminEmail, password: contactPassword}, 401);
  await post(superadmin, '/api/auth/login', {email: driverEmail, password: updatedPassword}, 401);
  await inviteStatus(newAdmin, adminLink, 'invalid', false);
  await inviteStatus(newDriver, driverLink, 'invalid', false);
  const oldResetToken = new URL(oldPendingReset).searchParams.get('reset');
  await post(superadmin, '/api/auth/password-reset/confirm', {token: oldResetToken, password: updatedPassword}, 400);
  console.log('Browser verified reuse of archived login addresses with fresh accounts and only new tenant permissions, without reviving previous credentials or losing historical assignments.');
} finally {
  await browser.close();
  await pool.end();
}
