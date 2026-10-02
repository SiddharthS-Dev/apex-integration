import { db } from '../db/index.js';

// Key/value JSON settings in the `settings` table.

export async function getSetting(key, fallback = null) {
  const [row] = await db().query('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row || row.value === null || row.value === undefined) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  const now = new Date().toISOString();
  await db().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value ?? null), now],
  );
  return value;
}

export async function deleteSetting(key) {
  await db().run('DELETE FROM settings WHERE key = ?', [key]);
}
