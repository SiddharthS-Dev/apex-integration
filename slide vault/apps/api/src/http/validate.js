/**
 * Input validation.
 *
 * Nothing from a request body, a query string or an OAuth callback is trusted
 * (spec §66). These helpers are small on purpose: a validator nobody can read
 * is a validator nobody checks.
 */
import { badRequest } from './errors.js';

export function requireString(value, field, { maxLength = 500, minLength = 1, pattern = null } = {}) {
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < minLength) throw badRequest(`"${field}" is required.`);
  if (trimmed.length > maxLength) throw badRequest(`"${field}" is too long.`);
  if (pattern && !pattern.test(trimmed)) throw badRequest(`"${field}" is not in the expected format.`);
  return trimmed;
}

export function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, { ...options, minLength: 0 });
}

export function requireBoolean(value, field, fallback) {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw badRequest(`"${field}" is required.`);
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw badRequest(`"${field}" must be true or false.`);
}

export function requireInt(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`"${field}" is required.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw badRequest(`"${field}" must be a number.`);
  if (parsed < min || parsed > max) throw badRequest(`"${field}" must be between ${min} and ${max}.`);
  return parsed;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireEmail(value, field = 'email') {
  const email = requireString(value, field, { maxLength: 320 }).toLowerCase();
  if (!EMAIL.test(email)) throw badRequest('That email address is not valid.');
  return email;
}

/** Ids are opaque to clients; only the shape we issue is accepted. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(value, field = 'id') {
  return requireString(value, field, { maxLength: 64, pattern: ID });
}

/** UUIDs specifically — the ids this server generates for its own records. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value, field = 'id') {
  return requireString(value, field, { maxLength: 36, pattern: UUID });
}

export function requireOneOf(value, field, allowed, fallback) {
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`"${field}" is required.`);
  }
  if (!allowed.includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}
