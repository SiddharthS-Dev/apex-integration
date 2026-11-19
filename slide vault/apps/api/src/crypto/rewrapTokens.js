/**
 * Re-encrypts every stored credential under the current
 * DROPBOX_TOKEN_ENCRYPTION_KEY, so a retired key
 * (DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS) can be removed after a rotation.
 *
 * The only encrypted column is storage_connection.refresh_token_encrypted (one
 * row per provider). Nothing re-saves it on read or token refresh — Dropbox
 * refresh tokens do not change — so this is how a row moves to a new key.
 * No schema change. Run it through scripts/rewrap-tokens.js.
 */

/**
 * @param {import('../db/index.js').Database} db
 * @param {import('./tokenCipher.js').TokenCipher} cipher  built with the current and previous keys
 * @returns {Promise<{checked: number, current: number, rewrapped: number, changedMeanwhile: number, failed: string[]}>}
 *   `failed` lists the providers (never values) whose credential no configured key opens; those rows are left as they are.
 */
export async function rewrapStoredTokens(db, cipher, { dryRun = false } = {}) {
  const result = { checked: 0, current: 0, rewrapped: 0, changedMeanwhile: 0, failed: [] };
  const rows = await db.query(
    "SELECT provider, refresh_token_encrypted FROM storage_connection WHERE refresh_token_encrypted <> ''"
  );
  for (const row of rows) {
    result.checked++;
    let opened;
    try {
      opened = cipher.decryptWithIndex(row.refresh_token_encrypted);
    } catch {
      result.failed.push(row.provider);
      continue;
    }
    if (opened.keyIndex === 0) {
      result.current++;
      continue;
    }
    if (!dryRun) {
      // Compare-and-set: a reconnect in the meantime wrote a fresh value under the current key.
      const { changes } = await db.execute(
        'UPDATE storage_connection SET refresh_token_encrypted = ?, updated_at = ? WHERE provider = ? AND refresh_token_encrypted = ?',
        [cipher.encrypt(opened.plaintext), new Date().toISOString(), row.provider, row.refresh_token_encrypted]
      );
      if (!changes) {
        result.changedMeanwhile++;
        continue;
      }
    }
    result.rewrapped++;
  }
  return result;
}
