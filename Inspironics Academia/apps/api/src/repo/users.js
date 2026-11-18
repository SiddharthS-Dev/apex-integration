import { AUDIENCE_KEYS, DEFAULT_AUDIENCE } from '@academy/shared';
import { db } from '../db/index.js';
import { newId } from './entities.js';

const nowIso = () => new Date().toISOString();

// Public shape of a user — never includes password_hash.
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name || '',
    avatar_url: row.avatar_url || '',
    role: row.role,
    // Who the user is in the organisation: decides which playbook categories they see.
    audience: AUDIENCE_KEYS.includes(row.audience) ? row.audience : DEFAULT_AUDIENCE,
    disabled: row.disabled === true || row.disabled === 1,
    created_date: row.created_date,
    updated_date: row.updated_date,
    last_login_at: row.last_login_at || null,
  };
}

export async function findUserByEmail(email) {
  const [row] = await db().query('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  return row || null;
}

export async function findUserById(id) {
  const [row] = await db().query('SELECT * FROM users WHERE id = ?', [id]);
  return row || null;
}

export async function listUsers() {
  return (await db().query('SELECT * FROM users ORDER BY created_date DESC')).map(publicUser);
}

export async function countUsers() {
  const [row] = await db().query('SELECT COUNT(*) AS n FROM users');
  return Number(row.n);
}

// `q` is a transaction handle (approval of a registration request creates the user inside its own
// transaction) or, by default, the driver.
export async function createUser({ email, fullName, role = 'user', passwordHash, audience = DEFAULT_AUDIENCE }, q = db()) {
  const ts = nowIso();
  const user = {
    id: newId(), email: email.trim().toLowerCase(), full_name: fullName || '', role, password_hash: passwordHash,
    audience: AUDIENCE_KEYS.includes(audience) ? audience : DEFAULT_AUDIENCE, created_date: ts, updated_date: ts,
  };
  await q.run(
    'INSERT INTO users (id, email, full_name, role, password_hash, audience, created_date, updated_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.email, user.full_name, user.role, user.password_hash, user.audience, ts, ts],
  );
  return user;
}

const UPDATABLE = ['full_name', 'avatar_url', 'role', 'audience', 'password_hash', 'disabled', 'last_login_at'];

export async function updateUser(id, patch) {
  const fields = Object.keys(patch).filter((k) => UPDATABLE.includes(k));
  if (fields.length === 0) return findUserById(id);
  const values = fields.map((k) => (k === 'disabled' && db().dialect === 'sqlite' ? (patch[k] ? 1 : 0) : patch[k]));
  await db().run(
    `UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_date = ? WHERE id = ?`,
    [...values, nowIso(), id],
  );
  return findUserById(id);
}

// Deleting a user also removes the personal data kept about them outside the users row: their sign-in
// history (rows by id, and attempts recorded by email only, e.g. while locked) and their queued or sent
// email. The append-only audit trail (audit_events) is kept by design.
export async function deleteUser(id) {
  const user = await findUserById(id);
  await db().run('DELETE FROM sessions WHERE user_id = ?', [id]);
  await db().run('DELETE FROM login_history WHERE user_id = ?', [id]);
  await db().run('DELETE FROM email_outbox WHERE user_id = ?', [id]);
  if (user?.email) {
    await db().run('DELETE FROM login_history WHERE user_id IS NULL AND lower(email) = ?', [user.email.toLowerCase()]);
    await db().run('DELETE FROM email_outbox WHERE lower(to_email) = ?', [user.email.toLowerCase()]);
  }
  await db().run('DELETE FROM users WHERE id = ?', [id]);
}

/** LOGIN_HISTORY_RETENTION_DAYS: deletes sign-in history older than that many days. Returns the count. */
export async function purgeLoginHistory(days) {
  if (!(Number(days) > 0)) return 0;
  const cutoff = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  return (await db().run('DELETE FROM login_history WHERE created_at < ?', [cutoff])).changes;
}

export async function recordLogin({ userId, email, success, reason, ip, userAgent }) {
  await db().run(
    'INSERT INTO login_history (id, user_id, email, success, reason, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [newId(), userId || null, email || null, db().dialect === 'sqlite' ? (success ? 1 : 0) : !!success, reason || null, ip || null, userAgent || null, nowIso()],
  );
}

export async function loginHistory({ userId, limit = 100 } = {}) {
  const rows = userId
    ? await db().query('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit])
    : await db().query('SELECT * FROM login_history ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((r) => ({ ...r, success: r.success === true || r.success === 1 }));
}
