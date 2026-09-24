/**
 * Test harness: a complete server stack against an in-memory database and a
 * fake Dropbox.
 *
 * Nothing here stubs the code under test — the container is the production
 * container, wired with a different `fetchImpl` and a temporary directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildConfig } from '../../src/config/index.js';
import { createDatabase } from '../../src/db/index.js';
import { createContainer, bootstrapAdmin } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { nullLogger } from '../../src/util/logger.js';
import { Metrics } from '../../src/services/metrics/metrics.js';
import { createFakeDropbox } from './fakeDropbox.js';

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

export const ADMIN = { email: 'admin@example.com', password: 'test-admin-password' };

/** A config for tests: in-memory database, temp object store, AI off. */
export function testConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidesvault-test-'));
  return buildConfig({
    NODE_ENV: 'test',
    PORT: '0',
    LOG_LEVEL: 'silent',
    APP_BASE_URL: 'http://localhost:5173',
    API_BASE_URL: 'http://localhost:4000',
    DB_DRIVER: 'sqlite',
    DB_FILE: ':memory:',
    DROPBOX_APP_KEY: 'fake-app-key',
    DROPBOX_APP_SECRET: 'fake-app-secret',
    DROPBOX_REDIRECT_URI: 'http://localhost:4000/api/dropbox/oauth/callback',
    DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    DROPBOX_SYNC_ENABLED: 'false',
    DROPBOX_MAX_RETRIES: '4',
    DROPBOX_BACKOFF_BASE_MS: '1',
    DROPBOX_BACKOFF_CAP_MS: '4',
    DROPBOX_MAX_CONCURRENT_FILES: '4',
    AI_ENABLED: 'false',
    OBJECT_STORE_DIR: path.join(dir, 'objects'),
    BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
    SESSION_COOKIE_SECURE: 'false',
    RATE_LIMIT_MAX_REQUESTS: '10000',
    RATE_LIMIT_ADMIN_MAX_REQUESTS: '10000',
    ...overrides,
  });
}

/**
 * Builds a container (and optionally an app) over a fake Dropbox.
 *
 * @param {{files?: object[], configOverrides?: object, aiProvider?: object, withApp?: boolean}} [options]
 */
export async function createTestStack({ files = [], configOverrides = {}, aiProvider, withApp = true } = {}) {
  const config = testConfig(configOverrides);
  const dropbox = createFakeDropbox({ files });
  const db = await createDatabase(config, nullLogger);
  const metrics = new Metrics();

  const container = createContainer({
    config,
    db,
    logger: nullLogger,
    metrics,
    fetchImpl: dropbox.fetchImpl,
    aiProvider,
  });

  await bootstrapAdmin({ config, users: container.users, logger: nullLogger });

  const app = withApp ? createApp(container) : null;

  return {
    config,
    db,
    container,
    dropbox,
    metrics,
    app,
    async close() {
      container.scheduler.stop();
      await db.close();
      fs.rmSync(config.objectStore.dir, { recursive: true, force: true });
    },
  };
}

/** Puts the stack in the "Dropbox already connected" state. */
export async function connectDropbox(stack, { rootFolder = '' } = {}) {
  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    account_id: 'dbid:FAKEACCOUNT',
    account_name: 'Avery Raman',
    account_email: 'avery.raman@inspironics.net',
    connection_status: 'connected',
    root_folder: rootFolder,
    last_connected_at: new Date().toISOString(),
  });
  return stack.container.connections.get('dropbox');
}

/* -------------------------------------------------------------- HTTP ---- */

/** Starts the app on an ephemeral port and returns a small HTTP client. */
export async function startServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // One cookie jar per client, so a signed-in and an anonymous client can
  // coexist in the same test.
  const jar = new Map();

  const request = async (method, url, { body, headers = {}, redirect = 'manual' } = {}) => {
    const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(`${base}${url}`, {
      method,
      redirect,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) jar.set(name, value);
      else jar.delete(name);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

    return { status: response.status, body: payload, headers: response.headers, response };
  };

  return {
    base,
    server,
    jar,
    get: (url, options) => request('GET', url, options),
    post: (url, body, options) => request('POST', url, { ...options, body: body ?? {} }),
    async login(email = ADMIN.email, password = ADMIN.password) {
      return request('POST', '/api/auth/login', { body: { email, password } });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A deterministic random source, so backoff jitter does not flake a test. */
export const fixedRandom = () => 0.5;

export const uuid = () => crypto.randomUUID();
