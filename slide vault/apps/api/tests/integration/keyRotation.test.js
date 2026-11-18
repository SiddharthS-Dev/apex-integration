/**
 * DROPBOX_TOKEN_ENCRYPTION_KEY rotation: DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS,
 * TokenCipher's key list, and the rewrap-tokens CLI. Disposable databases in a
 * temp directory only; the real database is only stat'ed.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig, decodeKeyList, validateConfig } from '../../src/config/index.js';
import { TokenCipher } from '../../src/crypto/tokenCipher.js';
import { createDatabase } from '../../src/db/index.js';
import { DEFAULT_DATA_DIR } from '../../src/db/safety.js';
import { ConnectionRepository } from '../../src/db/repositories/connectionRepository.js';
import { createContainer } from '../../src/container.js';
import { nullLogger } from '../../src/util/logger.js';
import { testConfig } from '../helpers/testEnv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slidesvault-keyrot-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const OLD = crypto.randomBytes(32).toString('base64');
const OLDER = crypto.randomBytes(32).toString('hex');
const NEW = crypto.randomBytes(32).toString('base64');

test('(a) a credential encrypted with the old key decrypts after rotation; (b) new ones use the new key only', () => {
  const before = new TokenCipher(OLD);
  const stored = before.encrypt('refresh-token');
  const olderStored = new TokenCipher(OLDER).encrypt('older-token');

  const rotated = new TokenCipher(NEW, [OLD, OLDER]);
  assert.deepEqual(rotated.decryptWithIndex(stored), { plaintext: 'refresh-token', keyIndex: 1 });
  assert.deepEqual(rotated.decryptWithIndex(olderStored), { plaintext: 'older-token', keyIndex: 2 });
  assert.equal(rotated.decrypt(stored), 'refresh-token');
  assert.ok(TokenCipher.isEncrypted(stored), 'envelope format unchanged');

  const fresh = rotated.encrypt('new-token');
  assert.equal(new TokenCipher(NEW).decrypt(fresh), 'new-token');
  assert.throws(() => before.decrypt(fresh), /Could not decrypt/, 'the old key alone cannot open it');

  // Wired through the config the way the server builds it.
  const container = createContainer({
    config: testConfig({ DROPBOX_TOKEN_ENCRYPTION_KEY: NEW, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: `${OLD}, ${OLDER}` }),
    db: {},
    logger: nullLogger,
  });
  assert.equal(container.connections.cipher.decrypt(stored), 'refresh-token');
});

test('(c) a wrong key still fails, with or without previous keys', () => {
  const stored = new TokenCipher(OLD).encrypt('secret');
  assert.throws(() => new TokenCipher(NEW, [OLDER]).decrypt(stored), /Could not decrypt/);
  assert.throws(() => new TokenCipher(crypto.randomBytes(32)).decrypt(stored), /Could not decrypt/);
  const parts = stored.split('.');
  const body = Buffer.from(parts[2], 'base64');
  body[0] ^= 1;
  parts[2] = body.toString('base64');
  assert.throws(() => new TokenCipher(NEW, [OLD]).decrypt(parts.join('.')), /Could not decrypt/, 'tampering still fails');
});

test('(d) a malformed previous key is rejected at start-up, naming its position, never its value', () => {
  const bad = 'c2hvcnQ=';
  assert.deepEqual(decodeKeyList(`${OLD},${bad}`).invalid, [2]);
  assert.equal(decodeKeyList(`${OLD},${bad}`).keys.length, 1);
  assert.deepEqual(decodeKeyList(''), { keys: [], invalid: [] });

  for (const NODE_ENV of ['production', 'development']) {
    const cfg = buildConfig({ NODE_ENV, DB_DRIVER: 'sqlite', DB_FILE: ':memory:', DROPBOX_TOKEN_ENCRYPTION_KEY: NEW, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: `${OLD},${bad}` });
    const errors = validateConfig(cfg).errors.filter((e) => e.includes('PREVIOUS'));
    assert.deepEqual(errors, ['DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS entry 2 must decode to exactly 32 bytes (AES-256-GCM).'], NODE_ENV);
  }
  const good = buildConfig({ DB_DRIVER: 'sqlite', DB_FILE: ':memory:', DROPBOX_TOKEN_ENCRYPTION_KEY: NEW, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD });
  assert.deepEqual(validateConfig(good).errors.filter((e) => e.includes('PREVIOUS')), []);
  assert.throws(() => new TokenCipher(NEW, [bad]), /32-byte key/);
});

/* ------------------------------------------------------- (e) rewrap-tokens */

const cli = (args, env) =>
  spawnSync(process.execPath, [path.join(HERE, '../../scripts/rewrap-tokens.js'), ...args], {
    // Every variable the CLI reads is given explicitly, so apps/api/.env cannot fill one in.
    env: { ...process.env, DB_DRIVER: 'sqlite', APEX_ALLOW_DEFAULT_DB: '', LOG_LEVEL: 'silent', DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
const lastJson = (out) => JSON.parse(out.trim().split('\n').pop());

test('(e) rewrap-tokens re-encrypts stored credentials under the current key on a disposable database', async () => {
  const file = path.join(tmp, 'rewrap.db');
  const cfg = testConfig({ DB_FILE: file });
  let db = await createDatabase(cfg, nullLogger);
  await new ConnectionRepository(db, new TokenCipher(OLD)).update('dropbox', { refreshToken: 'stored-token', account_id: 'dbid:1' });
  await new ConnectionRepository(db, new TokenCipher(NEW)).update('other', { refreshToken: 'current-token' });
  await new ConnectionRepository(db, new TokenCipher(NEW)).ensure('empty');
  const untouched = (await db.queryOne("SELECT refresh_token_encrypted FROM storage_connection WHERE provider = 'other'")).refresh_token_encrypted;
  await db.close();

  const env = { DB_FILE: file, DROPBOX_TOKEN_ENCRYPTION_KEY: NEW, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD };
  const dry = cli(['--dry-run'], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Rewrap target: sqlite .*rewrap\.db/);
  assert.deepEqual(lastJson(dry.stdout), { ok: true, dry_run: true, checked: 2, already_current: 1, rewrapped: 1, changed_meanwhile: 0, failed: [] });

  const r = cli([], env);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lastJson(r.stdout), { ok: true, dry_run: false, checked: 2, already_current: 1, rewrapped: 1, changed_meanwhile: 0, failed: [] });
  for (const s of ['stored-token', 'current-token', OLD, NEW]) assert.ok(!(r.stdout + r.stderr).includes(s), 'nothing secret printed');

  db = await createDatabase(cfg, nullLogger);
  const repo = new ConnectionRepository(db, new TokenCipher(NEW));
  const conn = await repo.get('dropbox');
  assert.equal(conn.refreshToken, 'stored-token', 'opens with the new key alone');
  assert.equal(conn.credentialError, '');
  assert.equal(conn.account_id, 'dbid:1');
  assert.ok((await new ConnectionRepository(db, new TokenCipher(OLD)).get('dropbox')).credentialError, 'no longer opens with the old key');
  assert.equal((await db.queryOne("SELECT refresh_token_encrypted FROM storage_connection WHERE provider = 'other'")).refresh_token_encrypted, untouched);

  // A credential no configured key opens is reported by provider and left as it is.
  await new ConnectionRepository(db, new TokenCipher(crypto.randomBytes(32))).update('dropbox', { refreshToken: 'x' });
  await db.close();
  const failed = cli([], env);
  assert.equal(failed.status, 1);
  assert.deepEqual(lastJson(failed.stdout).failed, ['dropbox']);

  const malformed = cli([], { ...env, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: 'short' });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS entry 1 must decode/);
});

test('(e) rewrap-tokens refuses the default database unless asked by name, and leaves it untouched', () => {
  const real = path.join(DEFAULT_DATA_DIR, 'slidesvault.db');
  const stamp = (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : null);
  const files = [real, `${real}-wal`, `${real}-shm`];
  const before = files.map(stamp);
  const r = cli([], { DB_FILE: real, DROPBOX_TOKEN_ENCRYPTION_KEY: NEW, DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stdout, /Rewrap target: sqlite .*slidesvault\.db/);
  assert.match(r.stderr, /Refusing to rewrap tokens in .*--allow-default-db/);
  assert.deepEqual(files.map(stamp), before);
});
