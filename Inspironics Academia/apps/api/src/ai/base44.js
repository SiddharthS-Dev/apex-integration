import { config } from '../config.js';
import { HttpError, unavailable } from '../lib/errors.js';
import { log } from '../lib/logger.js';

// Base44 AI provider: calls the Base44 app's built-in Core.InvokeLLM integration — anonymously for an
// app that is public without login, or as a signed-in Base44 user when BASE44_EMAIL/BASE44_PASSWORD are
// set (external backends can't use Base44's service role). Same endpoints the official
// @base44/sdk uses: POST /api/apps/{appId}/auth/login and
// POST /api/apps/{appId}/integration-endpoints/Core/InvokeLLM.

const TIMEOUT_MS = 10 * 60_000;
let token = null;
let loggingIn = null;

const url = (path) => `${config.base44.serverUrl}/api/apps/${encodeURIComponent(config.base44.appId)}${path}`;

async function post(path, body, auth) {
  let res;
  try {
    res = await fetch(url(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': config.base44.appId,
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach Base44 (${err.name === 'TimeoutError' ? 'timed out' : err.message})`);
  }
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain-text body */ }
  return { status: res.status, data };
}

const detail = (data) => (typeof data === 'object' && data ? data.message || data.detail || data.error : data) || '';

async function login() {
  const { status, data } = await post('/auth/login', { email: config.base44.email, password: config.base44.password });
  if (status >= 400 || !data?.access_token) {
    log.warn('ai.base44.login_failed', { status });
    throw unavailable(`Base44 sign-in failed (${status}${detail(data) ? `: ${String(detail(data)).slice(0, 200)}` : ''}) — check BASE44_APP_ID, BASE44_EMAIL and BASE44_PASSWORD`);
  }
  return data.access_token;
}

const hasLogin = () => !!(config.base44.email && config.base44.password);

async function getToken(force = false) {
  if (!hasLogin()) return null;
  if (token && !force) return token;
  // One sign-in at a time; concurrent generations share it.
  loggingIn ||= login().finally(() => { loggingIn = null; });
  token = await loggingIn;
  return token;
}

// Calls one of the Base44 app's built-in Core integrations (InvokeLLM, GenerateVideo, GenerateSpeech…),
// signing in when credentials are configured and retrying once on an expired session.
export async function base44Integration(endpoint, body) {
  const path = `/integration-endpoints/Core/${endpoint}`;
  let res = await post(path, body, await getToken());
  if ((res.status === 401 || res.status === 403) && !hasLogin()) {
    throw unavailable(`This Base44 app requires sign-in for ${endpoint} — set BASE44_EMAIL and BASE44_PASSWORD on the API server`);
  }
  if (res.status === 401 || res.status === 403) res = await post(path, body, await getToken(true));
  if (res.status === 429) throw new HttpError(429, `Base44 ${endpoint} rate limit or credit limit reached — retry shortly`);
  if (res.status >= 400) {
    throw new HttpError(502, `Base44 ${endpoint} error (${res.status})${detail(res.data) ? `: ${String(detail(res.data)).slice(0, 300)}` : ''}`);
  }
  return res.data;
}

export async function invokeBase44({ system, prompt, schema }) {
  const out = await base44Integration('InvokeLLM', {
    prompt: system ? `${system}\n\n${prompt}` : prompt,
    ...(schema ? { response_json_schema: schema } : {}),
    ...(config.base44.model ? { model: config.base44.model } : {}),
  });
  if (!schema) return typeof out === 'string' ? out : JSON.stringify(out);
  if (out && typeof out === 'object') return out;
  try {
    return JSON.parse(out);
  } catch {
    throw new HttpError(502, 'Base44 AI returned malformed JSON');
  }
}
