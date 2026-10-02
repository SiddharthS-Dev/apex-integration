import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { sha256Hex } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { deleteSetting, getSetting, setSetting } from '../repo/settings.js';
import { rpc } from './client.js';
import { DropboxError, saveConnection, tokenRequest } from './connection.js';

// OAuth 2 authorization-code flow (offline access → refresh token).
//
// IMPORTANT: DROPBOX_REDIRECT_URI (config.dropbox.redirectUri) must be registered in the Dropbox App
// Console ("OAuth 2 → Redirect URIs") character-for-character — scheme, host, port, path, no trailing
// slash differences. The same value is sent on /oauth2/authorize and on the code exchange; Dropbox
// rejects the exchange if they differ. Default: http://localhost:4000/api/dropbox/oauth/callback.

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_PREFIX = 'dropbox.oauth_state.';

// Creates a one-time CSRF state bound to the admin. Only its SHA-256 is stored.
export async function createState(userId) {
  await purgeExpiredStates();
  const state = crypto.randomBytes(32).toString('base64url');
  await setSetting(STATE_PREFIX + sha256Hex(state), { user_id: userId, expires_at: Date.now() + STATE_TTL_MS });
  return state;
}

// Consumes the state (one-time). Returns true only if it exists, is unexpired and belongs to userId.
export async function consumeState(state, userId) {
  if (!state || typeof state !== 'string' || state.length > 200) return false;
  const key = STATE_PREFIX + sha256Hex(state);
  const rec = await getSetting(key, null);
  if (!rec) return false;
  await deleteSetting(key);
  return rec.user_id === userId && rec.expires_at > Date.now();
}

async function purgeExpiredStates() {
  const rows = await db().query('SELECT key, value FROM settings WHERE key LIKE ?', [STATE_PREFIX + '%']);
  for (const r of rows) {
    let exp = 0;
    try { exp = JSON.parse(r.value)?.expires_at || 0; } catch { /* malformed → purge */ }
    if (exp < Date.now()) await deleteSetting(r.key);
  }
}

export function authorizeUrl(state) {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', config.dropbox.appKey);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('token_access_type', 'offline'); // offline → Dropbox issues a refresh token
  u.searchParams.set('redirect_uri', config.dropbox.redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

// Exchanges the code, reads the account, stores the encrypted connection. Returns public account info.
export async function completeAuthorization(code, userId) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.dropbox.redirectUri });
  if (!tokens.refresh_token) throw new DropboxError('Dropbox did not return a refresh token', { code: 'no_refresh_token' });
  const account = await rpc('users/get_current_account', null, { token: tokens.access_token, pathRoot: false });
  const conn = await saveConnection({ refreshToken: tokens.refresh_token, account, rootInfo: account.root_info, userId });
  log.info('dropbox.connected', { account_id: conn.account_id, team: conn.team, by: userId });
  return conn;
}

export function redirectBack(query) {
  const u = new URL(`${config.appBaseUrl}/admin/integrations`);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}
