import { sha256 } from './passwords.js';

// One-time set-password links (password_resets rows), shared with the Core's "accept an invite with
// Google" flow. `q` is a transaction handle or the driver.

/** The unused, unexpired link row for a raw token, or null. */
export async function findUsablePasswordLink(q, token) {
  if (typeof token !== 'string' || !token) return null;
  const [row] = await q.query('SELECT * FROM password_resets WHERE token_hash = ?', [sha256(token)]);
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) return null;
  return row;
}

/** Marks a link used; false if it was already used (so it can never be redeemed twice). */
export async function markPasswordLinkUsed(q, tokenHash) {
  const r = await q.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', [new Date().toISOString(), tokenHash]);
  return r.changes > 0;
}
