// End-to-end check of the Enterprise Onboarding Assistant (onboarding/, port 5180 in real use) in headless
// Chrome, against a DISPOSABLE Core API (a new temp SQLite file) — never the portal's database.
//
//   node tools/e2e/onboarding-app-ui.mjs
//
// The six-step card flow for an Intern: one consent line on the role step (no checkbox), About you, two role cards (quick
// ideas, chips, a follow-up that opens only after "Yes"), Back, Edit from the review, a segmented code,
// a password chosen in "About you" (hashed by the server), resume after reload. Then, in the built Academia web app (WEB_DIST,
// optional), a reviewer approves with only the allowed grants and the applicant signs in with the password
// chosen during onboarding (no invitation link). Env: CHROME_PATH, WEB_DIST (default E:/apex-review-tmp/academia-web-build).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'inspironics-innovation-showcase/package.json'));
const puppeteer = require('puppeteer-core');
const TMP = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'apex-onb-e2e-'));
const SHOTS = path.join(TMP, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const DB_FILE = path.join(TMP, 'core.db');
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const rows = (sql, params = []) => { const db = new DatabaseSync(DB_FILE, { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } };
const outbox = (to, kind) => rows('SELECT text_body FROM email_outbox WHERE to_email = ? AND kind = ? ORDER BY created_at DESC LIMIT 1', [to, kind])[0]?.text_body || '';

const corePort = await freePort();
const ADMIN = { email: 'admin.test@example.com', password: 'Adm1n-Test-Pass!' };
const children = [];
children.push(spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  cwd: path.join(REPO, 'Inspironics Academia/apps/api'), stdio: 'ignore', windowsHide: true,
  env: { ...process.env, NODE_ENV: 'development', PORT: String(corePort), HOST: '127.0.0.1', DATA_DIR: TMP, SQLITE_PATH: DB_FILE, DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false',
    JOBS_ENABLED: 'false', LOG_LEVEL: 'warn', ONBOARDING_ENABLED: 'true', SELF_REGISTRATION_ENABLED: 'true', BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password },
}));
for (let i = 0; i < 150; i += 1) { try { if ((await fetch(`http://127.0.0.1:${corePort}/api/health`)).ok) break; } catch { /* starting */ } await pause(200); }

const { createServer } = await import(pathToFileURL(path.join(REPO, 'onboarding/server.mjs')).href);
const appPort = await freePort();
const app = createServer({ port: appPort, corePort, publicUrl: `http://127.0.0.1:${appPort}` });
await new Promise((r) => app.listen(appPort, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${appPort}`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const problems = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  const W = '#log li:last-child .widget';
  const bot = (t) => page.waitForFunction((t) => [...document.querySelectorAll('.msg:not(.me) .bubble')].some((b) => b.textContent.includes(t) && !b.classList.contains('caret')), { timeout: 12000 }, t);
  const card = (title) => page.waitForFunction((t) => document.querySelector('#log li:last-child .widget h3')?.textContent === t, { timeout: 12000 }, title);
  const press = (text, scope = W) => page.$$eval(`${scope} button`, (l, t) => { const b = l.find((x) => x.textContent.trim() === t || x.textContent.includes(t)); if (!b) throw new Error(`no button ${t}`); b.click(); }, text);
  const fill = async (label, value) => {
    const id = await page.$$eval(`${W} label`, (l, t) => l.find((x) => x.textContent.startsWith(t))?.htmlFor, label);
    if (!id) throw new Error(`no field ${label}`);
    await page.$eval(`[id="${id}"]`, (i) => { i.value = ''; });
    await page.type(`[id="${id}"]`, value);
  };
  const valueOf = (label) => page.$$eval(`${W} label`, (l, t) => document.getElementById(l.find((x) => x.textContent.startsWith(t))?.htmlFor)?.value, label);

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await bot('just six quick steps');
  check('animated assistant online, six-step stepper', (await page.$eval('#status-text', (e) => e.textContent)) === 'Online' && (await page.$$('#stepper li')).length === 6);
  check('no password field before "About you"', (await page.$$('input[type=password]')).length === 0);
  await card('Choose your role');
  check('exactly the six roles', JSON.stringify(await page.$$eval(`${W} .role strong`, (l) => l.map((x) => x.textContent))) === JSON.stringify(['Intern', 'Alumni / Former Member', 'Industry Partner', 'Chief Executive Officer', 'Vice President', 'Director']));
  await page.screenshot({ path: path.join(SHOTS, '01-roles.png') });
  check('no consent checkbox or draft badge; one consent line instead', !(await page.$('#agree')) && !(await page.$(`${W} .draft`)) && /18 or older/.test(await page.$eval(`${W} .consent-note`, (n) => n.textContent)));
  await press('Intern');
  await bot("I'll only ask what's relevant");
  await card('About you');
  check('name, email, password and confirmation asked together in one step', (await page.$$(`${W} input`)).length === 4 && (await page.$$(`${W} input[type=password]`)).length === 2);
  check('APEX platform question with the three platforms', JSON.stringify(await page.$$eval(`${W} .platform strong`, (l) => l.map((x) => x.textContent))) === JSON.stringify(['Solution Explorer', 'Presentation Library', 'Learning Hub']));
  check('no stray "null" text under the fields', !/null/.test(await page.$eval(W, (w) => w.innerText)));
  await fill('Full name', 'Priya Sundar');
  await fill('Email', 'not-an-email');
  await press('Continue');
  check('email validated with an actionable message', (await page.$$eval(`${W} .err`, (l) => l.map((e) => e.textContent))).some((t) => t.includes('valid email')));
  check('at least one platform is required', (await page.$$eval(`${W} .err`, (l) => l.map((e) => e.textContent))).includes('Choose at least one.'));
  await fill('Email', 'priya.intern@example.org');
  await fill('Create a password', 'Priya-pass-2026');
  await fill('Confirm password', 'Priya-pass-2027');
  await press('Continue');
  check('password confirmation must match', (await page.$$eval(`${W} .err`, (l) => l.map((e) => e.textContent))).includes('The passwords do not match.'));
  await fill('Confirm password', 'Priya-pass-2026');
  await page.click(`${W} .pw .eye`);
  check('the eye shows the password and hides it again', (await page.$eval(`${W} .pw input`, (i) => i.type)) === 'text');
  await page.click(`${W} .pw .eye`);
  check('password hidden again', (await page.$eval(`${W} .pw input`, (i) => i.type)) === 'password');
  await press('Presentation Library');
  await press('Learning Hub');
  await press('Solution Explorer');
  await press('Solution Explorer'); // tapping again removes it: two platforms chosen
  check('several platforms can be chosen and one removed', (await page.$$eval(`${W} .platform[aria-pressed="true"] strong`, (l) => l.map((x) => x.textContent))).join() === 'Presentation Library,Learning Hub');
  await (await page.$(W)).screenshot({ path: path.join(SHOTS, '01b-about-you.png') });
  await press('Continue');
  await card('Your studies');
  await press('+ Anna University');
  await press('+ IIT Madras');
  check('a single-answer field keeps one suggestion', (await valueOf('College or university')) === 'IIT Madras');
  await press('+ Anna University');
  // Paragraph fields: suggestions are a multi-select (add, add, remove).
  await press('+ Python, SQL');
  await press('+ Machine learning basics');
  check('several suggestions can be chosen together', (await valueOf('Relevant skills')) === 'Python, SQL; Machine learning basics');
  await press('✓ Python, SQL');
  check('tapping a chosen suggestion removes it', (await valueOf('Relevant skills')) === 'Machine learning basics');
  await fill('Degree and specialisation', 'B.E. Computer Science');
  await press('Final year');
  await press('Continue');
  await card('Your internship');
  // Back returns to the previous card with its answers kept.
  await page.click('#back');
  await card('Your studies');
  check('Back reopens the previous card with answers kept', (await valueOf('College or university')) === 'Anna University');
  await press('Continue');
  await card('Your internship');
  check('mentor name hidden until a mentor is assigned', !(await page.$$eval(`${W} label`, (l) => l.some((x) => x.textContent.startsWith('Assigned mentor')))));
  await fill('Internship department', 'Engineering');
  await press('3 to 6 months');
  await press('Yes');
  await page.waitForFunction((w) => [...document.querySelectorAll(`${w} label`)].some((x) => x.textContent.startsWith('Assigned mentor')), { timeout: 5000 }, W);
  check('follow-up opens in place after "Yes"', true);
  await page.screenshot({ path: path.join(SHOTS, '02-card.png') });
  await fill('Assigned mentor', 'R. Kumar');
  await press('Continue');
  await card('Review and confirm');
  await page.screenshot({ path: path.join(SHOTS, '03-review.png') });
  const summary = await page.$eval(W, (w) => w.innerText);
  check('review shows role, personal and professional details', ['Intern', 'Priya Sundar', 'priya.intern@example.org', 'Anna University', 'R. Kumar', 'Final year'].every((t) => summary.includes(t)));
  check('review shows the chosen APEX platforms', summary.includes('Presentation Library, Learning Hub'));
  check('no phone or address collected; the password is never shown', !/phone|address/i.test(summary) && !summary.includes('Priya-pass-2026') && summary.includes('(set)'));
  await page.$eval(`${W} button[aria-label="Edit personal information"]`, (b) => b.click());
  await card('About you');
  await fill('Full name', 'Priya S. Sundar');
  await press('Continue');
  await card('Review and confirm');
  check('Edit returns straight to the review', (await page.$eval(W, (w) => w.innerText)).includes('Priya S. Sundar'));
  check('only 6 steps: about you is one card', (await page.$$('#stepper li')).length === 6);

  await press('Confirm and Submit');
  await card('Verify your email');
  await page.type(`${W} .otp input`, '000000');
  await page.waitForFunction((w) => document.querySelector(`${w} .err`)?.textContent.length > 0, { timeout: 10000 }, W);
  check('wrong code refused, attempts shown', (await page.$eval('#code-hint', (e) => e.textContent)).includes('4 attempts'));
  const code = outbox('priya.intern@example.org', 'onboarding_code').match(/\b(\d{6})\b/)[1];
  await page.$eval(`${W} .otp input`, (i, c) => { i.value = c; i.dispatchEvent(new Event('input', { bubbles: true })); }, code);
  await bot('Your onboarding request has been submitted successfully.');
  await card('What happens next');
  await pause(900);
  await page.screenshot({ path: path.join(SHOTS, '04-done.png') });
  check('codes never appear in the conversation', !/\b\d{6}\b/.test(await page.$eval('#log', (l) => l.textContent)));
  const [req] = rows("SELECT status, full_name, category_profile FROM registration_requests WHERE email = 'priya.intern@example.org'");
  const profile = JSON.parse(req?.category_profile || '{}');
  check('request stored for review with the role and follow-up', req?.status === 'PENDING_APPROVAL' && req.full_name === 'Priya S. Sundar' && profile.onboarding_role === 'INTERN' && profile.mentor_name === 'R. Kumar');
  check('no account before approval', rows("SELECT id FROM users WHERE email = 'priya.intern@example.org'").length === 0);
  check('no browser storage', await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));
  await page.reload({ waitUntil: 'networkidle0' });
  await bot('waiting for review');
  check('reload resumes at the submitted state', true);

  const phone = await browser.newPage();
  await phone.setViewport({ width: 375, height: 760, isMobile: true });
  await phone.goto(BASE, { waitUntil: 'networkidle0' });
  await pause(1500);
  check('no horizontal scroll on a phone', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await phone.screenshot({ path: path.join(SHOTS, '05-phone.png') });
  check('no console errors', problems.length === 0, problems.slice(0, 2).join(' | '));

  const dist = process.env.WEB_DIST || 'E:/apex-review-tmp/academia-web-build';
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    const webPort = await freePort();
    children.push(spawn(process.execPath, [path.join(REPO, 'Inspironics Academia/node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: path.join(REPO, 'Inspironics Academia/apps/web'), env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${corePort}` }, stdio: 'ignore', windowsHide: true }));
    const WEB = `http://127.0.0.1:${webPort}`;
    for (let i = 0; i < 100; i += 1) { try { if ((await fetch(WEB)).ok) break; } catch { /* starting */ } await pause(200); }
    const signIn = async (p, email, password) => {
      await p.goto(`${WEB}/login`, { waitUntil: 'networkidle0' });
      await p.type('#email', email); await p.type('#password', password);
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), p.click('button[type=submit]')]);
      await pause(500);
    };
    const admin = await (await browser.createBrowserContext()).newPage();
    await admin.setViewport({ width: 1366, height: 1000 });
    await signIn(admin, ADMIN.email, ADMIN.password);
    await admin.goto(`${WEB}/admin/access?tab=requests`, { waitUntil: 'networkidle0' });
    await admin.waitForFunction(() => document.body.innerText.includes('Priya S. Sundar'), { timeout: 15000 });
    await (await admin.waitForSelector('::-p-xpath(//button[normalize-space(.)="Open"])')).click();
    await admin.waitForFunction(() => document.body.innerText.includes('Verify before approving'), { timeout: 10000 });
    await (await admin.waitForSelector('::-p-xpath(//button[contains(normalize-space(.), "Approve")])')).click();
    await admin.waitForSelector('[role=dialog]');
    const offered = await admin.$$eval('[role=dialog] fieldset:nth-of-type(1) label', (l) => l.map((x) => x.textContent.split('—')[0].trim()));
    const preticked = await admin.$$eval('[role=dialog] fieldset:nth-of-type(1) input[type=checkbox]:checked', (l) => l.length);
    check('reviewer: only Learner and Intern offered, nothing preselected', JSON.stringify(offered) === JSON.stringify(['Learner', 'Intern']) && preticked === 0, offered.join(', '));
    const platformTicks = await admin.$$eval('[role=dialog] fieldset:nth-of-type(2) label', (l) => l.filter((x) => x.querySelector('input').checked).map((x) => x.textContent.split('—')[0].trim()));
    check('reviewer: the requested platforms are pre-ticked', platformTicks.join() === 'Presentation Library,Learning Hub', platformTicks.join(', '));
    await (await admin.waitForSelector('::-p-xpath(//*[@role="dialog"]//label[contains(., "Learner")]/input)')).click();
    await (await admin.waitForSelector('::-p-xpath(//*[@role="dialog"]//label[contains(., "I have checked")]/input)')).click();
    await (await admin.waitForSelector('::-p-xpath(//button[normalize-space(.)="Approve and create account"])')).click();
    await admin.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 10000 });
    await pause(500);
    check('approval sent "approved, sign in" (no set-password link: the password was chosen at onboarding)',
      /approved/i.test(outbox('priya.intern@example.org', 'onboarding_approved') || '') && !outbox('priya.intern@example.org', 'invite'));
    const person = await (await browser.createBrowserContext()).newPage();
    await signIn(person, 'priya.intern@example.org', 'Priya-pass-2026');
    check('applicant signs in with the password chosen during onboarding', !(await person.url()).includes('/login'));
    const mine = await person.evaluate(async () => (await (await fetch('/api/core/me', { credentials: 'include' })).json()).platforms);
    check('the person\'s APEX home platforms are the approved ones', JSON.stringify(mine) === JSON.stringify(['slidesvault', 'academia']), JSON.stringify(mine));
  } else console.log(`SKIP reviewer phase: no build at ${dist}`);
} catch (err) {
  check('flow completed', false, String(err.message).split('\n')[0]);
  for (const pg of await browser.pages()) {
    try { console.log('LAST:', (await pg.$$eval('#log li', (l) => l.slice(-3).map((x) => x.innerText.slice(0, 160)))).join(' || ')); } catch { /* other page */ }
  }
} finally {
  await browser.close();
  app.close();
  for (const c of children) c.kill();
  await pause(300);
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exitCode = failed ? 1 : 0;
}
