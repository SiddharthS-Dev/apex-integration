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
  video_render_enabled: false,
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
      sources: {
        list: async () => [],
        connect: unavailable('Dropbox'),
        disconnect: unavailable('Dropbox'),
        listFolders: unavailable('Dropbox'),
        setFolder: unavailable('Dropbox'),
      },
    },
    // AI Studio needs the API server (AI, voice and FFmpeg run there).
    studio: {
      config: async () => ({ ai: { provider: 'none', enabled: false, providers: [] }, voice: { enabled: false, providers: [], defaults: {} }, video: { enabled: false }, content_types: [], auto_generate_audio: false, demo: true }),
      generate: unavailable('AI Studio'),
      voices: async () => [],
      voice: unavailable('AI Studio'),
      projects: async () => [],
      project: unavailable('AI Studio'),
      createProject: unavailable('AI Studio'),
      createFromDocument: unavailable('AI Studio'),
      updateProject: unavailable('AI Studio'),
      deleteProject: unavailable('AI Studio'),
      uploadSceneImage: unavailable('AI Studio'),
      removeSceneImage: unavailable('AI Studio'),
      scenePreviewUrl: () => '',
      render: unavailable('AI Studio'),
      rerenderScene: unavailable('AI Studio'),
      jobs: async () => [],
      job: unavailable('AI Studio'),
      cancelJob: unavailable('AI Studio'),
      retryJob: unavailable('AI Studio'),
      history: async () => [],
      usage: async () => null,
      setLimits: unavailable('AI Studio'),
      dropboxAccounts: async () => [],
      browseDropbox: unavailable('Dropbox'),
      createFromDropbox: unavailable('Dropbox'),
      storage: async () => null,
      storageOverview: async () => null,
      cleanupStorage: unavailable('Storage clean-up'),
      setOutput: unavailable('Storage settings'),
      courses: async () => [],
      courseProgress: unavailable('AI Studio'),
      generateCourse: unavailable('AI Studio'),
      checkCourseQuality: unavailable('AI Studio'),
      approvePassedLessons: unavailable('AI Studio'),
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
    // APEX Core (people, organisations, roles, identity links, audit) lives only in the API server.
    // The screens check `backendKind` and show a notice; these keep any stray call a clean 503.
    core: Object.fromEntries([
      'me', 'users', 'user', 'organizations', 'createOrganization', 'members', 'addMember', 'endMembership',
      'grantRole', 'revokeRole', 'transitionRole', 'links', 'proposeLink', 'confirmLink', 'rejectLink', 'auditEvents',
    ].map((name) => [name, unavailable('APEX Core')])),
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
