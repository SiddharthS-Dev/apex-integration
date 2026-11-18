// Re-encrypts stored secrets (Dropbox refresh tokens in `settings`) under the current TOKEN_ENCRYPTION_KEY,
// trying TOKEN_ENCRYPTION_KEY_PREVIOUS for values written before a rotation. Run after rotating the key
// and restarting; once it reports no failures, TOKEN_ENCRYPTION_KEY_PREVIOUS can be removed.
//   npm run rewrap-secrets [-- --dry-run]
// Prints the resolved target first, and refuses the default data directory (apps/api/data) unless
// --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 is given (see db/safety.js). No migrations, no schema change.
import { config } from '../config.js';
import { guardCliTarget } from './safety.js';

guardCliTarget('rewrap-secrets', config);
const { configuredKeys, parsePreviousKeys } = await import('../lib/crypto.js');
const { rewrapStoredSecrets } = await import('../lib/rewrapSecrets.js');
const { closeDb, getDb } = await import('./index.js');

const dryRun = process.argv.includes('--dry-run');
let code = 0;
try {
  const { errors } = parsePreviousKeys(config.tokenEncryptionKeyPrevious);
  if (errors.length) throw new Error(errors.join('; '));
  const keys = configuredKeys(config);
  const db = await getDb();
  const r = await rewrapStoredSecrets(db, keys, { dryRun });
  console.log(JSON.stringify({ ok: r.failed.length === 0, dry_run: dryRun, checked: r.checked, already_current: r.current, rewrapped: r.rewrapped, changed_meanwhile: r.changedMeanwhile, failed: r.failed }));
  if (r.failed.length) {
    console.error(`rewrap-secrets: ${r.failed.length} value(s) open with no configured key; left unchanged`);
    code = 1;
  }
} catch (err) {
  console.error(`rewrap-secrets failed: ${err.message}`);
  code = 1;
} finally {
  await closeDb().catch(() => {});
}
process.exit(code);
