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

export async function createUser({ email, fullName, role = 'user', passwordHash }) {
  const ts = nowIso();
  const user = { id: newId(), email: email.trim().toLowerCase(), full_name: fullName || '', role, password_hash: passwordHash, created_date: ts, updated_date: ts };
  await db().run(
    'INSERT INTO users (id, email, full_name, role, password_hash, created_date, updated_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.email, user.full_name, user.role, user.password_hash, ts, ts],
  );
  return user;
}

const UPDATABLE = ['full_name', 'avatar_url', 'role', 'password_hash', 'disabled', 'last_login_at'];

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

export async function deleteUser(id) {
  await db().run('DELETE FROM sessions WHERE user_id = ?', [id]);
  await db().run('DELETE FROM users WHERE id = ?', [id]);
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
