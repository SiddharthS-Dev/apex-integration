import express from 'express';
import { config, dropboxConfigured } from '../config.js';
import { requireAdmin } from '../auth/sessions.js';
import { parseKey } from '../lib/crypto.js';
import { HttpError, asyncHandler, badRequest } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { latestSyncLog } from '../sync/log.js';
import { DropboxError, disconnect, getConnectionStatus, listSubfolders, normalizePath, rpc } from './client.js';
import {
  getSyncSettings, loadConnection, meetingsAccount, meetingsAppConfigured, saveSyncSettings, withDropboxAccount,
} from './connection.js';
import { clearIgnoredDropboxIds, ignoredDropboxIds } from '../pipeline/deletePlaybooks.js';
import { authorizeUrl, completeAuthorization, consumeState, createState, redirectBack } from './oauth.js';

const router = express.Router();

function configProblem() {
  const missing = [];
  if (!config.dropbox.appKey) missing.push('DROPBOX_APP_KEY');
  if (!config.dropbox.appSecret) missing.push('DROPBOX_APP_SECRET');
  if (!config.tokenEncryptionKey) missing.push('TOKEN_ENCRYPTION_KEY');
  if (missing.length) return `Dropbox is not configured — set ${missing.join(', ')} (and DROPBOX_REDIRECT_URI) on the API server`;
  try { parseKey(config.tokenEncryptionKey); } catch (err) { return err.message; }
  return null;
}

function requireConfigured(_req, _res, next) {
  const problem = configProblem();
  next(problem ? new HttpError(503, problem) : undefined);
}

async function requireConnected(_req, _res, next) {
  try {
    next((await loadConnection()) ? undefined : new HttpError(409, 'Dropbox is not connected'));
  } catch (err) { next(err); }
}

// Maps Dropbox failures to client-safe errors (short message, no tokens or URLs).
function toHttp(err) {
  if (!(err instanceof DropboxError)) return err;
  if (err.code === 'reconnect_required') return new HttpError(409, err.message);
  if (err.status === 409 && /not_found/.test(err.summary || '')) return new HttpError(404, 'Folder not found in Dropbox');
  return new HttpError(502, err.message);
}

router.get('/status', requireAdmin, asyncHandler(async (_req, res) => {
  // The OAuth callback this server sends Dropbox to — not a secret, and the one value an admin must copy
  // into the App Console ("OAuth 2 → Redirect URIs") before Connect can work.
  const redirectUri = config.dropbox.redirectUri;
  if (!dropboxConfigured()) return res.json({ configured: false, connected: false, message: configProblem(), redirect_uri: redirectUri });
  const status = await getConnectionStatus();
  res.json({
    configured: true,
    connected: status.connected,
    account_email: status.account_email ?? null,
    account_name: status.account_name ?? null,
    team: status.team ?? false,
    team_name: status.team_name ?? null,
    root_path: status.root_path ?? '',
    meetings_path: (await getSyncSettings()).meetings_path,
    // Files deleted in the app with "keep out of future syncs": the sync skips them.
    ignored_count: (await ignoredDropboxIds()).size,
    // Meeting transcripts have a Dropbox app of their own (see /meetings/status).
    meetings_app: meetingsAppConfigured(),
    connected_at: status.connected_at ?? null,
    needs_reconnect: status.needs_reconnect ?? false,
    last_sync: await latestSyncLog(),
    redirect_uri: redirectUri,
  });
}));

// ---- OAuth ------------------------------------------------------------------------------------

router.get('/oauth/start', requireAdmin, requireConfigured, asyncHandler(async (req, res) => {
  const state = await createState(req.user.id);
  res.redirect(302, authorizeUrl(state));
}));

// Dropbox redirects the admin's browser here (top-level GET, so the SameSite=Lax session cookie is sent).
// Always answers with a redirect back to the web app; never echoes the code or any token.
router.get('/oauth/callback', asyncHandler(async (req, res) => {
  const fail = (reason) => res.redirect(302, redirectBack({ dropbox: 'error', reason }));
  if (!req.user || req.user.role !== 'admin') return fail('not_admin');
  if (configProblem()) return fail('not_configured');
  const { code, state, error } = req.query;
  if (!(await consumeState(state, req.user.id))) return fail('invalid_state');
  if (error) return fail(String(error) === 'access_denied' ? 'access_denied' : 'authorization_failed');
  if (!code || typeof code !== 'string') return fail('missing_code');
  try {
    await completeAuthorization(code, req.user.id);
  } catch (err) {
    log.warn('dropbox.oauth_failed', { error: err.message });
    return fail('exchange_failed');
  }
  res.redirect(302, redirectBack({ dropbox: 'connected' }));
}));

// ---- connection management ------------------------------------------------------------------------

router.post('/disconnect', requireAdmin, requireConfigured, asyncHandler(async (req, res) => {
  await disconnect();
  log.info('dropbox.disconnected', { by: req.user.id });
  res.json({ connected: false });
}));

// root_path: the playbooks folder. It can't be the whole Dropbox ('' = not chosen; nothing syncs until
// it is). Narrowing it means the next sync archives every Dropbox playbook outside the new folder
// (they are never deleted and come back if re-included).
// meetings_path: the folder whose transcripts become Meetings ('' = meetings are not synced). Files in
// it are never treated as playbooks, even when it sits inside root_path.
async function folderSetting(raw, name) {
  if (typeof raw !== 'string' || raw.length > 1000) throw badRequest(`${name} must be a string`);
  if (/[\u0000-\u001f]/.test(raw) || raw.split(/[\\/]/).some((seg) => seg === '..' || seg === '.')) throw badRequest(`${name} contains invalid segments`);
  const path = normalizePath(raw);
  if (/^(id|ns|rev):/.test(path)) throw badRequest(`${name} must be a folder path`);
  if (path && (await loadConnection())) {
    try {
      const meta = await rpc('files/get_metadata', { path });
      if (meta?.['.tag'] !== 'folder') throw badRequest(`${name} is not a folder`);
    } catch (err) {
      throw toHttp(err);
    }
  }
  return path;
}

router.patch('/settings', requireAdmin, requireConfigured, asyncHandler(async (req, res) => {
  const { root_path: root, meetings_path: meetings } = req.body || {};
  if (root === undefined && meetings === undefined) throw badRequest('root_path or meetings_path is required');
  const patch = {};
  if (root !== undefined) {
    patch.root_path = await folderSetting(root, 'root_path');
    if (!patch.root_path) throw badRequest('Choose the playbooks folder, not the whole Dropbox: syncing all of it would turn every PDF and Word file into a playbook.');
  }
  if (meetings !== undefined) {
    // Checked against the account transcripts are read through. '/' is the whole meetings app — only
    // offered for a meetings app of its own (an App folder app sees just its own folder).
    patch.meetings_path = meetings === '/' && meetingsAppConfigured()
      ? '/'
      : await withDropboxAccount(meetingsAccount(), () => folderSetting(meetings, 'meetings_path'));
  }
  const saved = await saveSyncSettings(patch);
  log.info('dropbox.settings_changed', { by: req.user.id, fields: Object.keys(patch) });
  res.json(saved);
}));

// Lets every file that was deleted with "keep out of future syncs" sync again.
router.post('/ignored/clear', requireAdmin, asyncHandler(async (req, res) => {
  const cleared = await clearIgnoredDropboxIds();
  log.info('dropbox.ignored_cleared', { by: req.user.id, cleared });
  res.json({ cleared });
}));

// ---- the meetings app ---------------------------------------------------------------------------
// The same connection lifecycle for the Dropbox app meeting transcripts come through. Its redirect URI
// (config.dropbox.meetings.redirectUri, …/dropbox/meetings/oauth/callback) is registered on that app.

const meetingsRouter = express.Router();
const inMeetings = (handler) => asyncHandler((req, res, next) => withDropboxAccount('meetings', () => handler(req, res, next)));

function meetingsProblem() {
  if (!meetingsAppConfigured()) return 'The meetings Dropbox app is not set up — set DROPBOX_MEETINGS_APP_KEY and DROPBOX_MEETINGS_APP_SECRET on the API server';
  if (!config.tokenEncryptionKey) return 'TOKEN_ENCRYPTION_KEY is not set on the API server';
  try { parseKey(config.tokenEncryptionKey); } catch (err) { return err.message; }
  return null;
}
const requireMeetingsApp = (_req, _res, next) => {
  const problem = meetingsProblem();
  next(problem ? new HttpError(503, problem) : undefined);
};

meetingsRouter.get('/status', requireAdmin, inMeetings(async (_req, res) => {
  const redirectUri = config.dropbox.meetings.redirectUri;
  if (!meetingsAppConfigured()) return res.json({ configured: false, connected: false, redirect_uri: redirectUri });
  const conn = await loadConnection();
  res.json({
    configured: !meetingsProblem(),
    message: meetingsProblem(),
    connected: !!conn,
    account_email: conn?.account_email ?? null,
    account_name: conn?.account_name ?? null,
    connected_at: conn?.connected_at ?? null,
    needs_reconnect: !!conn?.needs_reconnect,
    meetings_path: (await getSyncSettings()).meetings_path,
    redirect_uri: redirectUri,
  });
}));

meetingsRouter.get('/oauth/start', requireAdmin, requireMeetingsApp, inMeetings(async (req, res) => {
  res.redirect(302, authorizeUrl(await createState(req.user.id)));
}));

meetingsRouter.get('/oauth/callback', inMeetings(async (req, res) => {
  const fail = (reason) => res.redirect(302, redirectBack({ dropbox: 'error', app: 'meetings', reason }));
  if (!req.user || req.user.role !== 'admin') return fail('not_admin');
  if (meetingsProblem()) return fail('not_configured');
  const { code, state, error } = req.query;
  if (!(await consumeState(state, req.user.id))) return fail('invalid_state');
  if (error) return fail(String(error) === 'access_denied' ? 'access_denied' : 'authorization_failed');
  if (!code || typeof code !== 'string') return fail('missing_code');
  try {
    await completeAuthorization(code, req.user.id);
  } catch (err) {
    log.warn('dropbox.meetings_oauth_failed', { error: err.message });
    return fail('exchange_failed');
  }
  res.redirect(302, redirectBack({ dropbox: 'connected', app: 'meetings' }));
}));

meetingsRouter.post('/disconnect', requireAdmin, requireMeetingsApp, inMeetings(async (req, res) => {
  await disconnect();
  log.info('dropbox.meetings_disconnected', { by: req.user.id });
  res.json({ connected: false });
}));

meetingsRouter.get('/folders', requireAdmin, requireMeetingsApp, inMeetings(async (req, res) => {
  if (!(await loadConnection())) throw new HttpError(409, 'The meetings Dropbox is not connected');
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (path.split(/[\\/]/).some((seg) => seg === '..')) throw badRequest('Invalid path');
  try {
    res.json(await listSubfolders(path));
  } catch (err) {
    throw toHttp(err);
  }
}));

router.use('/meetings', meetingsRouter);

router.get('/folders', requireAdmin, requireConfigured, requireConnected, asyncHandler(async (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (path.split(/[\\/]/).some((seg) => seg === '..')) throw badRequest('Invalid path');
  try {
    res.json(await listSubfolders(path));
  } catch (err) {
    throw toHttp(err);
  }
}));

export default router;
