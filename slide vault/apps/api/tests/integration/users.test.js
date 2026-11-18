/**
 * User administration: role changes and administrator-set passwords.
 *
 * These are the server half of the Admin page's "Promote to admin" and "Set
 * temporary password" buttons, so they are exercised over HTTP with real
 * sessions — the checks that matter are RBAC, the last-admin guard, input
 * validation, session revocation and the audit trail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN, createTestStack, startServer } from '../helpers/testEnv.js';
import { ROLES } from '../../src/db/repositories/userRepository.js';
import { AUDIT } from '../../src/services/audit/AuditService.js';

const MEMBER = { email: 'member@example.com', password: 'member-password-1' };

async function setup(t) {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });
  const member = await stack.container.users.create({
    email: MEMBER.email,
    password: MEMBER.password,
    fullName: 'Member One',
    role: ROLES.USER,
  });
  const admin = await stack.container.users.findByEmail(ADMIN.email);
  return { stack, http, member, admin };
}

test('an admin can promote a user, and the change is audited', async (t) => {
  const { stack, http, member, admin } = await setup(t);
  assert.equal((await http.login()).status, 200);

  const res = await http.patch(`/api/users/${member.id}`, { role: 'admin' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'admin');
  assert.equal(res.body.changed, true);
  assert.equal(res.body.user.password_hash, undefined, 'the hash never leaves the server');
  assert.equal((await stack.container.users.findById(member.id)).role, 'admin');

  const [event] = await stack.container.audit.list({ action: AUDIT.USER_ROLE_CHANGED });
  assert.ok(event, 'a role change writes an audit record');
  assert.equal(event.actor_id, admin.id);
  assert.equal(event.target, MEMBER.email);
  assert.equal(event.outcome, 'success');
  assert.deepEqual([event.details.from, event.details.to], ['user', 'admin']);
});

test('a non-admin cannot change roles or set passwords', async (t) => {
  const { stack, http, admin, member } = await setup(t);
  assert.equal((await http.login(MEMBER.email, MEMBER.password)).status, 200);

  const promoteSelf = await http.patch(`/api/users/${member.id}`, { role: 'admin' });
  assert.equal(promoteSelf.status, 403);
  const demoteAdmin = await http.patch(`/api/users/${admin.id}`, { role: 'user' });
  assert.equal(demoteAdmin.status, 403);
  const setPassword = await http.post(`/api/users/${admin.id}/password`, { password: 'attacker-chosen-pw' });
  assert.equal(setPassword.status, 403);

  assert.equal((await stack.container.users.findById(member.id)).role, 'user');
  assert.equal((await stack.container.users.findById(admin.id)).role, 'admin');

  // And anonymous callers are turned away before that.
  const anonymous = await startServer(stack.app);
  t.after(() => anonymous.close());
  assert.equal((await anonymous.patch(`/api/users/${member.id}`, { role: 'admin' })).status, 401);
});

test('the last admin cannot be demoted, by themselves or anyone', async (t) => {
  const { stack, http, admin, member } = await setup(t);
  await http.login();

  const res = await http.patch(`/api/users/${admin.id}`, { role: 'user' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'last_admin');
  assert.equal((await stack.container.users.findById(admin.id)).role, 'admin');

  const [refused] = await stack.container.audit.list({ action: AUDIT.USER_ROLE_CHANGED });
  assert.equal(refused.outcome, 'failure');

  // With a second admin, stepping down is allowed — and then the other one is
  // the last admin and is protected in turn.
  assert.equal((await http.patch(`/api/users/${member.id}`, { role: 'admin' })).status, 200);
  assert.equal((await http.patch(`/api/users/${admin.id}`, { role: 'user' })).status, 200);
  assert.equal((await stack.container.users.findById(admin.id)).role, 'user');
  assert.equal(await stack.container.users.changeRoleKeepingAnAdmin(member.id, 'user'), false);
  assert.equal((await stack.container.users.findById(member.id)).role, 'admin');
});

test('an invalid role or id is rejected with 400, an unknown user with 404', async (t) => {
  const { http, member } = await setup(t);
  await http.login();

  for (const body of [{ role: 'superuser' }, { role: '' }, {}, { role: 'ADMIN' }]) {
    const res = await http.patch(`/api/users/${member.id}`, body);
    assert.equal(res.status, 400, `role ${JSON.stringify(body.role)} must be refused`);
  }
  assert.equal((await http.patch('/api/users/not-a-uuid', { role: 'admin' })).status, 400);
  assert.equal(
    (await http.patch('/api/users/00000000-0000-4000-8000-000000000000', { role: 'admin' })).status,
    404
  );
});

test('an admin can set a temporary password, which revokes the user’s sessions', async (t) => {
  const { stack, http, member, admin } = await setup(t);
  await http.login();

  // The member is signed in on another device.
  const memberClient = await startServer(stack.app);
  t.after(() => memberClient.close());
  assert.equal((await memberClient.login(MEMBER.email, MEMBER.password)).status, 200);
  assert.equal((await memberClient.get('/api/auth/me')).status, 200);

  const tooShort = await http.post(`/api/users/${member.id}/password`, { password: 'short' });
  assert.equal(tooShort.status, 400);

  const temporary = 'temporary-password-42';
  const res = await http.post(`/api/users/${member.id}/password`, { password: temporary });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessions_revoked, true);

  // The old session no longer works, the old password no longer works, the new one does.
  assert.equal((await memberClient.get('/api/auth/me')).status, 401);
  assert.equal((await memberClient.login(MEMBER.email, MEMBER.password)).status, 401);
  assert.equal((await memberClient.login(MEMBER.email, temporary)).status, 200);

  const [event] = await stack.container.audit.list({ action: AUDIT.USER_PASSWORD_SET });
  assert.ok(event, 'setting a password writes an audit record');
  assert.equal(event.actor_id, admin.id);
  assert.equal(event.target, MEMBER.email);
  assert.ok(!JSON.stringify(event).includes(temporary), 'the password is never written to the audit log');
});

test('the audit endpoint pages with limit and offset', async (t) => {
  const { stack, http } = await setup(t);
  for (let i = 0; i < 5; i += 1) {
    await stack.container.audit.record({ actorEmail: 'a@example.com', action: `test.event_${i}` });
  }
  await http.login();

  const first = await http.get('/api/dropbox/audit?limit=2');
  const second = await http.get('/api/dropbox/audit?limit=2&offset=2');
  assert.equal(first.status, 200);
  assert.equal(first.body.events.length, 2);
  assert.equal(second.body.events.length, 2);
  assert.equal(second.body.offset, 2);
  const ids = new Set([...first.body.events, ...second.body.events].map((e) => e.id));
  assert.equal(ids.size, 4, 'pages do not overlap');
});
