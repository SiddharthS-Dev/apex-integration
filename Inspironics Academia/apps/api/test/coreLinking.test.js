import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Account-holder ownership proof (R1 linking addendum, ADR 0003 item 4): POST /api/core/link-challenges
// and POST /api/core/identity-links/possession, both gateway-service-only.
const k1 = crypto.randomBytes(32).toString('base64');
const h = await startHarness('core-linking', {
  APEX_IDENTITY_KEYS: JSON.stringify({ k1 }), APEX_IDENTITY_ISSUER: 'apex-gateway', APEX_IDENTITY_TRUSTED_SOURCES: 'loopback',
  LOGIN_MAX_FAILURES: '3',
});
const { signAssertion } = await import('../src/core/index.js');
const db = h.db;

const now = () => Math.floor(Date.now() / 1000);
const svc = (over = {}) => ({ 'X-Apex-Service': signAssertion({ iss: 'apex-gateway', aud: 'core', iat: now(), exp: now() + 60, ...over }, 'k1', k1) });
const gateway = h.client();
const challenge = (body, headers = svc()) => gateway.call('POST', '/core/link-challenges', body, headers);
const possess = (body, headers = svc()) => gateway.call('POST', '/core/identity-links/possession', body, headers);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const audits = (action, targetId) => db.query('SELECT * FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at', [action, targetId]);
const challengeRow = async (id) => (await db.query('SELECT * FROM link_challenges WHERE id = ?', [id]))[0];
const roleRows = async (id) => (await db.query('SELECT id, role, scope_type, scope_id, valid_to FROM role_assignments WHERE user_id = ? ORDER BY id', [id]));

const users = {};
let admin;
async function makeUser(name) {
  const r = await admin.ok('POST', '/auth/invite', { email: `${name}@example.com`, full_name: name });
  const c = h.client();
  await c.ok('POST', '/auth/login', { email: `${name}@example.com`, password: r.temporary_password });
  users[name] = { id: r.user.id, password: r.temporary_password, client: c };
  return users[name];
}

before(async () => {
  admin = await h.register('ada@example.com');
  for (const n of ['lee', 'kim', 'max', 'zoe', 'dan']) await makeUser(n);
});
after(() => h.stop());

/** Challenge + possession for user `u`; returns both responses. */
async function link(u, app, appUserId) {
  const c = await challenge({ sub: u.id, app, core_password: u.password });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const p = await possess({ sub: u.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app, app_user_id: appUserId });
  return { c, p };
}

let leeChallenge;

test('successful link: challenge, possession, confirmed link in /me and resolve; no roles granted; audited', async () => {
  const lee = users.lee;
  const rolesBefore = await roleRows(lee.id);
  const c = await challenge({ sub: lee.id, app: 'showcase', core_password: lee.password });
  assert.equal(c.status, 201);
  assert.deepEqual(Object.keys(c.data).sort(), ['app', 'challenge_id', 'expires_at', 'id', 'nonce']);
  assert.equal(c.data.id, c.data.challenge_id);
  assert.equal(c.data.app, 'showcase');
  assert.match(c.data.nonce, /^[A-Za-z0-9_-]{43}$/, '32 bytes, base64url');
  const ttl = Date.parse(c.data.expires_at) - Date.now();
  assert.ok(ttl > 4 * 60_000 && ttl <= 5 * 60_000, 'expires in 5 minutes');
  const row = await challengeRow(c.data.challenge_id);
  assert.equal(row.nonce_hash, sha(c.data.nonce), 'only the SHA-256 is stored');
  assert.ok(!JSON.stringify(row).includes(c.data.nonce), 'the nonce itself is not stored');
  assert.equal(row.action, 'link');
  assert.equal(row.used_at, null);
  assert.equal((await audits('link.challenge_created', c.data.challenge_id)).length, 1);

  const p = await possess({ sub: lee.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'showcase', app_user_id: 'sc-1' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.linked, true);
  assert.equal(p.data.app, 'showcase');
  assert.equal(p.data.app_user_id, 'sc-1');
  assert.equal(p.data.evidence, 'possession');
  assert.equal(p.data.result, 'created');
  const [l] = await db.query('SELECT * FROM identity_links WHERE id = ?', [p.data.link_id]);
  assert.equal(l.status, 'confirmed');
  assert.equal(l.evidence, 'possession');
  assert.equal(l.proposed_by, lee.id);
  assert.equal(l.reviewed_by, lee.id);
  const used = await challengeRow(c.data.challenge_id);
  assert.ok(used.used_at);
  assert.equal(used.outcome, 'confirmed');

  const me = await lee.client.ok('GET', '/core/me');
  assert.deepEqual(me.links.map((x) => [x.app, x.app_user_id, x.evidence]), [['showcase', 'sc-1', 'possession']]);
  const r = await gateway.ok('POST', '/core/identity/resolve', { sub: lee.id }, svc());
  assert.deepEqual(r.links, { showcase: 'sc-1', slidesvault: null });
  assert.deepEqual(await roleRows(lee.id), rolesBefore, 'linking grants no roles');
  const [ev] = await audits('link.confirmed_by_possession', p.data.link_id);
  assert.equal(ev.actor_user_id, lee.id);
  assert.equal(ev.actor_kind, 'gateway');
  assert.equal(JSON.parse(ev.detail).challenge_id, c.data.challenge_id);
  leeChallenge = { ...c.data, app_user_id: 'sc-1' };
});

test('replay: a consumed challenge fails even with the right nonce', async () => {
  const p = await possess({ sub: users.lee.id, challenge_id: leeChallenge.challenge_id, nonce: leeChallenge.nonce, app: 'showcase', app_user_id: 'sc-1' });
  assert.equal(p.status, 409);
  assert.equal(p.data.reason, 'replayed');
  const rejected = await audits('link.rejected', leeChallenge.challenge_id);
  assert.equal(JSON.parse(rejected.at(-1).detail).reason, 'replayed');
});

test('wrong Core password: 401, audited, no challenge created', async () => {
  const dan = users.dan;
  const n = async () => Number((await db.query('SELECT COUNT(*) AS n FROM link_challenges WHERE core_user_id = ?', [dan.id]))[0].n);
  const r = await challenge({ sub: dan.id, app: 'showcase', core_password: 'not-the-password' });
  assert.equal(r.status, 401);
  assert.equal(r.data.reason, 'wrong_core_password');
  assert.ok(!('nonce' in r.data));
  assert.equal(await n(), 0);
  const [ev] = await audits('link.challenge_failed', dan.id);
  assert.equal(JSON.parse(ev.detail).reason, 'wrong_core_password');
  // A correct attempt clears the failure count (as legacy sign-in does).
  assert.equal((await challenge({ sub: dan.id, app: 'showcase', core_password: dan.password })).status, 201);
});

test('Core lockout: repeated wrong passwords lock the account (429), shared with legacy sign-in', async () => {
  const kim = users.kim;
  for (let i = 0; i < 3; i += 1) assert.equal((await challenge({ sub: kim.id, app: 'slidesvault', core_password: `wrong-${i}` })).status, 401);
  const locked = await challenge({ sub: kim.id, app: 'slidesvault', core_password: kim.password });
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  assert.equal(locked.data.reason, 'rate_limited');
  const evs = (await audits('link.challenge_failed', kim.id)).map((e) => JSON.parse(e.detail).reason);
  assert.deepEqual(evs, ['wrong_core_password', 'wrong_core_password', 'wrong_core_password', 'rate_limited']);
  assert.equal((await h.client().call('POST', '/auth/login', { email: 'kim@example.com', password: kim.password })).status, 429, 'same lockout as sign-in');
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM link_challenges WHERE core_user_id = ?', [kim.id]))[0].n), 0);
});

test('disabled users get 403 active:false for both calls', async () => {
  const zoe = users.zoe;
  const c = await challenge({ sub: zoe.id, app: 'showcase', core_password: zoe.password });
  assert.equal(c.status, 201);
  await db.run('UPDATE users SET disabled = 1 WHERE id = ?', [zoe.id]);
  try {
    const r = await challenge({ sub: zoe.id, app: 'showcase', core_password: zoe.password });
    assert.equal(r.status, 403);
    assert.equal(r.data.active, false);
    const p = await possess({ sub: zoe.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'showcase', app_user_id: 'sc-zoe' });
    assert.equal(p.status, 403);
    assert.equal(p.data.active, false);
    assert.equal((await challengeRow(c.data.challenge_id)).outcome, 'user_inactive');
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM identity_links WHERE app_user_id = 'sc-zoe'"))[0].n, 0);
    assert.equal((await challenge({ sub: 'no-such-user', app: 'showcase', core_password: 'x' })).status, 403);
  } finally {
    await db.run('UPDATE users SET disabled = 0 WHERE id = ?', [zoe.id]);
  }
});

test('wrong account attempts: another user’s challenge, another app, wrong nonce', async () => {
  const lee = users.lee;
  const max = users.max;
  const c = await challenge({ sub: lee.id, app: 'slidesvault', core_password: lee.password });
  // Used with sub B: refused, not consumed.
  const wrongUser = await possess({ sub: max.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'slidesvault', app_user_id: 'sv-x' });
  assert.equal(wrongUser.status, 403);
  assert.equal(wrongUser.data.reason, 'wrong_user');
  assert.equal((await challengeRow(c.data.challenge_id)).used_at, null);
  // Issued for slidesvault, presented for showcase: refused and consumed.
  const wrongApp = await possess({ sub: lee.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'showcase', app_user_id: 'sc-x' });
  assert.equal(wrongApp.status, 403);
  assert.equal(wrongApp.data.reason, 'wrong_app');
  assert.equal((await challengeRow(c.data.challenge_id)).outcome, 'wrong_app');
  const again = await possess({ sub: lee.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'slidesvault', app_user_id: 'sv-x' });
  assert.equal(again.status, 409, 'consumed by the failed attempt');
  // Wrong nonce: refused and consumed, so the right nonce no longer works either.
  const c2 = await challenge({ sub: lee.id, app: 'slidesvault', core_password: lee.password });
  const badNonce = await possess({ sub: lee.id, challenge_id: c2.data.challenge_id, nonce: crypto.randomBytes(32).toString('base64url'), app: 'slidesvault', app_user_id: 'sv-x' });
  assert.equal(badNonce.status, 403);
  assert.equal(badNonce.data.reason, 'wrong_nonce');
  assert.equal((await possess({ sub: lee.id, challenge_id: c2.data.challenge_id, nonce: c2.data.nonce, app: 'slidesvault', app_user_id: 'sv-x' })).status, 409);
  // Unknown challenge.
  assert.equal((await possess({ sub: lee.id, challenge_id: crypto.randomUUID(), nonce: c2.data.nonce, app: 'slidesvault', app_user_id: 'sv-x' })).status, 404);
  const reasons = (await audits('link.rejected', c.data.challenge_id)).map((e) => JSON.parse(e.detail).reason);
  assert.deepEqual(reasons, ['wrong_user', 'wrong_app', 'replayed']);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM identity_links WHERE app_user_id = 'sv-x'"))[0].n, 0, 'no link from any failed attempt');
});

test('expired challenge: 410, consumed', async () => {
  const lee = users.lee;
  const c = await challenge({ sub: lee.id, app: 'slidesvault', core_password: lee.password });
  await db.run('UPDATE link_challenges SET created_at = ?, expires_at = ? WHERE id = ?',
    [new Date(Date.now() - 10 * 60_000).toISOString(), new Date(Date.now() - 5 * 60_000).toISOString(), c.data.challenge_id]);
  const p = await possess({ sub: lee.id, challenge_id: c.data.challenge_id, nonce: c.data.nonce, app: 'slidesvault', app_user_id: 'sv-late' });
  assert.equal(p.status, 410);
  assert.equal(p.data.reason, 'expired');
  const row = await challengeRow(c.data.challenge_id);
  assert.ok(row.used_at);
  assert.equal(row.outcome, 'expired');
  assert.equal(JSON.parse((await audits('link.rejected', c.data.challenge_id))[0].detail).reason, 'expired');
});

test('conflicts (rule 10): app account linked to another Core user; Core user linked to another account', async () => {
  // sc-1 is confirmed for lee: max cannot claim it.
  const { c, p } = await link(users.max, 'showcase', 'sc-1');
  assert.equal(p.status, 409);
  assert.equal(p.data.reason, 'app_account_linked_elsewhere');
  assert.equal((await challengeRow(c.data.challenge_id)).outcome, 'conflict');
  // lee already has showcase sc-1: a different showcase account is refused.
  const second = await link(users.lee, 'showcase', 'sc-2');
  assert.equal(second.p.status, 409);
  assert.equal(second.p.data.reason, 'core_user_linked_elsewhere');
  assert.ok((await challengeRow(second.c.data.challenge_id)).used_at, 'consumed whatever the outcome');
  const conflicts = await db.query("SELECT detail FROM audit_events WHERE action = 'link.rejected' AND target_id IN (?, ?)", [c.data.challenge_id, second.c.data.challenge_id]);
  assert.deepEqual(conflicts.map((e) => JSON.parse(e.detail).conflict).sort(), ['app_account_linked_elsewhere', 'core_user_linked_elsewhere']);
  const links = await db.query("SELECT core_user_id, app_user_id FROM identity_links WHERE app = 'showcase' AND status = 'confirmed'");
  assert.deepEqual(links.map((x) => ({ ...x })), [{ core_user_id: users.lee.id, app_user_id: 'sc-1' }], 'nothing changed');
  // Re-proving the existing pair is idempotent.
  const same = await link(users.lee, 'showcase', 'sc-1');
  assert.equal(same.p.status, 200);
  assert.equal(same.p.data.result, 'already_confirmed');
});

test('a proposed link for the same pair is superseded (confirmed by possession)', async () => {
  const max = users.max;
  const proposed = await admin.ok('POST', '/core/identity-links', { core_user_id: max.id, app: 'slidesvault', app_user_id: 'sv-7' });
  const rolesBefore = await roleRows(max.id);
  const { p } = await link(max, 'slidesvault', 'sv-7');
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.result, 'superseded_proposed');
  assert.equal(p.data.link_id, proposed.id);
  const [l] = await db.query('SELECT * FROM identity_links WHERE id = ?', [proposed.id]);
  assert.equal(l.status, 'confirmed');
  assert.equal(l.evidence, 'possession');
  assert.equal(l.proposed_by, max.id);
  assert.equal(l.reviewed_by, max.id);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM identity_links WHERE app = 'slidesvault' AND app_user_id = 'sv-7'"))[0].n, 1);
  const [ev] = await audits('link.confirmed_by_possession', proposed.id);
  assert.equal(JSON.parse(ev.detail).previous_evidence, 'admin_review');
  assert.equal(JSON.parse(ev.detail).previous_proposed_by, admin.id);
  assert.deepEqual(await roleRows(max.id), rolesBefore);
  // A proposal for another Core user blocks a possession claim (409), it is not taken over.
  await admin.ok('POST', '/core/identity-links', { core_user_id: max.id, app: 'showcase', app_user_id: 'sc-9' });
  const other = await link(users.zoe, 'showcase', 'sc-9');
  assert.equal(other.p.status, 409);
  assert.equal(other.p.data.reason, 'app_account_linked_elsewhere');
});

test('missing or invalid service assertion: 401 on both endpoints; a user session is no substitute', async () => {
  const lee = users.lee;
  const cBody = { sub: lee.id, app: 'showcase', core_password: lee.password };
  const pBody = { sub: lee.id, challenge_id: 'x', nonce: 'y', app: 'showcase', app_user_id: 'z' };
  for (const headers of [{}, { 'X-Apex-Service': 'garbage' }, svc({ aud: 'showcase' }), svc({ iat: now() - 120, exp: now() - 60 })]) {
    assert.equal((await challenge(cBody, headers)).status, 401);
    assert.equal((await possess(pBody, headers)).status, 401);
  }
  assert.equal((await lee.client.call('POST', '/core/link-challenges', cBody)).status, 401);
  assert.equal((await lee.client.call('POST', '/core/identity-links/possession', pBody)).status, 401);
  // Validation.
  assert.equal((await challenge({ sub: lee.id, app: 'academia', core_password: 'x' })).status, 400);
  assert.equal((await challenge({ sub: lee.id, app: 'showcase' })).status, 400);
  assert.equal((await possess({ ...pBody, app_user_id: '' })).status, 400);
});
