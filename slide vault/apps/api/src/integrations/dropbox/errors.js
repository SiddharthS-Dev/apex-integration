/**
 * Dropbox error taxonomy.
 *
 * Two jobs:
 *  1. give the retry logic something to branch on that is not an HTTP status
 *     scattered through the code — `error.retryable` is the whole contract;
 *  2. keep raw Dropbox errors away from end users. A viewer should never be
 *     shown `expired_access_token`; they should be told the connection is
 *     being renewed, while the operator detail goes to the log (spec §10).
 */

export class DropboxError extends Error {
  /**
   * @param {string} message operator-facing detail
   * @param {object} [options]
   * @param {string} [options.userMessage] safe text for an end user
   * @param {number} [options.status] HTTP status to answer the caller with
   * @param {boolean} [options.retryable]
   * @param {string} [options.dropboxTag] Dropbox's own error tag, for logs
   * @param {Error} [options.cause]
   */
  constructor(message, { userMessage, status = 502, retryable = false, dropboxTag = '', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.userMessage = userMessage || 'The Dropbox request could not be completed.';
    this.status = status;
    this.retryable = retryable;
    this.dropboxTag = dropboxTag;
    this.isDropboxError = true;
  }

  /** The representation that is safe to put in an HTTP response body. */
  toPublic() {
    return { error: this.userMessage, code: this.name, retryable: this.retryable };
  }
}

/** The stored credential is gone, expired or rejected — re-authorization needed. */
export class DropboxAuthenticationError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 401,
      userMessage:
        'Dropbox authentication expired. The connection is being renewed automatically — if this ' +
        'persists, reconnect Dropbox in the admin settings.',
      ...options,
    });
  }
}

/** Authenticated, but the app is not permitted to do this. */
export class DropboxAuthorizationError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 403,
      userMessage: 'The Dropbox app is not authorized for this operation. Check the app permissions.',
      ...options,
    });
  }
}

export class DropboxRateLimitError extends DropboxError {
  /** @param {number} retryAfterMs from Dropbox's Retry-After header, when present */
  constructor(message, { retryAfterMs = 0, ...options } = {}) {
    super(message, {
      status: 429,
      retryable: true,
      userMessage: 'Dropbox is rate limiting this app. The operation will be retried shortly.',
      ...options,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class DropboxNotFoundError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 404,
      userMessage: 'That file or folder no longer exists in Dropbox.',
      ...options,
    });
  }
}

export class DropboxPermissionError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 403,
      userMessage: 'Dropbox denied access to that path.',
      ...options,
    });
  }
}

export class DropboxNetworkError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 503,
      retryable: true,
      userMessage: 'Dropbox could not be reached. The operation will be retried.',
      ...options,
    });
  }
}

export class DropboxTimeoutError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 504,
      retryable: true,
      userMessage: 'Dropbox took too long to respond. The operation will be retried.',
      ...options,
    });
  }
}

export class DropboxInvalidPathError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 400,
      userMessage: 'That Dropbox path is not valid.',
      ...options,
    });
  }
}

export class DropboxConflictError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 409,
      userMessage: 'A file with that name already exists in Dropbox.',
      ...options,
    });
  }
}

/**
 * The stored team-space root namespace is stale.
 *
 * Dropbox answers HTTP 422 and hands back the correct namespace, which is what
 * makes this recoverable rather than fatal: the executor stores the new value
 * and replays the request. Team reorganizations therefore heal themselves
 * instead of breaking every sync until someone reconnects.
 */
export class DropboxPathRootError extends DropboxError {
  constructor(message, { newRootNamespaceId = '', ...options } = {}) {
    super(message, {
      status: 409,
      userMessage:
        'The Dropbox team space has moved. The connection is updating itself automatically — if ' +
        'this persists, reconnect Dropbox in the admin settings.',
      ...options,
    });
    this.newRootNamespaceId = newRootNamespaceId;
  }
}

/** A Dropbox 5xx, or anything else the API returned that is not classified. */
export class DropboxApiError extends DropboxError {
  constructor(message, options = {}) {
    super(message, { status: 502, ...options });
  }
}

/** The app itself is misconfigured — no key, no secret, no connection. */
export class DropboxConfigurationError extends DropboxError {
  constructor(message, options = {}) {
    super(message, {
      status: 503,
      userMessage: 'Dropbox is not configured for this application yet.',
      ...options,
    });
  }
}

/** Dropbox error tags that mean "this specific path is gone". */
const NOT_FOUND_TAGS = ['not_found', 'path/not_found', 'path_lookup/not_found'];
const CONFLICT_TAGS = ['conflict', 'to/conflict', 'file_conflict'];
const RESTRICTED_TAGS = ['restricted_content', 'no_permission', 'insufficient_permissions'];

/** Pulls Dropbox's `.tag` out of an error body, however deeply it is nested. */
export function extractTag(body) {
  if (!body || typeof body !== 'object') return '';
  const error = body.error ?? body;
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 4) return '';
    const tag = typeof node['.tag'] === 'string' ? node['.tag'] : '';
    for (const [key, value] of Object.entries(node)) {
      if (key === '.tag') continue;
      const nested = walk(value, depth + 1);
      if (nested) return tag ? `${tag}/${nested}` : nested;
    }
    return tag;
  };
  return walk(error);
}

/**
 * Maps an HTTP response from Dropbox onto the taxonomy above.
 *
 * @param {number} status
 * @param {string} bodyText raw response body (may be empty)
 * @param {Headers} [headers]
 */
export function classifyResponse(status, bodyText, headers) {
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }
  const tag = extractTag(body);
  // Dropbox puts a human summary in error_summary; the raw body is truncated
  // so a giant HTML error page cannot flood the logs.
  const detail = body?.error_summary || body?.error_description || String(bodyText || '').slice(0, 300);
  const message = `Dropbox responded ${status}${detail ? `: ${detail}` : ''}`;

  if (status === 401) {
    /* Dropbox answers 401 for two quite different problems: a token that has
       expired, and an app that was never granted the scope. Treating the
       second as the first is a trap — the token refreshes fine, the retry
       fails identically, and the admin is told to reconnect an account that
       is already connected correctly. Name the missing permission instead. */
    if (tag.includes('missing_scope')) {
      const required = typeof body?.error?.required_scope === 'string' ? body.error.required_scope : '';
      const error = new DropboxAuthorizationError(
        `Dropbox refused the request: the app lacks the ${required || 'required'} scope. ${message}`,
        {
          dropboxTag: tag,
          userMessage: required
            ? `The Dropbox app is missing the "${required}" permission. Enable it in the Dropbox App ` +
              'Console, press Submit, then reconnect Dropbox so the new permission is granted.'
            : 'The Dropbox app is missing a required permission. Enable it in the Dropbox App Console ' +
              'and reconnect Dropbox.',
        }
      );
      error.requiredScope = required;
      // Surfaced in the HTTP response body, so the admin UI can say which one.
      error.details = { requiredScope: required };
      return error;
    }
    return new DropboxAuthenticationError(message, { dropboxTag: tag });
  }
  if (status === 403) {
    return RESTRICTED_TAGS.some((t) => tag.includes(t))
      ? new DropboxPermissionError(message, { dropboxTag: tag })
      : new DropboxAuthorizationError(message, { dropboxTag: tag });
  }
  if (status === 429) {
    const retryAfterHeader = Number(headers?.get?.('Retry-After') ?? 0);
    const retryAfterBody = Number(body?.error?.retry_after ?? 0);
    const seconds = retryAfterHeader || retryAfterBody || 0;
    return new DropboxRateLimitError(message, { retryAfterMs: seconds * 1000, dropboxTag: tag });
  }
  if (status === 409) {
    // 409 is Dropbox's catch-all for "endpoint-specific error", so the tag —
    // not the status — decides what actually happened.
    if (NOT_FOUND_TAGS.some((t) => tag.includes(t))) {
      return new DropboxNotFoundError(message, { dropboxTag: tag });
    }
    if (CONFLICT_TAGS.some((t) => tag.includes(t))) {
      return new DropboxConflictError(message, { dropboxTag: tag });
    }
    if (tag.includes('malformed_path') || tag.includes('invalid_path')) {
      return new DropboxInvalidPathError(message, { dropboxTag: tag });
    }
    if (RESTRICTED_TAGS.some((t) => tag.includes(t))) {
      return new DropboxPermissionError(message, { dropboxTag: tag });
    }
    return new DropboxApiError(message, { status: 409, dropboxTag: tag });
  }
  /* 422 — the Dropbox-API-Path-Root header named a namespace that is no longer
     the account's root. The response carries the correct one. */
  if (status === 422 && tag.includes('invalid_root')) {
    const rootInfo = body?.error?.invalid_root ?? {};
    return new DropboxPathRootError(`Dropbox rejected the path root: ${detail}`, {
      dropboxTag: tag,
      newRootNamespaceId: String(rootInfo.root_namespace_id ?? ''),
    });
  }

  if (status === 400) return new DropboxApiError(message, { status: 400, dropboxTag: tag });
  if (status >= 500) return new DropboxApiError(message, { retryable: true, dropboxTag: tag });

  return new DropboxApiError(message, { dropboxTag: tag });
}

/** Maps a thrown fetch/undici error onto the taxonomy. */
export function classifyNetworkError(error) {
  if (error?.isDropboxError) return error;

  const name = error?.name ?? '';
  const code = error?.code ?? error?.cause?.code ?? '';

  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new DropboxTimeoutError(`Dropbox request timed out: ${error?.message ?? code}`, { cause: error });
  }

  const networkCodes = [
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
  ];
  if (networkCodes.includes(code) || name === 'FetchError' || name === 'TypeError') {
    return new DropboxNetworkError(`Dropbox could not be reached: ${error?.message ?? code}`, { cause: error });
  }

  return new DropboxApiError(`Unexpected Dropbox failure: ${error?.message ?? 'unknown'}`, { cause: error });
}
