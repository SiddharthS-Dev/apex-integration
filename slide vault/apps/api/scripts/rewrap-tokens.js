/**
 * Re-encrypts the stored Dropbox refresh token(s) under the current
 * DROPBOX_TOKEN_ENCRYPTION_KEY, using DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS to
 * open rows written before a rotation. Run after rotating the key and
 * restarting; once it reports no failures the previous key can be removed.
 *
 *   npm run rewrap-tokens [-- --dry-run]
 *
 * Like the migration CLI it prints its target first and refuses the default
 * (real) database unless --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 is given
 * (src/db/safety.js). It does not run migrations and prints no key or token.
 */
import { config, decodeKeyList, validateConfig } from '../src/config/index.js';
import { TokenCipher } from '../src/crypto/tokenCipher.js';
import { rewrapStoredTokens } from '../src/crypto/rewrapTokens.js';
import { createSqliteDriver } from '../src/db/sqliteDriver.js';
import { createPostgresDriver } from '../src/db/postgresDriver.js';
import { defaultDbRefusal } from '../src/db/safety.js';
import { createLogger } from '../src/util/logger.js';

const cfg = config();
const logger = createLogger({ level: 'warn' });

const sqlite = cfg.db.driver !== 'postgres';
console.log(sqlite ? `Rewrap target: sqlite ${cfg.db.file}` : 'Rewrap target: postgres (DATABASE_URL)');
const refusal = sqlite ? defaultDbRefusal(cfg.db.file, { action: 'rewrap tokens in' }) : null;
if (refusal) {
  console.error(refusal);
  process.exit(2);
}

// The key checks only: every other setting is the server's business.
const keyErrors = validateConfig(cfg).errors.filter((e) => e.startsWith('DROPBOX_TOKEN_ENCRYPTION_KEY'));
if (keyErrors.length) {
  for (const error of keyErrors) console.error(`rewrap-tokens: ${error}`);
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const cipher = new TokenCipher(cfg.dropbox.tokenEncryptionKey, decodeKeyList(cfg.dropbox.tokenEncryptionKeyPrevious).keys);
const db = sqlite ? createSqliteDriver(cfg, logger) : await createPostgresDriver(cfg, logger);
let code = 0;
try {
  const r = await rewrapStoredTokens(db, cipher, { dryRun });
  console.log(
    JSON.stringify({ ok: r.failed.length === 0, dry_run: dryRun, checked: r.checked, already_current: r.current, rewrapped: r.rewrapped, changed_meanwhile: r.changedMeanwhile, failed: r.failed })
  );
  if (r.failed.length) {
    console.error(`rewrap-tokens: ${r.failed.length} credential(s) open with no configured key; left unchanged`);
    code = 1;
  }
} catch (error) {
  console.error(`rewrap-tokens failed: ${error.message}`);
  code = 1;
} finally {
  await db.close();
}
process.exit(code);
