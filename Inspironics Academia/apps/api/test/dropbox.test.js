import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decrypt, encrypt, parseKey } from '../src/lib/crypto.js';
import { httpHeaderSafeJson, normalizePath, pathRootHeader } from '../src/dropbox/client.js';
import { planSync } from '../src/sync/pipeline.js';
import { mapPool } from '../src/lib/pool.js';

// No network and no database: pure functions only.

const key = crypto.randomBytes(32);

test('AES-256-GCM round-trips and uses a fresh IV each time', () => {
  const secret = 'refresh-token-éü-🚀';
  const a = encrypt(secret, key);
  const b = encrypt(secret, key);
  assert.notEqual(a, b);
  assert.ok(!a.includes(secret));
  assert.equal(decrypt(a, key), secret);
  assert.equal(decrypt(b, key), secret);
});

test('AES-256-GCM detects tampering and wrong keys', () => {
  const env = encrypt('hello world', key);
  const [v, iv, tag, ct] = env.split('.');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 1;
  assert.throws(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), key), /failed authentication/);
  const badTag = Buffer.from(tag, 'base64url');
  badTag[3] ^= 0xff;
  assert.throws(() => decrypt([v, iv, badTag.toString('base64url'), ct].join('.'), key), /failed authentication/);
  assert.throws(() => decrypt(env, crypto.randomBytes(32)), /failed authentication/);
  assert.throws(() => decrypt('garbage', key), /Malformed/);
});

test('encryption key accepts 32-byte hex or base64 and rejects other lengths', () => {
  const raw = crypto.randomBytes(32);
  assert.deepEqual(parseKey(raw.toString('hex')), raw);
  assert.deepEqual(parseKey(raw.toString('base64')), raw);
  assert.deepEqual(parseKey(raw.toString('base64url')), raw);
  assert.throws(() => parseKey(crypto.randomBytes(16).toString('base64')), /exactly 32 bytes/);
  assert.throws(() => parseKey(''), /not set/);
  assert.throws(() => parseKey('not a key!'), /32 bytes/);
});

test('Dropbox-API-Arg escapes every non-ASCII character', () => {
  const out = httpHeaderSafeJson({ path: '/Café/Über 🚀.pdf', x: '\u007f' });
  assert.match(out, /^[\x20-\x7e]+$/);
  assert.equal(out, '{"path":"/Caf\\u00e9/\\u00dcber \\ud83d\\ude80.pdf","x":"\\u007f"}');
  assert.deepEqual(JSON.parse(out), { path: '/Café/Über 🚀.pdf', x: '\u007f' });
  assert.equal(httpHeaderSafeJson({ path: '/plain.pdf' }), '{"path":"/plain.pdf"}');
});

test('path-root header uses the root variant with the namespace id', () => {
  assert.equal(pathRootHeader('3235641'), '{".tag":"root","root":"3235641"}');
  assert.deepEqual(JSON.parse(pathRootHeader(42)), { '.tag': 'root', root: '42' });
});

test('normalizePath', () => {
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath('/'), '');
  assert.equal(normalizePath('Playbooks/'), '/Playbooks');
  assert.equal(normalizePath('//a//b/'), '/a/b');
  assert.equal(normalizePath('id:abc123'), 'id:abc123');
});

// ---- sync plan ---------------------------------------------------------------------------------

const f = (id, name, rev, size = 1000) => ({ id, name, rev, size, path_display: `/Playbooks/${name}`, content_hash: `h-${id}-${rev}` });
const pb = (id, external_id, revision, status = 'processed', extra = {}) => ({ id, external_id, revision, status, source: 'dropbox', file_name: `${id}.pdf`, dropbox_path: `/Playbooks/${external_id}.pdf`, ...extra });

test('planSync classifies new, changed, unchanged and archived files', () => {
  const discovered = [
    f('id:new', 'New Guide.pdf', 'r1'),
    f('id:chg', 'Changed.docx', 'r2'),
    f('id:same', 'id:same.pdf', 'r1'),
    f('id:img', 'diagram.png', 'r1'),
    f('id:back', 'Back.pdf', 'r1'),
  ];
  const stored = [
    pb('p-chg', 'id:chg', 'r1'),
    pb('p-same', 'id:same', 'r1', 'processed', { dropbox_path: '/Playbooks/id:same.pdf' }),
    pb('p-gone', 'id:gone', 'r9'),
    pb('p-old', 'id:old', 'r1', 'archived'),
    pb('p-back', 'id:back', 'r1', 'archived'),
  ];
  const plan = planSync(discovered, stored);
  assert.deepEqual(plan.add.map((x) => x.file.id), ['id:new']);
  assert.deepEqual(plan.update.map((x) => x.playbook.id).sort(), ['p-back', 'p-chg']);
  assert.deepEqual(plan.unchanged.map((x) => x.playbook.id), ['p-same']);
  assert.deepEqual(plan.archive.map((x) => x.id), ['p-gone']); // already-archived ones are left alone
  assert.equal(plan.skipped, 1);
});

test('planSync resumes files indexed but never processed, and flags oversized files', () => {
  const discovered = [f('id:a', 'a.pdf', 'r1'), f('id:big', 'big.pdf', 'r1', 200 * 1024 * 1024), f('id:big2', 'big2.pdf', 'r5', 200 * 1024 * 1024)];
  const stored = [pb('p-a', 'id:a', 'r1', 'uploaded'), pb('p-big2', 'id:big2', 'r5', 'failed')];
  const plan = planSync(discovered, stored, { maxBytes: 150 * 1024 * 1024 });
  assert.deepEqual(plan.resume.map((x) => x.playbook.id), ['p-a']);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].tooLarge, true);
  assert.deepEqual(plan.unchanged.map((x) => x.playbook.id), ['p-big2']);
});

test('planSync with an empty listing archives everything active; with a repeat listing does nothing', () => {
  const stored = [pb('p1', 'id:1', 'r1'), pb('p2', 'id:2', 'r1')];
  assert.equal(planSync([], stored).archive.length, 2);
  const again = planSync([f('id:1', 'one.pdf', 'r1'), f('id:2', 'two.docx', 'r1'), f('id:1', 'one.pdf', 'r1')], stored);
  assert.equal(again.unchanged.length, 2);
  assert.equal(again.add.length + again.update.length + again.archive.length, 0);
});

test('mapPool bounds concurrency and isolates failures', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (n === 4) throw new Error('boom');
    return n * 2;
  });
  assert.equal(peak, 3);
  assert.equal(results.length, 7);
  assert.deepEqual(results[0], { ok: true, value: 2 });
  assert.equal(results[3].ok, false);
  assert.equal(results[6].value, 14);
});
