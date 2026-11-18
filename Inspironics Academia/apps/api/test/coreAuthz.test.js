import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Core authorization (R1 contract §2): default deny, staff/membership grant nothing, org_admin is
// confined to its own organisation and to learner/mentor, nobody self-grants platform_admin.
const h = await startHarness('core-authz');
const anon = h.client();
let admin; let admin2; let staff; let oa; let other; let outsider;
let inspironics; let acme; let beta;

before(async () => {
  admin = await h.register('ada@example.com');
  admin2 = await h.invite(admin, 'bob@example.com', { role: 'admin' });
  staff = await h.invite(admin, 'sue@example.com'); // employee → Inspironics member + staff
  oa = await h.invite(admin, 'olga@example.com');
  other = await h.invite(admin, 'otto@example.com');
  outsider = await h.invite(admin, 'opal@example.com');
  inspironics = (await admin.ok('GET', '/core/organizations')).find((o) => o.slug === 'inspironics');
  acme = await admin.ok('POST', '/core/organizations', { slug: 'acme', name: 'Acme' });
  beta = await admin.ok('POST', '/core/organizations', { slug: 'beta', name: 'Beta' });
  await admin.ok('POST', `/core/organizations/${acme.id}/members`, { user_id: oa.id });
  await admin.ok('POST', '/core/role-assignments', { user_id: oa.id, role: 'org_admin', scope_type: 'organization', scope_id: acme.id });
  await admin.ok('POST', `/core/organizations/${acme.id}/members`, { user_id: other.id });
  await admin.ok('POST', `/core/organizations/${beta.id}/members`, { user_id: outsider.id });
});
after(() => h.stop());

const ENDPOINTS = () => [
  ['GET', '/core/me'],
  ['GET', '/core/users?q=a'],
  ['GET', `/core/users/${staff.id}`],
  ['GET', '/core/organizations'],
  ['POST', '/core/organizations', { slug: 'x-org', name: 'X' }],
  ['GET', `/core/organizations/${acme.id}/members`],
  ['POST', `/core/organizations/${acme.id}/members`, { user_id: staff.id }],
  ['POST', '/core/memberships/whatever/end', {}],
  ['POST', '/core/role-assignments', { user_id: staff.id, role: 'learner', scope_type: 'platform' }],
  ['POST', '/core/role-assignments/whatever/revoke', {}],
  ['POST', '/core/role-assignments/whatever/transition', { to_role: 'mentor' }],
  ['GET', '/core/identity-links'],
  ['POST', '/core/identity-links', { core_user_id: staff.id, app: 'showcase', app_user_id: 'z' }],
  ['POST', '/core/identity-links/whatever/confirm', {}],
  ['POST', '/core/identity-links/whatever/reject', { note: 'n' }],
  ['GET', '/core/audit-events'],
  ['POST', '/core/external-identities/google', { credential: 'x' }],
];

test('anonymous callers get 401 on every signed-in endpoint', async () => {
  for (const [method, url, body] of ENDPOINTS()) {
    assert.equal((await anon.call(method, url, body)).status, 401, `${method} ${url}`);
  }
});

test('staff (member + staff role) and learners get 403 on every administrative endpoint', async () => {
  const me = await staff.ok('GET', '/core/me');
  assert.ok(me.roles.some((r) => r.role === 'staff'), 'precondition: holds staff');
  const adminOnly = ENDPOINTS().filter(([m, url]) => !(url === '/core/me' || (m === 'GET' && url === '/core/organizations') || url === '/core/external-identities/google'));
  for (const [method, url, body] of adminOnly) {
    const r = await staff.call(method, url, body);
    assert.equal(r.status, 403, `${method} ${url} → ${r.status}`);
  }
  assert.equal((await staff.call('POST', '/core/organizations', { slug: 'x-org', name: 'X' })).status, 403);
  // Membership plus staff never reaches the legacy admin routes either.
  assert.equal((await staff.call('GET', '/metrics')).status, 403);
});

test('org_admin manages its own organisation only', async () => {
  const members = await oa.ok('GET', `/core/organizations/${acme.id}/members`);
  assert.deepEqual(members.map((m) => m.email).sort(), ['olga@example.com', 'otto@example.com']);
  // Cross-organisation isolation: Beta and Inspironics are invisible (404, not 403).
  assert.equal((await oa.call('GET', `/core/organizations/${beta.id}/members`)).status, 404);
  assert.equal((await oa.call('POST', `/core/organizations/${beta.id}/members`, { user_id: other.id })).status, 404);
  assert.equal((await oa.call('GET', `/core/users/${outsider.id}`)).status, 404);
  const seen = await oa.ok('GET', `/core/users/${other.id}`);
  assert.deepEqual(seen.memberships.map((m) => m.organization_id), [acme.id], 'org-scoped data only (no Inspironics membership)');
  assert.ok(!('links' in seen) && !('external_identities' in seen) && !('role_history' in seen));
  assert.deepEqual((await oa.ok('GET', '/core/organizations')).map((o) => o.slug).sort(), ['acme', 'inspironics']);
  assert.equal((await oa.call('GET', '/core/users?q=o')).status, 403, 'user search is platform_admin only');
  assert.equal((await oa.call('GET', '/core/audit-events')).status, 403);

  // learner/mentor inside Acme: allowed.
  const g = await oa.ok('POST', '/core/role-assignments', { user_id: other.id, role: 'mentor', scope_type: 'organization', scope_id: acme.id });
  const t = await oa.ok('POST', `/core/role-assignments/${g.id}/transition`, { to_role: 'learner' });
  await oa.ok('POST', `/core/role-assignments/${t.opened.id}/revoke`, { reason: 'test' });
  // Not grantable by org_admin: org_admin, staff, platform_admin, or anything platform-scoped / in Beta.
  for (const body of [
    { role: 'org_admin', scope_type: 'organization', scope_id: acme.id },
    { role: 'staff', scope_type: 'organization', scope_id: acme.id },
    { role: 'assessor', scope_type: 'organization', scope_id: acme.id },
    { role: 'platform_admin', scope_type: 'platform' },
    { role: 'learner', scope_type: 'platform' },
  ]) {
    const r = await oa.call('POST', '/core/role-assignments', { user_id: other.id, ...body });
    assert.equal(r.status, 403, JSON.stringify(body));
  }
  assert.equal((await oa.call('POST', '/core/role-assignments', { user_id: outsider.id, role: 'learner', scope_type: 'organization', scope_id: beta.id })).status, 404);
  // An org_admin cannot transition a role it may revoke into one it may not grant.
  const g2 = await oa.ok('POST', '/core/role-assignments', { user_id: other.id, role: 'learner', scope_type: 'organization', scope_id: acme.id });
  assert.equal((await oa.call('POST', `/core/role-assignments/${g2.id}/transition`, { to_role: 'org_admin' })).status, 403);
  // Nor revoke someone's staff role in Inspironics.
  const staffRole = (await admin.ok('GET', `/core/users/${staff.id}`)).roles.find((r) => r.role === 'staff');
  assert.equal((await oa.call('POST', `/core/role-assignments/${staffRole.id}/revoke`, {})).status, 404);
});

test('org_admin cannot enrol users from elsewhere and hand back access (security review M2)', async () => {
  // The reviewer's probe: outsider belongs to Beta; Acme's org_admin tries to pull them into Acme.
  const add = await oa.call('POST', `/core/organizations/${acme.id}/members`, { user_id: outsider.id });
  assert.equal(add.status, 403, 'adding members is platform_admin only');
  assert.equal((await oa.call('GET', `/core/users/${outsider.id}`)).status, 404, 'still invisible');
  const grant = await oa.call('POST', '/core/role-assignments', { user_id: outsider.id, role: 'mentor', scope_type: 'organization', scope_id: acme.id, reason: 'probe' });
  assert.notEqual(grant.status, 201, 'no role in Acme for a non-member');
  const me = await oa.ok('GET', `/core/organizations/${acme.id}/members`);
  assert.ok(!me.some((m) => m.user_id === outsider.id), 'membership not created');
});

test('org_admin cannot end a membership that carries a role it could not revoke', async () => {
  const [oaMembership] = await h.db.query('SELECT id FROM organization_memberships WHERE user_id = ? AND organization_id = ?', [oa.id, acme.id]);
  // olga's own Acme membership carries org_admin
  const r = await oa.call('POST', `/core/memberships/${oaMembership.id}/end`, {});
  assert.equal(r.status, 403);
  const [inspMembership] = await h.db.query('SELECT id FROM organization_memberships WHERE user_id = ? AND organization_id = ?', [staff.id, inspironics.id]);
  assert.equal((await oa.call('POST', `/core/memberships/${inspMembership.id}/end`, {})).status, 404, 'other organisation');
});

test('nobody grants themselves platform_admin; nobody revokes their own', async () => {
  const self = await admin.call('POST', '/core/role-assignments', { user_id: admin.id, role: 'platform_admin', scope_type: 'platform' });
  assert.equal(self.status, 403);
  assert.match(self.data.error, /yourself/);
  const own = (await admin.ok('GET', '/core/me')).roles.find((r) => r.role === 'platform_admin');
  assert.equal((await admin.call('POST', `/core/role-assignments/${own.id}/revoke`, {})).status, 403);
  const sueLearner = (await admin.ok('GET', `/core/users/${staff.id}`)).roles.find((r) => r.role === 'learner');
  assert.equal((await staff.call('POST', `/core/role-assignments/${sueLearner.id}/transition`, { to_role: 'platform_admin' })).status, 403);
  // A non-admin cannot turn a role they hold into platform_admin.
  const pa2 = await admin.ok('POST', '/core/role-assignments', { user_id: staff.id, role: 'assessor', scope_type: 'platform' });
  assert.equal((await staff.call('POST', `/core/role-assignments/${pa2.id}/transition`, { to_role: 'platform_admin' })).status, 403);
});

test('a link cannot be confirmed by its proposer; links grant no roles', async () => {
  const p = await admin.ok('POST', '/core/identity-links', { core_user_id: staff.id, app: 'slidesvault', app_user_id: 'sv-1' });
  const r = await admin.call('POST', `/core/identity-links/${p.id}/confirm`, {});
  assert.equal(r.status, 403);
  assert.match(r.data.error, /different administrator/);
  const before = await h.db.query('SELECT * FROM role_assignments WHERE user_id = ? ORDER BY id', [staff.id]);
  await admin2.ok('POST', `/core/identity-links/${p.id}/confirm`, {});
  const afterRows = await h.db.query('SELECT * FROM role_assignments WHERE user_id = ? ORDER BY id', [staff.id]);
  assert.deepEqual(afterRows, before);
  assert.equal((await h.db.query('SELECT role FROM users WHERE id = ?', [staff.id]))[0].role, 'user');
});

test('a failed transition changes nothing (one transaction)', async () => {
  const g = await admin.ok('POST', '/core/role-assignments', { user_id: other.id, role: 'mentor', scope_type: 'organization', scope_id: acme.id });
  // other already holds an open learner in Acme (from the org_admin test), so opening it again collides.
  const r = await admin.call('POST', `/core/role-assignments/${g.id}/transition`, { to_role: 'learner' });
  assert.equal(r.status, 409);
  const [row] = await h.db.query('SELECT valid_to FROM role_assignments WHERE id = ?', [g.id]);
  assert.equal(row.valid_to, null, 'the old assignment is still open after the rollback');
  assert.equal((await h.db.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'role.transitioned' AND detail LIKE ?", [`%${g.id}%`]))[0].n, 0);
});

test('a disabled user has no active roles, and an org role needs an active membership', async () => {
  await admin.ok('PATCH', `/entities/User/${outsider.id}`, { disabled: true });
  const { activeAssignments } = await import('../src/core/index.js');
  assert.deepEqual(await activeAssignments(h.db, outsider.id), []);
  await admin.ok('PATCH', `/entities/User/${outsider.id}`, { disabled: false });
  assert.ok((await activeAssignments(h.db, outsider.id)).length > 0);
  // Granting an org role to a non-member is refused.
  assert.equal((await admin.call('POST', '/core/role-assignments', { user_id: outsider.id, role: 'mentor', scope_type: 'organization', scope_id: acme.id })).status, 400);
  assert.ok((await h.db.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'user.disabled'"))[0].n >= 1);
});
