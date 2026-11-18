import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { configuredKeys, decrypt, decryptWithIndex, encrypt, parsePreviousKeys } from '../src/lib/crypto.js';
import { startupProblems } from '../src/startupChecks.js';
import { createSqliteDriver } from '../src/db/sqlite.js';

// TOKEN_ENCRYPTION_KEY rotation: TOKEN_ENCRYPTION_KEY_PREVIOUS and the rewrap CLI (src/db/rewrap-cli.js).
// Only disposable databases in a temp directory; the default database is only stat'ed.
const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(apiRoot, 'data');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-keyrot-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const b64 = () => crypto.randomBytes(32).toString('base64');
const OLD = b64();
const OLDER = crypto.randomBytes(32).toString('hex');
const NEW = b64();

test('(a) ciphertext made with the old key decrypts after rotation; (b) new encryption uses the new key', () => {
  const beforeRotation = configuredKeys({ tokenEncryptionKey: OLD, tokenEncryptionKeyPrevious: '' });
  const env = encrypt('refresh-token', beforeRotation);
  const olderEnv = encrypt('older-token', configuredKeys({ tokenEncryptionKey: OLDER }));

  const rotated = configuredKeys({ tokenEncryptionKey: NEW, tokenEncryptionKeyPrevious: `${OLD}, ${OLDER}` });
  assert.equal(rotated.length, 3);
  assert.deepEqual(decryptWithIndex(env, rotated), { plaintext: 'refresh-token', keyIndex: 1 });
  assert.deepEqual(decryptWithIndex(olderEnv, rotated), { plaintext: 'older-token', keyIndex: 2 });
  assert.equal(env.split('.').length, 4, 'envelope format unchanged (v1.iv.tag.ct)');

  const fresh = encrypt('new-token', rotated);
  assert.deepEqual(decryptWithIndex(fresh, rotated), { plaintext: 'new-token', keyIndex: 0 });
  assert.equal(decrypt(fresh, configuredKeys({ tokenEncryptionKey: NEW })), 'new-token', 'the current key alone opens it');
  assert.throws(() => decrypt(fresh, beforeRotation), /failed authentication/, 'the old key alone cannot open new ciphertext');
});

test('(c) a wrong key still fails, with or without previous keys; tampering still fails', () => {
  const env = encrypt('secret', configuredKeys({ tokenEncryptionKey: OLD }));
  assert.throws(() => decrypt(env, configuredKeys({ tokenEncryptionKey: NEW, tokenEncryptionKeyPrevious: OLDER })), /failed authentication/);
  assert.throws(() => decrypt(env, crypto.randomBytes(32)), /failed authentication/);
  const [v, iv, tag, ct] = env.split('.');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 1;
  assert.throws(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), configuredKeys({ tokenEncryptionKey: NEW, tokenEncryptionKeyPrevious: OLD })), /failed authentication/);
});

test('(d) a malformed previous key is rejected: fatal in production, a warning otherwise, never echoing the value', () => {
  const bad = 'c2hvcnQta2V5'; // 9 bytes
  const parsed = parsePreviousKeys(`${OLD},${bad}`);
  assert.equal(parsed.keys.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /TOKEN_ENCRYPTION_KEY_PREVIOUS entry 2 must decode to exactly 32 bytes/);
  assert.ok(!parsed.errors[0].includes(bad) && !parsed.errors[0].includes(OLD), 'no key material in the message');
  assert.deepEqual(parsePreviousKeys(''), { keys: [], errors: [] });

  const ok = { appOrigin: 'https://apex.example', cookieSecure: true, tokenEncryptionKey: NEW, bootstrapAdminPassword: '', email: { provider: 'resend' } };
  assert.deepEqual(startupProblems({ NODE_ENV: 'production' }, { ...ok, tokenEncryptionKeyPrevious: OLD }).errors, []);
  const prod = startupProblems({ NODE_ENV: 'production' }, { ...ok, tokenEncryptionKeyPrevious: bad });
  assert.equal(prod.errors.length, 1);
  assert.match(prod.errors[0], /TOKEN_ENCRYPTION_KEY_PREVIOUS/);
  const dev = startupProblems({ NODE_ENV: 'development' }, { ...ok, tokenEncryptionKeyPrevious: bad });
  assert.deepEqual(dev.errors, []);
  assert.equal(dev.warnings.length, 1);
});

// ---- (e) the rewrap CLI -----------------------------------------------------------------------

function cleanEnv(extra = {}) {
  const env = { ...process.env, LOG_LEVEL: 'error', ...extra };
  for (const k of ['SQLITE_PATH', 'DATA_DIR', 'DATABASE_URL', 'APEX_ALLOW_DEFAULT_DB', 'TOKEN_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY_PREVIOUS']) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}
const node = (script, args, env) => run(process.execPath, [path.join(apiRoot, script), ...args], { cwd: tmp, env, windowsHide: true, timeout: 60_000 })
  .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const cli = (args, env) => node('src/db/rewrap-cli.js', args, env);

test('(e) the rewrap CLI re-encrypts stored secrets under the current key on a disposable database', async () => {
  const file = path.join(tmp, 'rewrap', 'core.db');
  const oldKeys = configuredKeys({ tokenEncryptionKey: OLD });
  const migrated = await node('src/db/migrate-cli.js', [], cleanEnv({ SQLITE_PATH: file }));
  assert.equal(migrated.code, 0, migrated.stderr);
  const db = createSqliteDriver(file);
  const put = (key, value) => db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, JSON.stringify(value), new Date().toISOString()]);
  await put('dropbox.connection', { refresh_token_enc: encrypt('playbooks-token', oldKeys), account_id: 'dbid:1' });
  await put('dropbox.meetings.connection', { refresh_token_enc: encrypt('meetings-token', configuredKeys({ tokenEncryptionKey: OLDER })) });
  await put('dropbox.source.learning.connection', { refresh_token_enc: encrypt('current-token', configuredKeys({ tokenEncryptionKey: NEW })) });
  await put('dropbox.settings', { root_path: '/x' });
  const readAll = async () => Object.fromEntries((await db.query('SELECT key, value FROM settings')).map((r) => [r.key, JSON.parse(r.value)]));
  const before = await readAll();
  await db.close();

  const env = cleanEnv({ SQLITE_PATH: file, TOKEN_ENCRYPTION_KEY: NEW, TOKEN_ENCRYPTION_KEY_PREVIOUS: `${OLD},${OLDER}` });
  const dry = await cli(['--dry-run'], env);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stderr, /rewrap-secrets: target sqlite .*core\.db/);
  assert.deepEqual(JSON.parse(dry.stdout.trim().split('\n').pop()), { ok: true, dry_run: true, checked: 3, already_current: 1, rewrapped: 2, changed_meanwhile: 0, failed: [] });

  const r = await cli([], env);
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.trim().split('\n').pop();
  assert.deepEqual(JSON.parse(out), { ok: true, dry_run: false, checked: 3, already_current: 1, rewrapped: 2, changed_meanwhile: 0, failed: [] });
  for (const secret of ['playbooks-token', 'meetings-token', OLD, OLDER, NEW]) assert.ok(!`${r.stdout}${r.stderr}`.includes(secret), 'nothing secret printed');

  const db2 = createSqliteDriver(file);
  const now = Object.fromEntries((await db2.query('SELECT key, value FROM settings')).map((row) => [row.key, JSON.parse(row.value)]));
  await db2.close();
  const newOnly = configuredKeys({ tokenEncryptionKey: NEW });
  assert.equal(decrypt(now['dropbox.connection'].refresh_token_enc, newOnly), 'playbooks-token');
  assert.equal(decrypt(now['dropbox.meetings.connection'].refresh_token_enc, newOnly), 'meetings-token');
  assert.equal(now['dropbox.connection'].account_id, 'dbid:1', 'other fields kept');
  assert.equal(now['dropbox.source.learning.connection'].refresh_token_enc, before['dropbox.source.learning.connection'].refresh_token_enc, 'already-current value untouched');
  assert.deepEqual(now['dropbox.settings'], before['dropbox.settings']);
  assert.throws(() => decrypt(now['dropbox.connection'].refresh_token_enc, oldKeys), /failed authentication/);

  // Without the previous key, a value no key opens is reported (by setting key only) and left as it is.
  const db3 = createSqliteDriver(file);
  await db3.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify({ refresh_token_enc: encrypt('x', oldKeys) }), 'dropbox.connection']);
  await db3.close();
  const missing = await cli([], cleanEnv({ SQLITE_PATH: file, TOKEN_ENCRYPTION_KEY: NEW }));
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stdout.trim().split('\n').pop()).failed, ['dropbox.connection.refresh_token_enc']);

  const malformed = await cli([], cleanEnv({ SQLITE_PATH: file, TOKEN_ENCRYPTION_KEY: NEW, TOKEN_ENCRYPTION_KEY_PREVIOUS: 'too-short' }));
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /TOKEN_ENCRYPTION_KEY_PREVIOUS must decode to exactly 32 bytes/);
});

test('(e) the rewrap CLI refuses the default data directory and leaves it untouched', async () => {
  const statOf = (f) => { try { const s = fs.statSync(f); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };
  const files = ['academy.db', 'academy.db-wal', 'academy.db-shm'].map((f) => path.join(dataDir, f));
  const before = files.map(statOf);
  const r = await cli([], cleanEnv({ TOKEN_ENCRYPTION_KEY: NEW, TOKEN_ENCRYPTION_KEY_PREVIOUS: OLD }));
  assert.equal(r.code, 2, r.stderr);
  assert.ok(r.stderr.includes(`rewrap-secrets: target sqlite ${path.join(dataDir, 'academy.db')}`), r.stderr);
  assert.match(r.stderr, /refusing to run against the default data directory/);
  const probe = await cli([], cleanEnv({ SQLITE_PATH: path.join(dataDir, `__rewrap-probe-${process.pid}__`, 'x.db'), TOKEN_ENCRYPTION_KEY: NEW }));
  assert.equal(probe.code, 2);
  assert.equal(fs.existsSync(path.join(dataDir, `__rewrap-probe-${process.pid}__`)), false);
  assert.deepEqual(files.map(statOf), before, 'academy.db (and its WAL/SHM) unchanged');
});
