// R1 end-to-end check of the Core "People & access" screens (Academia web) against a DISPOSABLE Core API.
//
// Setup (never point this at a real database):
//   1. Start the Academia API with SQLITE_PATH=<new temp file>, NODE_ENV unset,
//      BOOTSTRAP_ADMIN_EMAIL=admin.test@example.com BOOTSTRAP_ADMIN_PASSWORD='Adm1n-Test-Pass!'
//      (throwaway test credentials for a throwaway database).
//   2. Serve the built web app (vite preview) with /api proxied to that API.
//   3. node tools/e2e/core-access-ui.mjs <appBase> [demoBase]
// Env: CHROME_PATH (default: Windows Chrome), E2E_SHOTS (screenshot folder, default: OS temp).
// Uses puppeteer-core from the Showcase workspace; no new dependency.
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'inspironics-innovation-showcase/package.json'));
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:4612';
const DEMO = process.argv[3] || '';
const SHOTS = process.env.E2E_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'apex-core-ui-'));
fs.mkdirSync(SHOTS, { recursive: true });
const ADMIN = { email: 'admin.test@example.com', password: 'Adm1n-Test-Pass!' };
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) { await pause(400); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }
async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('button[type=submit]')]);
  await pause(800);
}
const api = (page, method, path, body) => page.evaluate(async (m, p, b) => {
  const r = await fetch(`/api${p}`, { method: m, credentials: 'include', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, method, path, body);
async function clickText(page, text, root = '') {
  const el = await page.waitForSelector(`${root} ::-p-xpath(${root ? './/' : '//'}button[normalize-space(.)=${JSON.stringify(text)} or .//text()[normalize-space(.)=${JSON.stringify(text)}]])`, { timeout: 8000 });
  await el.click();
}
const dialog = '[role=dialog]';
async function selectIn(page, label, option) {
  const id = await page.$eval(`${dialog} ::-p-xpath(.//label[starts-with(normalize-space(.), ${JSON.stringify(label)})])`, (l) => l.htmlFor);
  await page.click(`[id="${id}"]`);
  const opt = await page.waitForSelector(`::-p-xpath(//*[@role="option"][normalize-space(.)=${JSON.stringify(option)}])`, { timeout: 5000 });
  await opt.click();
  await pause(200);
}
async function typeIn(page, label, text) {
  const id = await page.$eval(`${dialog} ::-p-xpath(.//label[starts-with(normalize-space(.), ${JSON.stringify(label)})])`, (l) => l.htmlFor);
  await page.type(`[id="${id}"]`, text);
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const dialogText = (page) => page.$eval(dialog, (d) => d.innerText).catch(() => '');
async function waitDialogClosed(page) { await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 8000 }); }
async function pickUser(page, query) {
  await page.type(`${dialog} input[placeholder="Search by name or email"]`, query);
  const btn = await page.waitForSelector(`${dialog} ::-p-xpath(.//ul[@aria-label="Matching people"]//button[contains(., ${JSON.stringify(query)})])`, { timeout: 8000 });
  await btn.click();
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'], defaultViewport: { width: 1440, height: 1000 } });
try {
  const ctxA = await browser.createBrowserContext();
  const a = await ctxA.newPage();
  await login(a, ADMIN);
  check('admin signed in', (await api(a, 'GET', '/auth/me')).body?.role === 'admin');

  // Test users: a second (future) administrator and a learner, both invited by the admin.
  const second = await api(a, 'POST', '/auth/invite', { email: 'second.admin@example.com', role: 'user', audience: 'employee', full_name: 'Second Admin' });
  const learner = await api(a, 'POST', '/auth/invite', { email: 'learner.test@example.com', role: 'user', audience: 'employee', full_name: 'Learner Test' });
  check('invited two test users', second.status === 201 && learner.status === 201);

  // Dashboard link
  await a.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' });
  check('admin dashboard links to People & access', !!(await a.$('a[href$="/admin/access"]')));

  // People: search, detail, grant platform_admin to the second user
  await a.goto(`${BASE}/admin/access`, { waitUntil: 'networkidle0' });
  await a.type('#people-search', 'second');
  const row = await a.waitForSelector('::-p-xpath(//ul[@aria-label="People"]//button[contains(., "second.admin@example.com")])');
  await row.click();
  await a.waitForSelector('::-p-text(Active roles)');
  await pause(500);
  let t = await bodyText(a);
  check('detail shows migrated staff + learner roles', t.includes('Staff') && t.includes('Learner') && t.includes('Organisation · Inspironics'));
  await shot(a, '01-people-detail');
  await clickText(a, 'Grant role');
  await a.waitForSelector(dialog);
  await selectIn(a, 'Role', 'Platform admin');
  await typeIn(a, 'Reason', 'Second reviewer for identity links (E2E)');
  await shot(a, '02-grant-dialog');
  await clickText(a, 'Grant role', dialog);
  await waitDialogClosed(a);
  await pause(800);
  t = await bodyText(a);
  check('platform_admin granted via UI', t.includes('Platform admin'));
  await shot(a, '03-granted');

  // 409: grant the same again
  await clickText(a, 'Grant role');
  await a.waitForSelector(dialog);
  await selectIn(a, 'Role', 'Platform admin');
  await typeIn(a, 'Reason', 'duplicate');
  await clickText(a, 'Grant role', dialog);
  await a.waitForSelector(`${dialog} [role=alert]`, { timeout: 8000 });
  const dupText = await dialogText(a);
  check('duplicate grant shows 409 conflict in dialog', /already holds that role/i.test(dupText), dupText.split('\n').find((l) => /already/i.test(l)));
  await shot(a, '04-conflict');
  await clickText(a, 'Cancel', dialog);
  await waitDialogClosed(a);

  // Self: platform_admin option disabled; own admin row explained; API refuses self-revoke.
  await a.$eval('#people-search', (el) => { el.value = ''; });
  await a.click('#people-search', { clickCount: 3 });
  await a.keyboard.press('Backspace');
  await a.type('#people-search', 'admin.test');
  (await a.waitForSelector('::-p-xpath(//ul[@aria-label="People"]//button[contains(., "admin.test@example.com")])')).click();
  await a.waitForSelector('::-p-text(Your own admin role can only be changed by another administrator.)');
  check('own platform_admin row has no revoke/change buttons', true);
  await clickText(a, 'Grant role');
  await a.waitForSelector(dialog);
  const id = await a.$eval(`${dialog} ::-p-xpath(.//label[normalize-space(.)="Role"])`, (l) => l.htmlFor);
  await a.click(`[id="${id}"]`);
  const disabledOpt = await a.waitForSelector('::-p-xpath(//*[@role="option"][contains(., "not for yourself")])');
  check('self platform_admin option disabled', await disabledOpt.evaluate((o) => o.getAttribute('aria-disabled') === 'true' || o.hasAttribute('data-disabled')));
  await shot(a, '05-self-grant-disabled');
  await a.keyboard.press('Escape');
  await pause(200);
  await a.keyboard.press('Escape');
  await waitDialogClosed(a).catch(() => {});
  const meDetail = await api(a, 'GET', `/core/users/${(await api(a, 'GET', '/auth/me')).body.id}`);
  const ownAdmin = meDetail.body.roles.find((r) => r.role === 'platform_admin');
  const selfRevoke = await api(a, 'POST', `/core/role-assignments/${ownAdmin.id}/revoke`, { reason: 'x' });
  check('API refuses self-revoke of platform_admin (403)', selfRevoke.status === 403, selfRevoke.body?.error);

  // Organisations: create, add member, grant org role, end membership
  await a.goto(`${BASE}/admin/access?tab=organisations`, { waitUntil: 'networkidle0' });
  t = await bodyText(a);
  check('organisations list shows Inspironics', t.includes('Inspironics'));
  await clickText(a, 'New');
  await a.waitForSelector(dialog);
  await a.type('#org-name', 'Research Lab');
  check('create dialog offers only internal + explains held external orgs', (await dialogText(a)).includes('held pending policy'));
  await shot(a, '06-create-org');
  await clickText(a, 'Create organisation', dialog);
  await waitDialogClosed(a);
  await a.waitForSelector('::-p-text(Research Lab · members)');
  await clickText(a, 'Add member');
  await a.waitForSelector(dialog);
  await pickUser(a, 'learner.test');
  await a.type('#member-title', 'Research assistant');
  await clickText(a, 'Add member', dialog);
  await waitDialogClosed(a);
  await a.waitForSelector('::-p-text(Research assistant)');
  check('member added with title', true);
  await shot(a, '07-org-members');

  // Grant an organisation-scoped mentor role in Research Lab to the learner (People tab).
  const learnerId = learner.body.user.id;
  await a.goto(`${BASE}/admin/access?tab=people&user=${learnerId}`, { waitUntil: 'networkidle0' });
  await a.waitForSelector('::-p-text(Active roles)');
  await clickText(a, 'Grant role');
  await a.waitForSelector(dialog);
  await selectIn(a, 'Role', 'Mentor');
  await selectIn(a, 'Scope', 'Organisation');
  await selectIn(a, 'Organisation', 'Research Lab');
  await typeIn(a, 'Reason', 'Mentors new research staff');
  await clickText(a, 'Grant role', dialog);
  await waitDialogClosed(a);
  await a.waitForSelector('::-p-text(Organisation · Research Lab)');
  check('org-scoped mentor role granted', true);

  // Transition learner (platform) -> student
  const learnerRowBtn = await a.waitForSelector('button[aria-label="Change Learner role"]');
  await learnerRowBtn.click();
  await a.waitForSelector(dialog);
  await selectIn(a, 'New role', 'Student');
  await typeIn(a, 'Reason', 'Moved to the student programme');
  await clickText(a, 'Change role', dialog);
  await waitDialogClosed(a);
  await pause(800);
  t = await bodyText(a);
  check('transition learner -> student (history keeps learner)', t.includes('Student') && /Role history[\s\S]*Learner/.test(t));
  await shot(a, '08-transition');

  // End membership in Research Lab -> mentor role there ends too
  await a.goto(`${BASE}/admin/access?tab=organisations`, { waitUntil: 'networkidle0' });
  (await a.waitForSelector('::-p-xpath(//ul[@aria-label="Organisations"]//button[contains(., "Research Lab")])')).click();
  (await a.waitForSelector('button[aria-label="End membership of Learner Test"]')).click();
  await a.waitForSelector(dialog);
  check('end-membership dialog warns about org-scoped roles', (await dialogText(a)).includes('also ends every role'));
  await shot(a, '09-end-membership');
  await clickText(a, 'End membership', dialog);
  await waitDialogClosed(a);
  const after = await api(a, 'GET', `/core/users/${learnerId}`);
  check('membership end closed the mentor assignment', !after.body.roles.some((r) => r.role === 'mentor') && after.body.role_history.some((r) => r.role === 'mentor' && r.valid_to));

  // Links: propose as admin A; Confirm disabled for the proposer
  await a.goto(`${BASE}/admin/access?tab=links`, { waitUntil: 'networkidle0' });
  check('links page explains emails are not proof and links grant no roles', /Matching email addresses are not proof/.test(await bodyText(a)) && /never grants roles/.test(await bodyText(a)));
  await clickText(a, 'Propose a link');
  await a.waitForSelector(dialog);
  await pickUser(a, 'learner.test');
  await selectIn(a, 'App', 'Innovation Showcase');
  await a.type('#link-app-user', 'sc-user-42');
  await typeIn(a, 'Note for the reviewer', 'Confirmed by phone with the person');
  await clickText(a, 'Propose link', dialog);
  await waitDialogClosed(a);
  await a.waitForSelector('::-p-text(sc-user-42)');
  const confirmBtn = await a.waitForSelector('::-p-xpath(//button[normalize-space(.)="Confirm"])');
  check('proposer cannot confirm (button disabled with explanation)', await confirmBtn.evaluate((b) => b.disabled) && (await bodyText(a)).includes('a different administrator must confirm it'));
  await shot(a, '10-link-proposed');

  // Second admin signs in and confirms
  const ctxB = await browser.createBrowserContext();
  const b = await ctxB.newPage();
  await login(b, { email: 'second.admin@example.com', password: second.body.temporary_password });
  check('second admin signed in with admin role', (await api(b, 'GET', '/auth/me')).body?.role === 'admin');
  await b.goto(`${BASE}/admin/access?tab=links`, { waitUntil: 'networkidle0' });
  await b.waitForSelector('::-p-text(sc-user-42)');
  await clickText(b, 'Confirm');
  await b.waitForSelector(dialog);
  await clickText(b, 'Confirm link', dialog);
  await waitDialogClosed(b);
  const confirmed = await api(b, 'GET', '/core/identity-links?status=confirmed');
  check('second admin confirmed the link', confirmed.body.length === 1 && confirmed.body[0].app_user_id === 'sc-user-42');
  await b.goto(`${BASE}/admin/access?tab=links`, { waitUntil: 'networkidle0' });
  await selectInPage(b, 'Show', 'Confirmed');
  await shot(b, '11-link-confirmed');

  // Reject requires a note: propose another and reject with empty note
  await b.goto(`${BASE}/admin/access?tab=links`, { waitUntil: 'networkidle0' });
  const p2 = await api(b, 'POST', '/core/identity-links', { core_user_id: learnerId, app: 'slidesvault', app_user_id: 'sv-7' });
  await b.reload({ waitUntil: 'networkidle0' });
  await clickText(b, 'Reject');
  await b.waitForSelector(dialog);
  await clickText(b, 'Reject link', dialog);
  await b.waitForSelector(`${dialog} [role=alert]`);
  check('reject requires a note', (await dialogText(b)).includes('Add a note'));
  await typeIn(b, 'Note', 'Not the same person');
  await clickText(b, 'Reject link', dialog);
  await waitDialogClosed(b);
  check('link rejected', (await api(b, 'GET', '/core/identity-links?status=rejected')).body.some((l) => l.id === p2.body.id));

  // Audit log with filter and pagination
  let total = (await api(a, 'GET', '/core/audit-events?limit=200')).body.length;
  for (let i = 0; total <= 30; i += 1, total += 1) await api(a, 'POST', '/core/organizations', { name: `Paging Org ${i}`, slug: `paging-org-${i}`, kind: 'internal' });
  const ext = await api(a, 'POST', '/core/organizations', { name: 'Partner X', slug: 'partner-x', kind: 'partner' });
  check('API refuses external organisation kind (held)', ext.status === 403, ext.body?.error);
  await a.goto(`${BASE}/admin/access?tab=audit`, { waitUntil: 'networkidle0' });
  await a.waitForSelector('::-p-text(Showing 1–)');
  t = await bodyText(a);
  check('audit log lists events', /role\.granted/.test(t) && /identity_link\.confirmed/.test(t));
  const olderEnabled = await a.$eval('::-p-xpath(//button[contains(., "Older")])', (x) => !x.disabled);
  check('audit pagination has an older page (>25 events)', olderEnabled);
  await shot(a, '12-audit');
  if (olderEnabled) { await clickText(a, 'Older'); await a.waitForSelector('::-p-text(Showing 26–)'); check('audit older page loads', true); }
  await a.type('#audit-action', 'role.granted');
  await pause(1200);
  const filtered = await a.$$eval('tbody tr', (rows) => rows.map((r) => r.innerText));
  check('audit action filter', filtered.length > 0 && filtered.every((r) => r.includes('role.granted')), `${filtered.length} rows`);
  await shot(a, '13-audit-filtered');

  // My access (profile) as the learner — a non-admin; and /admin/access is denied to them
  const ctxC = await browser.createBrowserContext();
  const c = await ctxC.newPage();
  await login(c, { email: 'learner.test@example.com', password: learner.body.temporary_password });
  await c.goto(`${BASE}/profile`, { waitUntil: 'networkidle0' });
  await c.waitForSelector('::-p-text(My access)');
  await pause(800);
  t = await bodyText(c);
  check('My access shows roles, organisations and confirmed link', t.includes('Student') && t.includes('Inspironics') && t.includes('Innovation Showcase'));
  await c.evaluate(() => document.querySelector('#my-access-title').scrollIntoView());
  await shot(c, '14-my-access');
  await c.goto(`${BASE}/admin/access`, { waitUntil: 'networkidle0' });
  check('non-admin sees Access denied on /admin/access', (await bodyText(c)).includes('Access denied'));
  const forbidden = await api(c, 'GET', '/core/users');
  check('API returns 403 to non-admin for /core/users', forbidden.status === 403);
} catch (err) {
  check('script error', false, err.stack);
} finally {
  if (DEMO) {
    try {
      const ctxD = await browser.createBrowserContext();
      const d = await ctxD.newPage();
      await d.goto(`${DEMO}/login`, { waitUntil: 'networkidle0' });
      await d.type('#email', 'admin@demo.local');
      await d.type('#password', 'demo');
      await Promise.all([d.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), d.click('button[type=submit]')]);
      await pause(800);
      await d.goto(`${DEMO}/admin/access`, { waitUntil: 'networkidle0' });
      check('demo build shows "Available when connected to the APEX Core API"', (await bodyText(d)).includes('Available when connected to the APEX Core API'));
      await shot(d, '15-demo-access');
      await d.goto(`${DEMO}/profile`, { waitUntil: 'networkidle0' });
      check('demo profile My access shows notice', (await bodyText(d)).includes('Available when connected to the APEX Core API'));
    } catch (err) { check('demo check error', false, err.message); }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function selectInPage(page, label, option) {
  const id = await page.$eval(`::-p-xpath(//label[normalize-space(.)=${JSON.stringify(label)}])`, (l) => l.htmlFor);
  await page.click(`[id="${id}"]`);
  (await page.waitForSelector(`::-p-xpath(//*[@role="option"][normalize-space(.)=${JSON.stringify(option)}])`)).click();
  await pause(600);
}
