import { ENTITIES } from '@academy/shared';
import { ApiError } from '@/api/drivers/http';

// Record helpers mirroring the API repository: schema sanitising, defaults, required fields, stamps.

export const newId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
export const nowIso = () => new Date().toISOString();
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const badRequest = (msg) => new ApiError(400, msg);
export const unauthorized = (msg = 'Not signed in') => new ApiError(401, msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);

export function schemaFor(name) {
  const schema = ENTITIES[name];
  if (!schema) throw notFound(`Unknown entity ${name}`);
  return schema;
}

function coerce(prop, value, field) {
  if (value === null || value === undefined) return value;
  switch (prop.type) {
    case 'string': if (typeof value !== 'string') value = String(value); break;
    case 'number': case 'integer': {
      const n = Number(value);
      if (Number.isNaN(n)) throw badRequest(`${field} must be a number`);
      value = n;
      break;
    }
    case 'boolean': value = value === true || value === 'true' || value === 1; break;
    case 'array': if (!Array.isArray(value)) throw badRequest(`${field} must be an array`); break;
    case 'object': if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`); break;
    default: break;
  }
  if (prop.enum && !prop.enum.includes(value)) throw badRequest(`${field} must be one of: ${prop.enum.join(', ')}`);
  return value;
}

// Keeps declared properties only, coerces types, checks enums. `partial` skips required/defaults.
export function sanitize(name, data, { partial = false } = {}) {
  const schema = schemaFor(name);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('Body must be an object');
  const out = {};
  for (const [field, prop] of Object.entries(schema.properties)) {
    if (data[field] !== undefined) out[field] = coerce(prop, clone(data[field]), field);
    else if (!partial && prop.default !== undefined) out[field] = clone(prop.default);
  }
  if (!partial) {
    for (const req of schema.required || []) {
      if (out[req] === undefined || out[req] === null || out[req] === '') throw badRequest(`${req} is required`);
    }
  }
  return out;
}

export function stamp(name, data, userId, at = nowIso()) {
  return { ...sanitize(name, data), id: newId(), created_date: at, updated_date: at, created_by_id: userId || undefined };
}
