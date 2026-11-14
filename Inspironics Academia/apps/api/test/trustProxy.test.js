import assert from 'node:assert/strict';
import { test } from 'node:test';

// The Core takes the browser's address from X-Forwarded-For only from the configured proxy:
// loopback by default (the gateway on this host), the gateway's internal IP in containers.
const { createApp } = await import('../src/app.js');

test('trust proxy defaults to loopback', () => {
  const before = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  try {
    const fn = createApp().get('trust proxy fn');
    assert.equal(fn('127.0.0.1', 0), true);
    assert.equal(fn('10.213.47.10', 0), false);
  } finally {
    if (before !== undefined) process.env.TRUST_PROXY = before;
  }
});

test('TRUST_PROXY names the only trusted proxy', () => {
  const before = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '10.213.47.10';
  try {
    const fn = createApp().get('trust proxy fn');
    assert.equal(fn('10.213.47.10', 0), true);
    assert.equal(fn('10.213.47.11', 0), false);
    assert.equal(fn('127.0.0.1', 0), false);
  } finally {
    if (before === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = before;
  }
});
