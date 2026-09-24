/**
 * Shared Dropbox OAuth + request helpers for the SlidesVault backend functions.
 *
 * Security rule that governs this whole module: access tokens are NEVER
 * persisted. Only the long-lived refresh token lives in the DropboxConfig
 * entity. Access tokens are minted on demand and held in module memory for the
 * lifetime of the isolate, so a leaked database row cannot be replayed.
 */

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const MAX_ATTEMPTS = 4;
const BACKOFF_CAP_MS = 8000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** In-memory only. Deliberately not written anywhere. */
let cachedToken: CachedToken | null = null;

export interface DropboxConfigRecord {
  id: string;
  refresh_token?: string;
  account_id?: string;
  connected_account_name?: string;
  connected_account_email?: string;
  root_folder?: string;
  connection_status: 'connected' | 'disconnected' | 'error';
  sync_status?: 'idle' | 'running' | 'success' | 'error';
  last_sync?: string;
  last_token_refresh?: string;
  last_error?: string;
}

export function appKey(): string {
  const key = Deno.env.get('DROPBOX_APP_KEY');
  if (!key) throw new Error('DROPBOX_APP_KEY is not configured.');
  return key;
}

export function appSecret(): string {
  const secret = Deno.env.get('DROPBOX_APP_SECRET');
  if (!secret) throw new Error('DROPBOX_APP_SECRET is not configured.');
  return secret;
}

/** Ensures a Dropbox path starts with "/" and carries no trailing slash. */
export function normalizeRootFolder(path?: string | null): string {
  const raw = (path ?? Deno.env.get('DROPBOX_ROOT_FOLDER') ?? '').trim();
  if (!raw || raw === '/') return '';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/** Reads the newest DropboxConfig record (the app keeps a single live config). */
export async function readConfig(base44: any): Promise<DropboxConfigRecord | null> {
  const rows = await base44.asServiceRole.entities.DropboxConfig.list('-created_date', 1);
  return rows?.[0] ?? null;
}

export async function writeConfig(base44: any, id: string, patch: Record<string, unknown>) {
  return base44.asServiceRole.entities.DropboxConfig.update(id, patch);
}

/** Exchanges a refresh token for a short-lived access token. */
export async function refreshAccessToken(base44: any, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey(),
    client_secret: appSecret(),
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Dropbox token refresh failed: ${payload.error_description || response.status}`);
  }

  cachedToken = {
    token: payload.access_token,
    // Refresh a minute early so an in-flight request never races the expiry.
    expiresAt: Date.now() + ((payload.expires_in ?? 14400) - 60) * 1000,
  };

  const config = await readConfig(base44);
  if (config) {
    await writeConfig(base44, config.id, { last_token_refresh: new Date().toISOString() });
  }

  return cachedToken.token;
}

/** Returns a valid access token, refreshing only when the cached one is stale. */
export async function getAccessToken(base44: any): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const config = await readConfig(base44);
  if (!config?.refresh_token) {
    throw new Error('Dropbox is not connected — no refresh token is stored.');
  }
  return refreshAccessToken(base44, config.refresh_token);
}

/** Drops the cached token and mints a brand new one. */
export async function forceRefresh(base44: any): Promise<string> {
  cachedToken = null;
  return getAccessToken(base44);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resilient Dropbox request wrapper.
 *  - injects a fresh bearer token
 *  - refreshes once and retries on 401
 *  - exponential backoff on 429 and 5xx (500ms * 2^attempt, capped at 8s)
 */
export async function dbxRequest(
  base44: any,
  url: string,
  options: RequestInit & { rawBody?: BodyInit } = {}
): Promise<Response> {
  let refreshedOnce = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const token = await getAccessToken(base44);
    const headers = new Headers(options.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && !refreshedOnce) {
      refreshedOnce = true;
      await forceRefresh(base44);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 0) * 1000;
      const backoff = Math.min(BACKOFF_CAP_MS, 500 * 2 ** attempt);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(Math.max(retryAfter, backoff));
        continue;
      }
    }

    return response;
  }

  throw new Error('Dropbox request failed after repeated retries.');
}

/** POST helper for the JSON RPC endpoints (api.dropboxapi.com). */
export async function dbxRpc(base44: any, endpoint: string, body: unknown): Promise<any> {
  const response = await dbxRequest(base44, `https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === null ? null : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dropbox ${endpoint} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** POST helper for the content endpoints (content.dropboxapi.com). */
export async function dbxContent(
  base44: any,
  endpoint: string,
  args: unknown,
  body: BodyInit | null = null
): Promise<Response> {
  return dbxRequest(base44, `https://content.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': JSON.stringify(args),
      ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
    },
    body,
  });
}

/** Lists every file under a folder, following the pagination cursor. */
export async function listAllFiles(base44: any, root: string): Promise<any[]> {
  const entries: any[] = [];
  let page = await dbxRpc(base44, 'files/list_folder', {
    path: root,
    recursive: true,
    include_deleted: false,
    include_media_info: false,
    limit: 2000,
  });

  entries.push(...(page.entries ?? []));

  while (page.has_more) {
    page = await dbxRpc(base44, 'files/list_folder/continue', { cursor: page.cursor });
    entries.push(...(page.entries ?? []));
  }

  return entries.filter((e) => e['.tag'] === 'file');
}

export const SUPPORTED_EXTENSIONS = ['pdf', 'pptx', 'html'] as const;

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

export function isSupported(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/** Filenames that carry no meaning and deserve an AI-derived title. */
const GENERIC_PATTERNS = [
  /^untitled/i,
  /^new[ _-]?presentation/i,
  /^presentation\s*\d*$/i,
  /^document\s*\d*$/i,
  /^deck\s*\d*$/i,
  /^slides?\s*\d*$/i,
  /^copy of /i,
  /^\d{4}[-_]?\d{2}[-_]?\d{2}$/,
  /^[0-9a-f-]{16,}$/i,
];

export function isGenericName(name: string): boolean {
  const base = name.replace(/\.[^.]+$/, '').trim();
  if (base.length < 3) return true;
  return GENERIC_PATTERNS.some((re) => re.test(base));
}

/** Requires the caller to be an authenticated admin. Throws otherwise. */
export async function requireAdmin(base44: any) {
  const user = await base44.auth.me();
  if (!user) {
    const err: any = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }
  if (user.role !== 'admin') {
    const err: any = new Error('Admin role required.');
    err.status = 403;
    throw err;
  }
  return user;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(err: any): Response {
  const status = err?.status ?? 500;
  return json({ error: err?.message ?? 'Unexpected error.' }, status);
}
