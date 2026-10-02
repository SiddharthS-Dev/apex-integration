import express from 'express';
import { config, dropboxConfigured } from '../config.js';
import { requireAdmin } from '../auth/sessions.js';
import { parseKey } from '../lib/crypto.js';
import { HttpError, asyncHandler, badRequest } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { latestSyncLog } from '../sync/log.js';
import { DropboxError, disconnect, getConnectionStatus, listSubfolders, normalizePath, rpc } from './client.js';
import { loadConnection, saveSyncSettings } from './connection.js';
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

// root_path: '' = whole Dropbox (or the team space root). Narrowing it means the next sync archives
// every Dropbox playbook outside the new folder (they are never deleted and come back if re-included).
router.patch('/settings', requireAdmin, requireConfigured, asyncHandler(async (req, res) => {
  const raw = req.body?.root_path;
  if (raw === undefined) throw badRequest('root_path is required');
  if (typeof raw !== 'string' || raw.length > 1000) throw badRequest('root_path must be a string');
  if (/[\u0000-\u001f]/.test(raw) || raw.split(/[\\/]/).some((seg) => seg === '..' || seg === '.')) throw badRequest('root_path contains invalid segments');
  const rootPath = normalizePath(raw);
  if (/^(id|ns|rev):/.test(rootPath)) throw badRequest('root_path must be a folder path');
  if (rootPath && (await loadConnection())) {
    try {
      const meta = await rpc('files/get_metadata', { path: rootPath });
      if (meta?.['.tag'] !== 'folder') throw badRequest('root_path is not a folder');
    } catch (err) {
      throw toHttp(err);
    }
  }
  const saved = await saveSyncSettings({ root_path: rootPath });
  log.info('dropbox.root_changed', { by: req.user.id });
  res.json(saved);
}));

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
