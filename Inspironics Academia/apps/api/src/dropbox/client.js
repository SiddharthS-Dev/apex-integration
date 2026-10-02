import { log } from '../lib/logger.js';
import {
  DropboxError, clearAccessToken, deleteConnection, getAccessToken, getSyncSettings, loadConnection, updateConnection,
} from './connection.js';

// Server-side Dropbox API client. The browser never talks to Dropbox: every call, including file
// downloads, goes through here with a short-lived access token held in memory (see connection.js).
// Never log or return URLs with tokens, the tokens themselves, or share links.

export { DropboxError };

const RPC_HOST = 'https://api.dropboxapi.com/2/';
const CONTENT_HOST = 'https://content.dropboxapi.com/2/';
const MAX_ATTEMPTS = 5;

// Dropbox-API-Arg must be HTTP-header safe: JSON with every char U+007F and above written as \uXXXX.
// (JSON.stringify already escapes control characters; astral chars become surrogate-pair escapes.)
export function httpHeaderSafeJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Team accounts: address the team space root. The `root` variant (vs `namespace_id`) makes Dropbox
// verify the id is still the account's current root namespace and fail with `invalid_root` otherwise.
export function pathRootHeader(rootNamespaceId) {
  return httpHeaderSafeJson({ '.tag': 'root', root: String(rootNamespaceId) });
}

// Dropbox paths: '' is the root; everything else starts with '/' and has no trailing slash.
export function normalizePath(p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!s || s === '/') return '';
  if (/^(id|ns|rev):/.test(s)) return s;
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryDelay(res, attempt, body) {
  const header = Number(res?.headers?.get('retry-after'));
  const fromBody = Number(body?.error?.retry_after);
  const sec = Number.isFinite(header) && header > 0 ? header : Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 0;
  if (sec) return Math.min(sec, 300) * 1000;
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}

async function readError(res) {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return { error_summary: text.slice(0, 120) }; }
}

function pathRootFor(conn) {
  return conn?.team && conn.root_namespace_id ? pathRootHeader(conn.root_namespace_id) : null;
}

// Low-level call. `kind` is 'rpc' (JSON body) or 'content' (args in Dropbox-API-Arg, binary response).
// Handles: 429/5xx/network retry with backoff (honours Retry-After), 401 → drop cached token and retry
// once, invalid_root → store the new root namespace id and retry once.
async function call(kind, endpoint, payload, { token: explicitToken, pathRoot = true } = {}) {
  let retried401 = false;
  let retriedRoot = false;
  for (let attempt = 0; ; attempt++) {
    const conn = pathRoot ? await loadConnection() : null;
    const token = explicitToken || (await getAccessToken());
    const headers = { Authorization: `Bearer ${token}` };
    const root = pathRoot ? pathRootFor(conn) : null;
    if (root) headers['Dropbox-API-Path-Root'] = root;
    let body;
    if (kind === 'rpc') {
      if (payload !== undefined && payload !== null) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(payload);
      }
    } else {
      headers['Dropbox-API-Arg'] = httpHeaderSafeJson(payload ?? {});
    }

    let res;
    try {
      res = await fetch((kind === 'rpc' ? RPC_HOST : CONTENT_HOST) + endpoint, { method: 'POST', headers, body });
    } catch (err) {
      if (attempt + 1 < MAX_ATTEMPTS) { await sleep(retryDelay(null, attempt)); continue; }
      throw new DropboxError(`Dropbox unreachable (${endpoint}): ${err.cause?.code || err.code || 'network error'}`, { code: 'network' });
    }

    if (res.ok) {
      if (kind === 'content') return { buffer: Buffer.from(await res.arrayBuffer()), result: safeParse(res.headers.get('dropbox-api-result')) };
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    const err = await readError(res);
    const summary = String(err.error_summary || '').slice(0, 160);

    if (res.status === 401 && !explicitToken && !retried401) {
      retried401 = true;
      clearAccessToken();
      continue;
    }
    // Path-root error: the team's root namespace changed (e.g. migrated to a team space).
    const invalidRoot = err.error?.['.tag'] === 'invalid_root' ? err.error.invalid_root : null;
    if (invalidRoot?.root_namespace_id && pathRoot && !retriedRoot && invalidRoot.root_namespace_id !== conn?.root_namespace_id) {
      retriedRoot = true;
      await updateConnection({ root_namespace_id: invalidRoot.root_namespace_id, team: invalidRoot['.tag'] === 'team' });
      log.warn('dropbox.root_namespace_changed', { endpoint });
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt + 1 < MAX_ATTEMPTS) {
      const wait = retryDelay(res, attempt, err);
      log.warn('dropbox.retry', { endpoint, status: res.status, wait_ms: wait });
      await sleep(wait);
      continue;
    }
    throw new DropboxError(`Dropbox ${endpoint} failed (${res.status}${summary ? `: ${summary}` : ''})`, { status: res.status, summary, code: err.error?.['.tag'] });
  }
}

function safeParse(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

export const rpc = (endpoint, body, opts) => call('rpc', endpoint, body, opts);
export const content = (endpoint, arg, opts) => call('content', endpoint, arg, opts);

// ---- high-level helpers ------------------------------------------------------------------------

export async function downloadFile(fileIdOrPath) {
  const { buffer } = await content('files/download', { path: normalizePath(fileIdOrPath) });
  return buffer;
}

async function listAll(path, { recursive }) {
  const entries = [];
  let page = await rpc('files/list_folder', { path: normalizePath(path), recursive, include_deleted: false, include_non_downloadable_files: false, limit: 2000 });
  entries.push(...page.entries);
  while (page.has_more) {
    page = await rpc('files/list_folder/continue', { cursor: page.cursor });
    entries.push(...page.entries);
  }
  return entries;
}

// All files under `path` (recursive), as plain metadata objects.
export async function listFolderRecursive(path) {
  const entries = await listAll(path, { recursive: true });
  return entries.filter((e) => e['.tag'] === 'file').map((e) => ({
    id: e.id,
    name: e.name,
    path_display: e.path_display,
    path_lower: e.path_lower,
    rev: e.rev,
    size: e.size,
    content_hash: e.content_hash,
    server_modified: e.server_modified,
  }));
}

export async function listSubfolders(path) {
  const entries = await listAll(path, { recursive: false });
  return entries
    .filter((e) => e['.tag'] === 'folder')
    .map((e) => ({ name: e.name, path: e.path_display }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Public (token-free) view of the connection.
export async function getConnectionStatus() {
  const conn = await loadConnection();
  const { root_path } = await getSyncSettings();
  if (!conn) return { connected: false, root_path };
  return {
    connected: true,
    account_email: conn.account_email,
    account_name: conn.account_name,
    team: !!conn.team,
    team_name: conn.team_name || null,
    root_path,
    connected_at: conn.connected_at,
    needs_reconnect: !!conn.needs_reconnect,
  };
}

// Revokes the token at Dropbox (best effort), then deletes the stored connection.
export async function disconnect() {
  try {
    const conn = await loadConnection();
    if (conn) await rpc('auth/token/revoke', null, { pathRoot: false });
  } catch (err) {
    log.warn('dropbox.revoke_failed', { error: err.message });
  }
  await deleteConnection();
}
