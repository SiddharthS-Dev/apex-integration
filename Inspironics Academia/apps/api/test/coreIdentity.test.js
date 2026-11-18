import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// APEX Core identity endpoints (R1 contract §3), happy paths over HTTP on a throwaway database.
const h = await startHarness('core-identity');
let admin; let admin2; let lee; let ivy;
let inspironics;

before(async () => {
  admin = await h.register('ada@example.com'); // first account → admin (development default)
  admin2 = await h.invite(admin, 'bob@example.com', { role: 'admin' });
  lee = await h.invite(admin, 'lee@example.com');
  ivy = await h.invite(admin, 'ivy@example.com', { audience: 'intern' });
  inspironics = (await admin.ok('GET', '/core/organizations')).find((o) => o.slug === 'inspironics');
});
after(() => h.stop());

const roleSet = (roles) => roles.map((r) => `${r.role}:${r.scope_type}:${r.scope_id ? 'org' : ''}`).sort();

test('new accounts get the ADR 0004 mapping: membership + staff/intern, platform_admin or learner', async () => {
  const me = await admin.ok('GET', '/core/me');
  assert.equal(me.user.email, 'ada@example.com');
  assert.deepEqual(roleSet(me.roles), ['platform_admin:platform:', 'staff:organization:org']);
  assert.equal(me.memberships.length, 1);
  assert.equal(me.memberships[0].organization_slug, 'inspironics');
  assert.deepEqual(me.links, []);
  assert.deepEqual(roleSet((await lee.ok('GET', '/core/me')).roles), ['learner:platform:', 'staff:organization:org']);
  const ivyMe = await ivy.ok('GET', '/core/me');
  assert.deepEqual(roleSet(ivyMe.roles), ['intern:organization:org', 'learner:platform:'], 'interns get no staff role');
  assert.equal(ivyMe.memberships[0].title, 'Intern');
  assert.deepEqual(roleSet((await admin2.ok('GET', '/core/me')).roles), ['platform_admin:platform:', 'staff:organization:org']);
});

test('GET /core/users searches by email or name; GET /core/users/:id returns the full picture', async () => {
  const found = await admin.ok('GET', '/core/users?q=LEE');
  assert.deepEqual(found.map((u) => u.email), ['lee@example.com']);
  assert.ok(!('password_hash' in found[0]));
  assert.equal((await admin.ok('GET', '/core/users')).length, 4);
  assert.deepEqual(await admin.ok('GET', `/core/users?q=${encodeURIComponent('%')}`), [], 'LIKE wildcards are escaped');
  const detail = await admin.ok('GET', `/core/users/${lee.id}`);
  assert.equal(detail.user.id, lee.id);
  assert.equal(detail.memberships.length, 1);
  assert.ok(Array.isArray(detail.role_history) && detail.role_history.length >= 2);
  assert.deepEqual(detail.external_identities, []);
  assert.equal((await admin.call('GET', '/core/users/nope')).status, 404);
});

test('organisations: create internal, list, members add/list, external kinds held by default', async () => {
  const acme = await admin.ok('POST', '/core/organizations', { slug: 'acme-lab', name: 'Acme Lab', kind: 'internal' });
  assert.equal(acme.kind, 'internal');
  assert.equal((await admin.call('POST', '/core/organizations', { slug: 'acme-lab', name: 'Dup', kind: 'internal' })).status, 409);
  const ext = await admin.call('POST', '/core/organizations', { slug: 'partner-co', name: 'Partner', kind: 'partner' });
  assert.equal(ext.status, 403);
  assert.match(ext.data.error, /CORE_EXTERNAL_ORGS_ENABLED/);
  process.env.CORE_EXTERNAL_ORGS_ENABLED = 'true';
  try {
    assert.equal((await admin.call('POST', '/core/organizations', { slug: 'partner-co', name: 'Partner', kind: 'partner' })).status, 201);
  } finally {
    delete process.env.CORE_EXTERNAL_ORGS_ENABLED;
  }
  assert.equal((await admin.call('POST', '/core/organizations', { slug: 'Bad Slug', name: 'x' })).status, 400);
  const all = await admin.ok('GET', '/core/organizations');
  assert.deepEqual(all.map((o) => o.slug).sort(), ['acme-lab', 'inspironics', 'partner-co']);
  assert.deepEqual((await lee.ok('GET', '/core/organizations')).map((o) => o.slug), ['inspironics'], 'others see only their own');

  const m = await admin.ok('POST', `/core/organizations/${acme.id}/members`, { user_id: lee.id, title: 'Engineer' });
  assert.equal(m.title, 'Engineer');
  assert.equal((await admin.call('POST', `/core/organizations/${acme.id}/members`, { user_id: lee.id })).status, 409);
  const members = await admin.ok('GET', `/core/organizations/${acme.id}/members`);
  assert.deepEqual(members.map((x) => x.email), ['lee@example.com']);
});

test('role grant, transition (atomic, history kept) and revoke; users.role follows platform_admin', async () => {
  const g = await admin.ok('POST', '/core/role-assignments', { user_id: lee.id, role: 'mentor', scope_type: 'organization', scope_id: inspironics.id, reason: 'pilot' });
  assert.equal(g.granted_via, 'api');
  assert.equal((await admin.call('POST', '/core/role-assignments', { user_id: lee.id, role: 'mentor', scope_type: 'organization', scope_id: inspironics.id })).status, 409);
  assert.equal((await admin.call('POST', '/core/role-assignments', { user_id: lee.id, role: 'staff', scope_type: 'platform' })).status, 400, 'scope rules from the catalogue');
  assert.equal((await admin.call('POST', '/core/role-assignments', { user_id: lee.id, role: 'app_admin', scope_type: 'app', scope_id: 'nope' })).status, 400);

  const t = await admin.ok('POST', `/core/role-assignments/${g.id}/transition`, { to_role: 'assessor', reason: 'use case 006' });
  assert.ok(t.closed.valid_to, 'old assignment closed');
  assert.equal(t.opened.role, 'assessor');
  assert.equal(t.opened.valid_from, t.closed.valid_to, 'closed and opened at the same instant');
  const history = await h.db.query('SELECT role, valid_to FROM role_assignments WHERE user_id = ? AND scope_id = ? ORDER BY created_at', [lee.id, inspironics.id]);
  assert.deepEqual(history.map((r) => r.role), ['staff', 'mentor', 'assessor']);
  assert.equal((await admin.call('POST', `/core/role-assignments/${g.id}/transition`, { to_role: 'learner' })).status, 409, 'an ended assignment cannot move');

  const r = await admin.ok('POST', `/core/role-assignments/${t.opened.id}/revoke`, { reason: 'done' });
  assert.ok(r.valid_to);
  assert.equal(r.revoked_by, admin.id);

  // platform_admin keeps users.role in sync (same transaction).
  const pa = await admin.ok('POST', '/core/role-assignments', { user_id: lee.id, role: 'platform_admin', scope_type: 'platform', reason: 'cover' });
  assert.equal((await h.db.query('SELECT role FROM users WHERE id = ?', [lee.id]))[0].role, 'admin');
  assert.equal((await lee.ok('GET', '/auth/me')).role, 'admin', 'legacy requireAdmin sees it');
  await admin.ok('POST', `/core/role-assignments/${pa.id}/revoke`, { reason: 'cover over' });
  assert.equal((await h.db.query('SELECT role FROM users WHERE id = ?', [lee.id]))[0].role, 'user');
});

test('ending a membership closes the user\'s organisation roles there, and only there', async () => {
  const org = await admin.ok('POST', '/core/organizations', { slug: 'squad', name: 'Squad' });
  const m = await admin.ok('POST', `/core/organizations/${org.id}/members`, { user_id: ivy.id });
  const a = await admin.ok('POST', '/core/role-assignments', { user_id: ivy.id, role: 'mentor', scope_type: 'organization', scope_id: org.id });
  const out = await admin.ok('POST', `/core/memberships/${m.id}/end`, { reason: 'left' });
  assert.deepEqual(out.closed_assignments.map((c) => c.id), [a.id]);
  const [row] = await h.db.query('SELECT valid_to FROM role_assignments WHERE id = ?', [a.id]);
  assert.ok(row.valid_to);
  const roles = roleSet((await ivy.ok('GET', '/core/me')).roles);
  assert.ok(roles.includes('intern:organization:org'), 'Inspironics roles untouched');
  assert.equal((await admin.call('POST', `/core/memberships/${m.id}/end`, {})).status, 409);
});

test('identity links: propose, confirm by another admin, reject with note; links grant no roles', async () => {
  const before = roleSet((await lee.ok('GET', '/core/me')).roles);
  const p = await admin.ok('POST', '/core/identity-links', { core_user_id: lee.id, app: 'showcase', app_user_id: 's-42' });
  assert.equal(p.status, 'proposed');
  assert.equal(p.evidence, 'admin_review');
  assert.equal((await admin.call('POST', '/core/identity-links', { core_user_id: lee.id, app: 'showcase', app_user_id: 's-42' })).status, 409);
  assert.equal((await admin.ok('GET', '/core/identity-links?status=proposed')).length, 1);
  const c = await admin2.ok('POST', `/core/identity-links/${p.id}/confirm`, {});
  assert.equal(c.status, 'confirmed');
  assert.equal(c.reviewed_by, admin2.id);
  const me = await lee.ok('GET', '/core/me');
  assert.deepEqual(me.links.map((l) => [l.app, l.app_user_id]), [['showcase', 's-42']]);
  assert.deepEqual(roleSet(me.roles), before, 'confirming a link changed no roles');

  const p2 = await admin.ok('POST', '/core/identity-links', { core_user_id: lee.id, app: 'slidesvault', app_user_id: 'v-7' });
  assert.equal((await admin2.call('POST', `/core/identity-links/${p2.id}/reject`, {})).status, 400, 'note required');
  const rj = await admin2.ok('POST', `/core/identity-links/${p2.id}/reject`, { note: 'different person' });
  assert.equal(rj.status, 'rejected');
  // A rejected link frees the app account for a new proposal.
  assert.equal((await admin.call('POST', '/core/identity-links', { core_user_id: ivy.id, app: 'slidesvault', app_user_id: 'v-7' })).status, 201);
});

test('audit events: one per mutation, filterable and paginated', async () => {
  const granted = await admin.ok('GET', '/core/audit-events?action=role.granted');
  assert.ok(granted.length >= 2);
  assert.ok(granted.every((e) => e.action === 'role.granted' && e.actor_kind === 'user'));
  const forLink = await admin.ok('GET', `/core/audit-events?target_id=${(await admin.ok('GET', '/core/identity-links?status=confirmed'))[0].id}`);
  assert.deepEqual(forLink.map((e) => e.action).sort(), ['identity_link.confirmed', 'identity_link.proposed']);
  const page = await admin.ok('GET', '/core/audit-events?limit=2&offset=1');
  assert.equal(page.length, 2);
  for (const a of ['organization.created', 'membership.created', 'membership.ended', 'role.transitioned', 'role.revoked', 'identity_link.rejected', 'user.provisioned']) {
    assert.ok((await admin.ok('GET', `/core/audit-events?action=${a}`)).length >= 1, a);
  }
});

test('legacy user admin: PATCH role opens/closes platform_admin with an audit event; delete cascades Core rows', async () => {
  const sam = await h.invite(admin, 'sam@example.com');
  await admin.ok('PATCH', `/entities/User/${sam.id}`, { role: 'admin' });
  let open = await h.db.query("SELECT * FROM role_assignments WHERE user_id = ? AND role = 'platform_admin' AND valid_to IS NULL", [sam.id]);
  assert.equal(open.length, 1);
  assert.equal(open[0].granted_by, admin.id);
  await admin.ok('PATCH', `/entities/User/${sam.id}`, { role: 'user', full_name: 'Sam S' });
  open = await h.db.query("SELECT * FROM role_assignments WHERE user_id = ? AND role = 'platform_admin' AND valid_to IS NULL", [sam.id]);
  assert.equal(open.length, 0);
  const [u] = await h.db.query('SELECT role, full_name FROM users WHERE id = ?', [sam.id]);
  assert.deepEqual({ ...u }, { role: 'user', full_name: 'Sam S' });
  const events = await h.db.query("SELECT action FROM audit_events WHERE detail LIKE ? AND action IN ('role.granted', 'role.revoked')", [`%${sam.id}%`]);
  assert.deepEqual(events.map((e) => e.action).sort(), ['role.granted', 'role.revoked']);

  await admin.ok('DELETE', `/entities/User/${sam.id}`);
  assert.equal((await h.db.query('SELECT COUNT(*) AS n FROM role_assignments WHERE user_id = ?', [sam.id]))[0].n, 0);
  assert.equal((await h.db.query('SELECT COUNT(*) AS n FROM organization_memberships WHERE user_id = ?', [sam.id]))[0].n, 0);
  assert.equal((await h.db.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'user.deleted' AND target_id = ?", [sam.id]))[0].n, 1);
});
