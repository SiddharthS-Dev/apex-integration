import { ApiError } from '@/api/drivers/http';
import { resetDb } from '@/api/drivers/demo/store';
import { createEntities } from '@/api/drivers/demo/entities';
import { createAuth } from '@/api/drivers/demo/auth';
import { createFunctions } from '@/api/drivers/demo/functions';
import { clearFiles, createFiles } from '@/api/drivers/demo/files';
import { createMeetings } from '@/api/drivers/demo/meetings';

// In-browser demo backend (VITE_BACKEND=demo): same surface as the HTTP driver, backed by an
// in-memory store persisted to localStorage, with the shared schemas and row-level security applied.

const unavailable = (what) => () => Promise.reject(new ApiError(503, `${what} is not available in demo mode`));

export const DEMO_CONFIG = Object.freeze({
  ai_enabled: true,
  ai_model: 'demo',
  media_provider: 'none',
  media_enabled: false,
  dropbox_configured: false,
  registration_open: true,
  google_enabled: false,
  max_upload_mb: 50,
  email_enabled: false,
  email_provider: 'demo',
  demo: true,
});

export function createDemoDriver() {
  return {
    kind: 'demo',
    entities: createEntities(),
    auth: createAuth(),
    functions: createFunctions(),
    files: createFiles(),
    meetings: createMeetings(),
    dropbox: {
      status: async () => ({ configured: false, connected: false }),
      connect: unavailable('Dropbox'),
      disconnect: async () => ({ ok: true }),
      updateSettings: unavailable('Dropbox'),
      listFolders: unavailable('Dropbox'),
      clearIgnored: async () => ({ cleared: 0 }),
      meetings: {
        status: async () => ({ configured: false, connected: false }),
        connect: unavailable('Dropbox'),
        disconnect: async () => ({ connected: false }),
        listFolders: unavailable('Dropbox'),
      },
    },
    sync: {
      status: async () => ({ connected: false, running: false }),
      runNow: unavailable('Dropbox sync'),
      logs: async () => [],
    },
    // No email in the demo: notifications are in-app only.
    notifications: {
      emailStatus: async () => ({
        provider: 'demo', from: '', configured: false, outbox: { queued: 0, sent: 0, failed: 0, skipped: 0 }, recent: [],
      }),
      sendTestEmail: unavailable('Email delivery'),
    },
    system: {
      config: async () => ({ ...DEMO_CONFIG }),
      metrics: async () => ({ demo: true, uptime_s: Math.round(performance.now() / 1000), requests: {}, functions: {} }),
    },
    // Demo-only: restore the seeded academy (signs everyone out).
    demo: {
      async reset() {
        clearFiles();
        resetDb();
      },
    },
  };
}

export default createDemoDriver;
