import { decryptWithIndex, encrypt } from './crypto.js';

// Re-encrypts every secret stored at rest under the current TOKEN_ENCRYPTION_KEY, so a previous key
// (TOKEN_ENCRYPTION_KEY_PREVIOUS) can be retired. No schema change: the secrets live in the `settings`
// table as JSON (dropbox.connection, dropbox.meetings.connection, dropbox.source.<key>.connection), each
// in a top-level field named *_enc (refresh_token_enc). Every such field is checked.
//
// Each row is written with a compare-and-set on its old value, so a connection saved by the running
// server in the meantime is left alone (and is already under the current key). Never logs key material
// or plaintext.

const isEnvelope = (v) => typeof v === 'string' && v.startsWith('v1.');

/**
 * @param db  the Core database driver ({ query, run })
 * @param keys [current, ...previous] key Buffers
 * @returns {{ checked, current, rewrapped, changedMeanwhile, failed }} counts of encrypted fields (rows
 *   for changedMeanwhile), and the setting keys (never values) whose ciphertext no configured key opens
 */
export async function rewrapStoredSecrets(db, keys, { dryRun = false } = {}) {
  const result = { checked: 0, current: 0, rewrapped: 0, changedMeanwhile: 0, failed: [] };
  const rows = await db.query('SELECT key, value FROM settings');
  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const fields = Object.keys(value).filter((f) => f.endsWith('_enc') && isEnvelope(value[f]));
    if (!fields.length) continue;
    const next = { ...value };
    let pending = 0;
    for (const f of fields) {
      result.checked++;
      let opened;
      try {
        opened = decryptWithIndex(value[f], keys);
      } catch {
        result.failed.push(`${row.key}.${f}`);
        continue;
      }
      if (opened.keyIndex === 0) {
        result.current++;
        continue;
      }
      next[f] = encrypt(opened.plaintext, keys);
      pending++;
    }
    if (!pending) continue;
    if (!dryRun) {
      const r = await db.run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?',
        [JSON.stringify(next), new Date().toISOString(), row.key, row.value]);
      // Changed underneath us (reconnected meanwhile): the new value was written with the current key.
      if (!r.changes) {
        result.changedMeanwhile++;
        continue;
      }
    }
    result.rewrapped += pending;
  }
  return result;
}
