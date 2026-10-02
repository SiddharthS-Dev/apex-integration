import { ApiError } from '@/api/drivers/http';
import { resetDb } from '@/api/drivers/demo/store';
import { createEntities } from '@/api/drivers/demo/entities';
import { createAuth } from '@/api/drivers/demo/auth';
import { createFunctions } from '@/api/drivers/demo/functions';
import { clearFiles, createFiles } from '@/api/drivers/demo/files';

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
  demo: true,
});

export function createDemoDriver() {
  return {
    kind: 'demo',
    entities: createEntities(),
    auth: createAuth(),
    functions: createFunctions(),
    files: createFiles(),
    dropbox: {
      status: async () => ({ configured: false, connected: false }),
      connect: unavailable('Dropbox'),
      disconnect: async () => ({ ok: true }),
      updateSettings: unavailable('Dropbox'),
      listFolders: unavailable('Dropbox'),
    },
    sync: {
      status: async () => ({ connected: false, running: false }),
      runNow: unavailable('Dropbox sync'),
      logs: async () => [],
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
