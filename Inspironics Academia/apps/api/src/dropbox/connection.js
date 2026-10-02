import { config } from '../config.js';
import { withLock } from '../db/locks.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { deleteSetting, getSetting, setSetting } from '../repo/settings.js';

// Credential model
// ----------------
// The *refresh token* is the connection: it is AES-256-GCM encrypted and stored in settings under
// `dropbox.connection`, together with non-secret account metadata. The *access token* is ephemeral:
// minted on demand from the refresh token, held only in this process's memory with its expiry, and
// never written to the database, returned from an endpoint, or logged.

export const CONNECTION_KEY = 'dropbox.connection';
export const SETTINGS_KEY = 'dropbox.settings';
export const TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';

export class DropboxError extends Error {
  constructor(message, { status, code, summary } = {}) {
    super(message);
    this.name = 'DropboxError';
    this.status = status;
    this.code = code;
    this.summary = summary;
  }
}

// ---- stored connection --------------------------------------------------------------------

export async function loadConnection() {
  return getSetting(CONNECTION_KEY, null);
}

export async function saveConnection({ refreshToken, account, rootInfo, userId }) {
  const team = rootInfo?.['.tag'] === 'team';
  const conn = {
    refresh_token_enc: encrypt(refreshToken),
    account_id: account.account_id,
    account_email: account.email || null,
    account_name: account.name?.display_name || null,
    team,
    team_name: account.team?.name || null,
    root_namespace_id: rootInfo?.root_namespace_id || null,
    home_namespace_id: rootInfo?.home_namespace_id || null,
    connected_at: new Date().toISOString(),
    connected_by: userId || null,
  };
  await setSetting(CONNECTION_KEY, conn);
  clearAccessToken();
  return conn;
}

export async function updateConnection(patch) {
  const conn = await loadConnection();
  if (!conn) return null;
  const next = { ...conn, ...patch };
  await setSetting(CONNECTION_KEY, next);
  return next;
}

export async function deleteConnection() {
  await deleteSetting(CONNECTION_KEY);
  clearAccessToken();
}

export async function getSyncSettings() {
  const s = await getSetting(SETTINGS_KEY, null);
  return { root_path: s?.root_path ?? config.dropbox.defaultRoot ?? '' };
}

export async function saveSyncSettings(patch) {
  const next = { ...(await getSyncSettings()), ...patch };
  await setSetting(SETTINGS_KEY, next);
  return next;
}

// ---- token endpoint -----------------------------------------------------------------------

function basicAuth() {
  return 'Basic ' + Buffer.from(`${config.dropbox.appKey}:${config.dropbox.appSecret}`).toString('base64');
}

// POSTs a form to the OAuth token endpoint. Error messages carry only Dropbox's error code.
export async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw new DropboxError(`Dropbox token endpoint unreachable: ${err.code || err.message}`, { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : data.error?.['.tag'] || `http_${res.status}`;
    throw new DropboxError(`Dropbox token request failed (${code})`, { status: res.status, code });
  }
  return data;
}

// ---- ephemeral access token -----------------------------------------------------------------

let cached = null; // { token, expiresAt }
let inflight = null;

export function clearAccessToken() {
  cached = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mintAccessToken() {
  const conn = await loadConnection();
  if (!conn?.refresh_token_enc) throw new DropboxError('Dropbox is not connected', { code: 'not_connected' });
  const refreshToken = decrypt(conn.refresh_token_enc);
  let data;
  try {
    data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  } catch (err) {
    if (err.code === 'invalid_grant') {
      await updateConnection({ needs_reconnect: true });
      throw new DropboxError('The Dropbox connection was revoked or expired — reconnect Dropbox', { status: 401, code: 'reconnect_required' });
    }
    throw err;
  }
  if (conn.needs_reconnect) await updateConnection({ needs_reconnect: false });
  const ttlSec = Number(data.expires_in) || 14400;
  log.info('dropbox.access_token_minted', { expires_in_s: ttlSec });
  return { token: data.access_token, expiresAt: Date.now() + ttlSec * 1000 };
}

// Cross-instance: serialise refreshes with a DB lock (brief wait if another instance holds it).
async function refreshWithLock() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { acquired, result } = await withLock('dropbox:token-refresh', mintAccessToken, { ttlMs: 30_000 });
    if (acquired) return result;
    await sleep(300);
  }
  return mintAccessToken();
}

// Returns a valid access token, refreshing when missing or within 60 s of expiry.
// Concurrent callers in this process share one in-flight refresh.
export async function getAccessToken() {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  if (!inflight) {
    inflight = refreshWithLock()
      .then((t) => { cached = t; return t.token; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
