/**
 * Error handling for the HTTP layer.
 *
 * One rule: the client gets the user-facing message and a stable code; the
 * operator gets the detail, in the log. A raw Dropbox error string, a stack
 * trace or a SQL message never reaches a response body.
 */
import { redactText } from '../util/redact.js';

/** Wraps an async route so a rejected promise reaches the error middleware. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/** An error the caller caused, safe to describe back to them. */
export class HttpError extends Error {
  constructor(status, message, { code = '', details = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, options) => new HttpError(400, message, options);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message, options) => new HttpError(409, message, options);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}.` });
}

/**
 * The terminal error middleware.
 *
 * Express recognises it by its four parameters, so `next` must stay in the
 * signature even though it is unused.
 */
export function errorHandler({ logger, isProduction }) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    const status = Number(error?.status) || 500;

    // Dropbox errors carry their own vetted user message.
    const message = error?.isDropboxError
      ? error.userMessage
      : error?.expose || status < 500
        ? error.message
        : 'Something went wrong on the server.';

    const payload = { error: redactText(String(message)) };
    if (error?.code) payload.code = error.code;
    if (error?.name === 'DropboxError' || error?.isDropboxError) payload.code = error.name;
    if (error?.details) payload.details = error.details;
    if (error?.retryable) payload.retryable = true;

    const log = status >= 500 ? logger.error : logger.warn;
    log.call(logger, 'Request failed', {
      method: req.method,
      path: req.path,
      status,
      error: error?.message,
      code: error?.code ?? error?.name,
      ...(isProduction ? {} : { stack: error?.stack }),
    });

    if (res.headersSent) {
      // The body has already started — the only honest thing left is to cut
      // the response off rather than append JSON to a half-sent file.
      res.destroy();
      return;
    }
    res.status(status).json(payload);
  };
}
