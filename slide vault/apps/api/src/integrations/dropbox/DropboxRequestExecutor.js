/**
 * The single choke point for every Dropbox HTTP call.
 *
 *   request
 *     -> get a valid access token
 *     -> execute
 *        success            -> return
 *        401                -> refresh once, retry once
 *        429                -> honour Retry-After, else backoff, retry
 *        5xx / network      -> backoff, retry
 *        anything else      -> classified error, no retry
 *
 * Retries are bounded and jittered; nothing here loops forever. Because every
 * call passes through one function, metrics and timeouts are uniform and no
 * service above this layer ever constructs an Authorization header.
 */
import { backoffDelay, sleep, withTimeout } from '../../util/async.js';
import { M } from '../../services/metrics/metrics.js';
import {
  DropboxAuthenticationError,
  DropboxPathRootError,
  DropboxRateLimitError,
  classifyNetworkError,
  classifyResponse,
} from './errors.js';

export class DropboxRequestExecutor {
  /**
   * @param {object} deps
   * @param {import('./DropboxAuthService.js').DropboxAuthService} deps.auth
   */
  constructor({ config, auth, metrics, logger, fetchImpl = fetch, sleepImpl = sleep, random = Math.random }) {
    this.config = config;
    this.auth = auth;
    this.metrics = metrics;
    this.logger = logger?.child?.({ component: 'DropboxRequestExecutor' }) ?? logger;
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.random = random;
  }

  /**
   * Executes one Dropbox request with the full policy applied.
   *
   * @param {string} url
   * @param {RequestInit & {operation?: string, timeoutMs?: number}} options
   * @returns {Promise<Response>} a successful response; failures throw
   */
  async execute(url, { operation = 'unknown', timeoutMs, pathRooted = false, ...options } = {}) {
    const maxAttempts = this.config.dropbox.maxRetries;
    const started = process.hrtime.bigint();
    let refreshedOnce = false;
    let pathRootRepairedOnce = false;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        const token = await this.auth.getValidAccessToken();
        const headers = new Headers(options.headers ?? {});
        headers.set('Authorization', `Bearer ${token}`);

        /* Dropbox Business: operate in the account's root namespace rather
           than the member's home folder, so a library in the team space is
           reachable without anyone mounting it. Only on namespace-aware
           endpoints — users/* and auth/* take no path and are left alone. */
        if (pathRooted) {
          const pathRoot = this.auth.getPathRootHeader?.();
          if (pathRoot) headers.set('Dropbox-API-Path-Root', pathRoot);
        }

        this.metrics?.increment(M.apiRequests, { operation });
        response = await this.#send(url, { ...options, headers }, timeoutMs);
      } catch (transportError) {
        lastError = classifyNetworkError(transportError);
        this.metrics?.increment(M.apiErrors, { operation, kind: lastError.name });

        if (!lastError.retryable || attempt === maxAttempts - 1) break;
        await this.#waitBeforeRetry(attempt, 0, operation, lastError.name);
        continue;
      }

      if (response.ok) {
        this.metrics?.observe(M.apiLatency, Number(process.hrtime.bigint() - started) / 1e9, { operation });
        return response;
      }

      // The body is read here because a Response can only be consumed once and
      // the classifier needs it; successful responses are handed back unread.
      const bodyText = await response.text().catch(() => '');
      const error = classifyResponse(response.status, bodyText, response.headers);
      lastError = error;
      this.metrics?.increment(M.apiErrors, { operation, kind: error.name, status: response.status });

      /* 401 — the access token died early (revoked, or a clock skew).
         Refresh once and replay the request. A second 401 after a fresh token
         means the authorization itself is gone, so it is not retried again. */
      if (error instanceof DropboxAuthenticationError && !refreshedOnce) {
        refreshedOnce = true;
        this.logger?.debug?.('Refreshing after 401 and retrying', { operation });
        this.auth.invalidateAccessToken();
        try {
          await this.auth.getValidAccessToken({ force: true });
        } catch (refreshError) {
          throw refreshError;
        }
        this.metrics?.increment(M.apiRetries, { operation, reason: 'unauthorized' });
        continue;
      }

      /* 422 invalid_root — the team space moved. Dropbox told us the correct
         namespace, so store it and replay. Repaired once per request: a second
         rejection means something is wrong beyond a stale id. */
      if (error instanceof DropboxPathRootError && !pathRootRepairedOnce) {
        pathRootRepairedOnce = true;
        const repaired = await this.auth.updateRootNamespace?.(error.newRootNamespaceId);
        if (repaired) {
          this.metrics?.increment(M.apiRetries, { operation, reason: 'path_root_changed' });
          this.logger?.warn?.('Dropbox path root was stale; retrying with the new namespace', {
            operation,
          });
          continue;
        }
      }

      if (error instanceof DropboxRateLimitError) {
        if (attempt === maxAttempts - 1) break;
        await this.#waitBeforeRetry(attempt, error.retryAfterMs, operation, 'rate_limit');
        continue;
      }

      if (error.retryable) {
        if (attempt === maxAttempts - 1) break;
        await this.#waitBeforeRetry(attempt, 0, operation, 'server_error');
        continue;
      }

      throw error;
    }

    this.metrics?.observe(M.apiLatency, Number(process.hrtime.bigint() - started) / 1e9, {
      operation,
      outcome: 'error',
    });
    throw lastError ?? new Error(`Dropbox ${operation} failed after ${maxAttempts} attempts.`);
  }

  /** JSON-RPC endpoints (api.dropboxapi.com). Returns the parsed body. */
  async rpc(endpoint, body, { operation = endpoint, timeoutMs } = {}) {
    const response = await this.execute(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      operation,
      timeoutMs,
      pathRooted: isNamespaceAware(endpoint),
      // A null body is how Dropbox spells "no arguments"; sending "null" with
      // a JSON content type is rejected by several endpoints.
      headers: body === null || body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === null || body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw classifyResponse(response.status, text, response.headers);
    }
  }

  /**
   * Content endpoints (content.dropboxapi.com). Returns the raw Response so the
   * caller can stream it — large files must never be buffered here.
   */
  async content(endpoint, args, { body = null, operation = endpoint, timeoutMs } = {}) {
    return this.execute(`https://content.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      operation,
      timeoutMs: timeoutMs ?? this.config.dropbox.downloadTimeoutMs,
      pathRooted: isNamespaceAware(endpoint),
      headers: {
        // Dropbox requires the arguments as an HTTP header, and the header must
        // be ASCII — non-Latin filenames would otherwise break the request.
        'Dropbox-API-Arg': escapeApiArg(args),
        ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body,
    });
  }

  async #send(url, options, timeoutMs) {
    const controller = new AbortController();
    return withTimeout(
      this.fetch(url, { ...options, signal: controller.signal }),
      timeoutMs ?? this.config.dropbox.requestTimeoutMs,
      { message: 'The Dropbox request timed out.', onTimeout: () => controller.abort() }
    );
  }

  async #waitBeforeRetry(attempt, retryAfterMs, operation, reason) {
    const backoff = backoffDelay(attempt, {
      base: this.config.dropbox.backoffBaseMs,
      cap: this.config.dropbox.backoffCapMs,
      random: this.random,
    });
    // Dropbox's own Retry-After wins when it asks for longer than our backoff.
    const delay = Math.max(retryAfterMs || 0, backoff);
    this.metrics?.increment(M.apiRetries, { operation, reason });
    this.logger?.debug?.('Retrying Dropbox request', { operation, reason, attempt, delayMs: delay });
    await this.sleep(delay);
  }
}

/**
 * Which endpoints take a path, and therefore a path root.
 *
 * `users/get_current_account` and `auth/token/revoke` address the account, not
 * a file, so a namespace header on them is meaningless at best.
 */
export function isNamespaceAware(endpoint) {
  return /^(files|sharing|file_requests|file_properties)\//.test(String(endpoint ?? ''));
}

/**
 * Dropbox-API-Arg must be ASCII-only JSON; Dropbox decodes \uXXXX escapes.
 * Without this, a deck called "Übersicht.pptx" makes fetch throw on an
 * invalid header value.
 */
export function escapeApiArg(args) {
  return JSON.stringify(args ?? {}).replace(/[\u007f-￿]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}
