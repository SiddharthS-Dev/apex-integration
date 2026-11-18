// Browser check of the APEX admin console (apex/public/admin.html) against a mocked Core API: list,
// detail, approve (roles + platforms + confirmation), ask a question, reject, and the administrator-only
// gate. No servers or databases: requests are answered in the browser. Env: CHROME_PATH.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'inspironics-innovation-showcase/package.json'));
const puppeteer = require('puppeteer-core');
const HTML = fs.readFileSync(path.join(REPO, 'apex/public/admin.html'), 'utf8');
const SHOTS = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'apex-admin-ui-'));

let failures = 0;
let passes = 0;
const check = (name, ok, extra = '') => { if (ok) passes += 1; else failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ` — ${extra}` : ''}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const PLATFORMS = [
  { code: 'showcase', label: 'Innovation Showcase', description: '' },
  { code: 'slidesvault', label: 'SlidesVault', description: '' },
  { code: 'academia', label: 'Inspironics Academia', description: '' },
];
const rows = [
  { id: 'r1', full_name: 'Priya Sundar', email: 'priya@example.org', role_label: 'Intern', onboarding_role: 'INTERN', status: 'PENDING_APPROVAL', submitted_at: new Date(Date.now() - 3600e3).toISOString(), claimed_organization: null },
  { id: 'r2', full_name: 'Arun Kumar', email: 'arun@example.org', role_label: 'Vice President', onboarding_role: 'VP', status: 'PENDING_APPROVAL', submitted_at: new Date(Date.now() - 7200e3).toISOString(), claimed_organization: 'Umbrella' },
];
const detail = (r) => ({
  ...r,
  verification: { email: r.email, email_verified: true },
  requested: { onboarding_role: r.onboarding_role, role_label: r.role_label, claimed_organization: r.claimed_organization, platforms: ['slidesvault', 'academia'] },
  platform_catalogue: PLATFORMS,
  profile: { institution: 'Anna University <script>alert(1)</script>', academic_year: 'third' },
  profile_fields: [{ key: 'institution', label: 'College or university', type: 'text' }, { key: 'academic_year', label: 'Current academic year', type: 'enum' }],
  verification_note: 'Check the internship offer letter.',
  consent: { version: 'draft-1', accepted_at: r.submitted_at, adult_confirmed_at: r.submitted_at },
  advice: { source: 'rules', summary: 'Looks complete.', observations: [{ code: 'X', text: 'Email verified.' }] },
  clarification: {},
  decision: {},
  grantable_roles: r.onboarding_role === 'INTERN' ? ['learner', 'intern'] : ['learner'],
  default_roles: ['learner'],
});
const posts = [];
let admin = true;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    const json = (status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin') return req.respond({ status: 200, contentType: 'text/html', body: HTML });
    if (url.pathname === '/auth/me') return json(200, { email: 'admin@example.com', apps: ['academia'] });
    if (url.pathname.startsWith('/academia/api/core/registrations')) {
      if (!admin) return json(403, { error: 'Reviewing access requests requires platform administrator access' });
      const m = url.pathname.match(/registrations\/([^/]+)(?:\/(approve|reject|request-info))?$/);
      if (req.method() === 'POST' && m) {
        posts.push({ action: m[2], id: m[1], body: JSON.parse(req.postData() || '{}') });
        const row = rows.find((r) => r.id === m[1]);
        row.status = m[2] === 'approve' ? 'APPROVED' : m[2] === 'reject' ? 'REJECTED' : 'INFO_REQUESTED';
        return json(200, { status: row.status, password_chosen: true });
      }
      if (m) return json(200, detail(rows.find((r) => r.id === m[1])));
      const status = url.searchParams.get('status');
      const list = status === 'all' ? rows : status === 'reviewable' ? rows.filter((r) => ['PENDING_APPROVAL', 'INFO_REQUESTED'].includes(r.status)) : rows.filter((r) => r.status === status);
      return json(200, list);
    }
    if (url.pathname === '/logo.svg') return req.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    return req.respond({ status: 404, body: '' });
  });

  await page.goto('http://apex.test/admin', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.row');
  check('list shows the waiting requests', (await page.$$('.row')).length === 2);
  check('summary counts', (await page.$eval('#n-pending', (n) => n.textContent)) === '2');
  await page.waitForFunction(() => document.querySelector('#detail h2')?.textContent === 'Priya Sundar');
  check('the first request opens in the detail panel', true);
  const text = await page.$eval('#detail', (d) => d.innerText);
  check('detail: verification, requested platforms, profile, verification note', ['✓ verified', 'SlidesVault, Inspironics Academia', 'College or university', 'third', 'Check the internship offer letter'].every((t) => text.includes(t)));
  check('applicant text is shown as text, never run as HTML', text.includes('<script>alert(1)</script>') && errors.length === 0, errors.join('; '));
  await page.screenshot({ path: path.join(SHOTS, '01-console.png') });

  // Approve: nothing preselected for roles; requested platforms pre-ticked; confirmation required.
  await page.click('#detail .btn.primary');
  await page.waitForSelector('#dlg-approve[open]');
  check('approve: roles offered, none preselected', JSON.stringify(await page.$$eval('#ap-roles [data-role]', (l) => l.map((i) => [i.value, i.checked]))) === JSON.stringify([['learner', false], ['intern', false]]));
  check('approve: requested platforms pre-ticked', JSON.stringify(await page.$$eval('#ap-platforms [data-platform]:checked', (l) => l.map((i) => i.value))) === JSON.stringify(['slidesvault', 'academia']));
  await page.screenshot({ path: path.join(SHOTS, '02-approve.png') });
  await page.click('#ap-go');
  check('approve: confirmation required', (await page.$eval('#ap-err', (e) => e.textContent)).includes('Confirm'));
  await page.click('#ap-roles [value="learner"]');
  await page.click('#ap-confirm');
  await page.click('#ap-go');
  await page.waitForFunction(() => !document.querySelector('#dlg-approve[open]'));
  const ap = posts.find((p) => p.action === 'approve');
  check('approve: sends role, roles, platforms and confirmation', ap && ap.id === 'r1' && ap.body.onboarding_role === 'INTERN' && ap.body.confirm === true
    && JSON.stringify(ap.body.roles) === JSON.stringify([{ role: 'learner', scope_type: 'platform' }]) && JSON.stringify(ap.body.platforms) === JSON.stringify(['slidesvault', 'academia']), JSON.stringify(ap));
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1);
  check('approved request leaves the waiting list; toast shown', !(await page.$eval('#toast', (t) => t.hidden)));

  // Ask a question, then reject, on the other request.
  await (await page.$('.row')).click();
  await page.waitForFunction(() => document.querySelector('#detail h2')?.textContent === 'Arun Kumar');
  await page.$$eval('#detail .actions .btn', (l) => l.find((b) => b.textContent.startsWith('Ask')).click());
  await page.waitForSelector('#dlg-info[open]');
  await page.type('#in-q', 'Which division do you lead?');
  await page.$eval('#dlg-info form', (f) => f.requestSubmit());
  await page.waitForFunction(() => !document.querySelector('#dlg-info[open]'));
  check('ask a question', posts.some((p) => p.action === 'request-info' && p.body.question === 'Which division do you lead?'));
  await page.waitForFunction(() => document.querySelector('#detail .actions'));
  await page.$$eval('#detail .actions .btn', (l) => l.find((b) => b.textContent.startsWith('Reject')).click());
  await page.waitForSelector('#dlg-reject[open]');
  await page.type('#rj-reason', 'no');
  await page.$eval('#dlg-reject form', (f) => f.requestSubmit());
  check('reject: a meaningful reason is required', (await page.$eval('#rj-err', (e) => e.textContent)).includes('at least 5'));
  await page.type('#rj-reason', 't a fit right now');
  await page.$eval('#dlg-reject form', (f) => f.requestSubmit());
  await page.waitForFunction(() => !document.querySelector('#dlg-reject[open]'));
  check('reject', posts.some((p) => p.action === 'reject' && p.body.reason === 'not a fit right now'));

  // Someone who is not a platform administrator: the Core refuses, the page says so.
  admin = false;
  await page.goto('http://apex.test/admin', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.getElementById('gate').hidden);
  check('non-administrators see "Administrators only" and no requests', (await page.$eval('#gate', (g) => g.innerText)).includes('Administrators only') && (await page.$eval('#console', (c) => c.hidden)));
} catch (err) {
  check('flow completed', false, String(err.message).split('\n')[0]);
} finally {
  await browser.close();
}
console.log(`\n${passes}/${passes + failures} checks passed. Screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
