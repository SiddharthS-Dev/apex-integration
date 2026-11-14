import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// 008_core_identity + core_identity_backfill on a pre-R1 database (contract §1): the backfill follows
// ADR 0004, every pre-existing row is unchanged, re-running is a no-op, and the documented rollback
// (and the break-glass CLI) work on a disposable database.
const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R1 = ['008_core_identity', '009_user_session_epochs', 'core_identity_backfill'];
const CORE_TABLES = ['organizations', 'organization_memberships', 'role_assignments', 'identity_links', 'external_identities', 'audit_events', 'user_session_epochs'];

// The harness migrates fully; this test needs a pre-R1 file, so it rolls back first and then builds
// the pre-R1 data. (A second check below builds pre-R1 straight from migrate({ exclude }).)
const h = await startHarness('core-migration');
const { rollbackIdentity, coreIdentityBackfill } = await import('../src/core/index.js');
const { create } = await import('../src/repo/entities.js');
const db = h.db;

const tables = async () => (await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name);
async function snapshot(names) {
  const out = {};
  for (const t of names) {
    out[t] = {
      sql: (await db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [t]))[0].sql,
      rows: await db.query(`SELECT * FROM "${t}" ORDER BY rowid`),
    };
  }
  return out;
}
const count = async (t) => Number((await db.query(`SELECT COUNT(*) AS n FROM ${t}`))[0].n);

let preTables;
let pre;
const U = {
  admin: 'u-admin', lead: 'u-lead', intern: 'u-intern', learner: 'u-learner', disabled: 'u-disabled',
};

before(async () => {
  await rollbackIdentity(db);
  assert.ok(!(await tables()).includes('role_assignments'), 'pre-R1 schema');
  const ins = 'INSERT INTO users (id, email, full_name, role, password_hash, disabled, created_date, updated_date, last_login_at, avatar_url, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  await db.run(ins, [U.admin, 'admin@example.com', 'Ada', 'admin', 'scrypt$x', 0, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '', 'employee']);
  await db.run(ins, [U.lead, 'lead@example.com', 'Leo', 'user', 'scrypt$y', 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', null, null, 'leadership']);
  await db.run(ins, [U.intern, 'intern@example.com', 'Ivy', 'user', 'scrypt$z', 0, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', null, null, 'intern']);
  await db.run(ins, [U.learner, 'odd@example.com', 'Odd', 'user', null, 0, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z', null, null, 'unknown-audience']);
  await db.run(ins, [U.disabled, 'gone@example.com', 'Gus', 'admin', 'scrypt$w', 1, '2026-01-06T00:00:00.000Z', '2026-01-06T00:00:00.000Z', null, null, 'employee']);
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', ['h1', U.admin, '2026-03-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z']);
  await db.run('INSERT INTO login_history (id, user_id, email, success, created_at) VALUES (?, ?, ?, ?, ?)', ['l1', U.admin, 'admin@example.com', 1, '2026-03-01T00:00:00.000Z']);
  const pb = await create('Playbook', { title: 'Onboarding', status: 'published', file_url: 'dropbox:/playbooks/onboarding.pdf' });
  const course = await create('Course', { title: 'Onboarding 101', playbook_id: pb.id });
  await create('Certificate', { user_id: U.lead, course_id: course.id, course_title: 'Onboarding 101', user_name: 'Leo', score: 92, certificate_id: 'CERT-1' });
  preTables = await tables();
  pre = await snapshot(preTables);
});
after(() => h.stop());

test('migrating a pre-R1 database creates the R1 tables and changes no pre-existing row or table', async () => {
  await h.migrate(db);
  const now = await tables();
  for (const t of CORE_TABLES) assert.ok(now.includes(t), t);
  assert.deepEqual(now.filter((t) => !CORE_TABLES.includes(t)), preTables, 'no other table added or removed');
  const post = await snapshot(preTables);
  for (const t of preTables) {
    if (t === 'schema_migrations') continue;
    assert.deepEqual(post[t], pre[t], `${t} unchanged (schema and every row)`);
  }
  const added = post.schema_migrations.rows.slice(pre.schema_migrations.rows.length);
  assert.deepEqual(post.schema_migrations.rows.slice(0, pre.schema_migrations.rows.length), pre.schema_migrations.rows);
  assert.deepEqual(added.map((r) => r.id), R1);
});

test('the backfill follows ADR 0004', async () => {
  const [org] = await db.query("SELECT * FROM organizations WHERE slug = 'inspironics'");
  assert.equal(org.kind, 'internal');
  const roles = async (id) => (await db.query('SELECT role, scope_type, scope_id, granted_via, valid_to FROM role_assignments WHERE user_id = ? ORDER BY role', [id]))
    .map((r) => { assert.equal(r.granted_via, 'migration'); assert.equal(r.valid_to, null); return `${r.role}@${r.scope_type}${r.scope_id ? (r.scope_id === org.id ? ':inspironics' : ':?') : ''}`; });
  assert.deepEqual(await roles(U.admin), ['platform_admin@platform', 'staff@organization:inspironics']);
  assert.deepEqual(await roles(U.lead), ['learner@platform', 'staff@organization:inspironics']);
  assert.deepEqual(await roles(U.intern), ['intern@organization:inspironics', 'learner@platform'], 'intern: no staff');
  assert.deepEqual(await roles(U.learner), ['learner@platform'], 'unknown audience: no membership');
  assert.deepEqual(await roles(U.disabled), ['platform_admin@platform', 'staff@organization:inspironics'], 'recorded, but inactive while disabled');
  const members = await db.query('SELECT user_id, title FROM organization_memberships WHERE organization_id = ? ORDER BY user_id', [org.id]);
  assert.deepEqual(members.map((m) => [m.user_id, m.title]), [[U.admin, null], [U.disabled, null], [U.intern, 'Intern'], [U.lead, null]]);
  const audit = await db.query("SELECT target_id, actor_kind FROM audit_events WHERE action = 'user.backfilled' ORDER BY target_id");
  assert.deepEqual(audit.map((a) => a.target_id).sort(), Object.values(U).sort(), 'one audit event per user');
  assert.ok(audit.every((a) => a.actor_kind === 'system'));
  const { activeAssignments } = await import('../src/core/index.js');
  assert.deepEqual(await activeAssignments(db, U.disabled), []);
});

test('re-running the migration and the backfill is a no-op', async () => {
  const before = Object.fromEntries(await Promise.all(CORE_TABLES.map(async (t) => [t, await count(t)])));
  await h.migrate(db);
  const r = await coreIdentityBackfill(db);
  assert.equal(r.organization_created, false);
  assert.equal(r.users_changed, 0);
  const afterCounts = Object.fromEntries(await Promise.all(CORE_TABLES.map(async (t) => [t, await count(t)])));
  assert.deepEqual(afterCounts, before);
});

test('rollback drops the R1 tables and records, leaving pre-R1 data intact; migrating again works', async () => {
  const r = await rollbackIdentity(db);
  assert.equal(r.recordsRemoved, 3);
  assert.deepEqual(await tables(), preTables);
  const post = await snapshot(preTables);
  for (const t of preTables) assert.deepEqual(post[t], pre[t], `${t} identical to pre-R1`);
  await h.migrate(db);
  assert.equal(await count('role_assignments'), 9);
});

test('migrate({ exclude }) yields the same pre-R1 schema as the rollback', async () => {
  const { createSqliteDriver } = await import('../src/db/sqlite.js');
  const { migrate } = await import('../src/db/migrations.js');
  // A separate file built with the R1 migrations excluded (as a pre-R1 server would leave it).
  const fresh = createSqliteDriver(path.join(h.dir, 'pre-r1.db'));
  try {
    await fresh.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    await migrate(fresh, { exclude: R1 });
    const names = (await fresh.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map((x) => x.name);
    for (const t of CORE_TABLES) assert.ok(!names.includes(t), `${t} absent`);
    assert.ok(!(await fresh.query('SELECT id FROM schema_migrations')).some((x) => R1.includes(x.id)));
  } finally {
    await fresh.close();
  }
});

const cli = (script, args, env = {}) => run(process.execPath, [path.join(apiRoot, 'src/core/cli', script), ...args], {
  cwd: apiRoot, env: { ...process.env, ...env }, windowsHide: true,
}).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

test('break-glass CLI grants platform_admin with granted_via=cli and a cli audit event', async () => {
  assert.equal((await cli('grant-admin.js', ['--email', 'lead@example.com'])).code, 2, '--reason required');
  assert.equal((await cli('grant-admin.js', ['--email', 'nobody@example.com', '--reason', 'x'])).code, 2, 'unknown email');
  const r = await cli('grant-admin.js', ['--email', 'LEAD@example.com', '--reason', 'only admin left the company']);
  assert.equal(r.code, 0, r.stderr);
  const [a] = await db.query("SELECT * FROM role_assignments WHERE user_id = ? AND role = 'platform_admin' AND valid_to IS NULL", [U.lead]);
  assert.equal(a.granted_via, 'cli');
  assert.equal(a.granted_by, null);
  assert.equal((await db.query('SELECT role FROM users WHERE id = ?', [U.lead]))[0].role, 'admin');
  const [ev] = await db.query("SELECT * FROM audit_events WHERE target_id = ? AND action = 'role.granted'", [a.id]);
  assert.equal(ev.actor_kind, 'cli');
  assert.match(ev.detail, /break_glass/);
  const again = await cli('grant-admin.js', ['--email', 'lead@example.com', '--reason', 'again']);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /"already_admin":true/);
});

test('rollback CLI refuses without --yes, and rolls back with it', async () => {
  const no = await cli('rollback-identity.js', []);
  assert.equal(no.code, 2);
  assert.ok((await tables()).includes('role_assignments'));
  const yes = await cli('rollback-identity.js', ['--yes']);
  assert.equal(yes.code, 0, yes.stderr);
  assert.match(yes.stdout, /"records_removed":3/);
  assert.ok(!(await tables()).some((t) => CORE_TABLES.includes(t)));
  // users.role changed by the break-glass grant stays (it is valid pre-R1 data); nothing else moved.
  const post = await snapshot(preTables.filter((t) => t !== 'users' && t !== 'schema_migrations'));
  for (const t of Object.keys(post)) assert.deepEqual(post[t], pre[t], t);
});
