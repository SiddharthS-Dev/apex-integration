/**
 * Password hashing: current scrypt cost, old hashes still verify, and a
 * successful sign-in upgrades an old hash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { hashPassword, needsRehash, verifyPassword } from '../../src/db/repositories/userRepository.js';
import { createTestStack, startServer } from '../helpers/testEnv.js';

/** A hash in the stored format, made with the old N=2^14 parameters. */
function legacyHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), derived.toString('base64')].join('$');
}

test('new hashes use N=2^17 and verify', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.equal(stored.split('$')[1], String(2 ** 17));
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('wrong', stored), false);
  assert.equal(needsRehash(stored), false);
});

test('old N=2^14 hashes still verify and are flagged for rehash', async () => {
  const stored = legacyHash('old-but-valid-pw');
  assert.equal(await verifyPassword('old-but-valid-pw', stored), true);
  assert.equal(needsRehash(stored), true);
  assert.equal(needsRehash(''), false, 'a passwordless account has nothing to rehash');
});

test('an absurd stored N is refused rather than attempted', async () => {
  const stored = ['scrypt', 2 ** 24, 8, 1, 'AAAA', 'AAAA'].join('$');
  assert.equal(await verifyPassword('x', stored), false);
});

test('a successful sign-in upgrades a legacy hash in place', async (t) => {
  const stack = await createTestStack();
  const client = await startServer(stack.app);
  t.after(async () => {
    await client.close();
    await stack.close();
  });

  const user = await stack.container.users.create({ email: 'legacy@example.com', password: 'placeholder-pw', role: 'user' });
  await stack.db.execute('UPDATE app_user SET password_hash = ? WHERE id = ?', [legacyHash('legacy-password'), user.id]);

  const failed = await client.login('legacy@example.com', 'not-the-password');
  assert.equal(failed.status, 401);
  assert.equal(needsRehash((await stack.container.users.findById(user.id)).password_hash), true, 'a failed sign-in changes nothing');

  assert.equal((await client.login('legacy@example.com', 'legacy-password')).status, 200);
  const after = (await stack.container.users.findById(user.id)).password_hash;
  assert.equal(needsRehash(after), false);
  assert.equal(await verifyPassword('legacy-password', after), true);
});
