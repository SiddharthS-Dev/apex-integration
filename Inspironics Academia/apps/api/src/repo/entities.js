import crypto from 'node:crypto';
import { ENTITIES, isOperatorObject, matchesQuery, sortRecords } from '@academy/shared';
import { db } from '../db/index.js';
import { columnsFor, quote, tableName } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';

// Generic repository over the per-entity tables. No access control here — callers (routes) apply RLS;
// backend pipeline code uses this directly as the service role.

export const newId = () => crypto.randomBytes(12).toString('hex');
const nowIso = () => new Date().toISOString();

const colCache = new Map();
function cols(entity) {
  if (!ENTITIES[entity]) throw notFound(`Unknown entity ${entity}`);
  if (!colCache.has(entity)) colCache.set(entity, new Map(columnsFor(entity).map((c) => [c.name, c.kind])));
  return colCache.get(entity);
}

// ---- value (de)serialisation -------------------------------------------------------------

function toDb(kind, value) {
  if (value === undefined || value === null) return null;
  if (kind === 'json') return JSON.stringify(value);
  if (kind === 'boolean') return db().dialect === 'postgres' ? !!value : (value ? 1 : 0);
  if (kind === 'number') return Number(value);
  return String(value);
}

function fromDb(kind, value) {
  if (value === null || value === undefined) return undefined;
  if (kind === 'json') { try { return JSON.parse(value); } catch { return undefined; } }
  if (kind === 'boolean') return value === true || value === 1 || value === '1';
  if (kind === 'number') return Number(value);
  return value;
}

function rowToRecord(entity, row) {
  const c = cols(entity);
  const rec = {};
  for (const [name, kind] of c) {
    const v = fromDb(kind, row[name]);
    if (v !== undefined) rec[name] = v;
  }
  return rec;
}

// ---- validation ---------------------------------------------------------------------------

function coerce(prop, value, field) {
  if (value === null || value === undefined) return value;
  switch (prop.type) {
    case 'string': {
      if (typeof value !== 'string') value = String(value);
      break;
    }
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

// Keeps only declared properties, coerces types, checks enums. `partial` skips required/defaults.
export function sanitize(entity, data, { partial = false } = {}) {
  const schema = ENTITIES[entity];
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('Body must be an object');
  const out = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (data[name] !== undefined) out[name] = coerce(prop, data[name], name);
    else if (!partial && prop.default !== undefined) out[name] = structuredClone(prop.default);
  }
  if (!partial) {
    for (const req of schema.required || []) {
      if (out[req] === undefined || out[req] === null || out[req] === '') throw badRequest(`${req} is required`);
    }
  }
  return out;
}

// ---- query translation ----------------------------------------------------------------------

const SQL_OPS = { $ne: '<>', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

// Returns { sql, params } for the translatable part, and whether any clause needs a JS post-filter.
function translate(entity, query) {
  const c = cols(entity);
  const clauses = [];
  const params = [];
  let residual = false;

  for (const [key, cond] of Object.entries(query || {})) {
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(cond) || cond.length === 0) continue;
      const parts = cond.map((q) => translate(entity, q));
      if (parts.some((p) => p.residual)) { residual = true; continue; }
      const joiner = key === '$or' ? ' OR ' : ' AND ';
      clauses.push('(' + parts.map((p) => (p.sql ? `(${p.sql})` : '1=1')).join(joiner) + ')');
      for (const p of parts) params.push(...p.params);
      continue;
    }
    const kind = c.get(key);
    if (!kind || kind === 'json') { residual = true; continue; }
    const col = quote(key);
    if (isOperatorObject(cond)) {
      for (const [op, arg] of Object.entries(cond)) {
        if (op === '$in' || op === '$nin') {
          if (!Array.isArray(arg)) throw badRequest(`${op} expects an array`);
          if (arg.length === 0) { clauses.push(op === '$in' ? '1=0' : '1=1'); continue; }
          clauses.push(`${col} ${op === '$in' ? 'IN' : 'NOT IN'} (${arg.map(() => '?').join(', ')})`);
          params.push(...arg.map((v) => toDb(kind, v)));
        } else if (op === '$exists') {
          clauses.push(`${col} IS ${arg ? 'NOT ' : ''}NULL`);
        } else if (op === '$ne') {
          clauses.push(`(${col} IS NULL OR ${col} <> ?)`);
          params.push(toDb(kind, arg));
        } else if (SQL_OPS[op]) {
          clauses.push(`${col} ${SQL_OPS[op]} ?`);
          params.push(toDb(kind, arg));
        } else {
          residual = true;
        }
      }
    } else if (cond === null) {
      clauses.push(`${col} IS NULL`);
    } else {
      clauses.push(`${col} = ?`);
      params.push(toDb(kind, cond));
    }
  }
  return { sql: clauses.join(' AND '), params, residual };
}

function orderBy(entity, sort) {
  if (!sort) return '';
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!cols(entity).has(field)) return '';
  return ` ORDER BY ${quote(field)} ${desc ? 'DESC' : 'ASC'}`;
}

// ---- public API ------------------------------------------------------------------------------

export async function list(entity, { query = {}, sort, limit, skip = 0 } = {}) {
  const table = quote(tableName(entity));
  const { sql, params, residual } = translate(entity, query);
  const where = sql ? ` WHERE ${sql}` : '';
  const lim = Math.min(Number(limit) || 5000, 10000);
  const off = Math.max(Number(skip) || 0, 0);
  if (!residual) {
    const rows = await db().query(`SELECT * FROM ${table}${where}${orderBy(entity, sort)} LIMIT ? OFFSET ?`, [...params, lim, off]);
    return rows.map((r) => rowToRecord(entity, r));
  }
  // Part of the query isn't expressible in SQL (JSON columns, $contains): narrow in SQL, finish in JS.
  const rows = await db().query(`SELECT * FROM ${table}${where}`, params);
  const records = rows.map((r) => rowToRecord(entity, r)).filter((r) => matchesQuery(r, query));
  return sortRecords(records, sort).slice(off, off + lim);
}

export async function count(entity, query = {}) {
  const { sql, params, residual } = translate(entity, query);
  if (residual) return (await list(entity, { query, limit: 10000 })).length;
  const [row] = await db().query(`SELECT COUNT(*) AS n FROM ${quote(tableName(entity))}${sql ? ` WHERE ${sql}` : ''}`, params);
  return Number(row.n);
}

export async function get(entity, id) {
  const [row] = await db().query(`SELECT * FROM ${quote(tableName(entity))} WHERE id = ?`, [id]);
  return row ? rowToRecord(entity, row) : null;
}

export async function findOne(entity, query) {
  const [rec] = await list(entity, { query, limit: 1 });
  return rec || null;
}

async function insert(runner, entity, record) {
  const c = cols(entity);
  const names = [...c.keys()].filter((n) => record[n] !== undefined);
  await runner.run(
    `INSERT INTO ${quote(tableName(entity))} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    names.map((n) => toDb(c.get(n), record[n])),
  );
}

function stamp(entity, data, userId) {
  const ts = nowIso();
  return { ...sanitize(entity, data), id: newId(), created_date: ts, updated_date: ts, created_by_id: userId || undefined };
}

export async function create(entity, data, { userId } = {}) {
  const record = stamp(entity, data, userId);
  await insert(db(), entity, record);
  return record;
}

export async function bulkCreate(entity, items, { userId } = {}) {
  if (!Array.isArray(items)) throw badRequest('bulkCreate expects an array');
  const records = items.map((item) => stamp(entity, item, userId));
  await db().transaction(async (tx) => {
    for (const r of records) await insert(tx, entity, r);
  });
  return records;
}

export async function update(entity, id, data) {
  const existing = await get(entity, id);
  if (!existing) throw notFound(`${entity} ${id} not found`);
  const patch = sanitize(entity, data, { partial: true });
  const c = cols(entity);
  const names = Object.keys(patch);
  const updated = { ...existing, ...patch, updated_date: nowIso() };
  const sets = [...names, 'updated_date'];
  await db().run(
    `UPDATE ${quote(tableName(entity))} SET ${sets.map((n) => `${quote(n)} = ?`).join(', ')} WHERE id = ?`,
    [...sets.map((n) => toDb(c.get(n), updated[n])), id],
  );
  return updated;
}

export async function remove(entity, id) {
  const r = await db().run(`DELETE FROM ${quote(tableName(entity))} WHERE id = ?`, [id]);
  return { success: r.changes > 0, deleted: r.changes };
}

export async function removeMany(entity, query) {
  const { sql, params, residual } = translate(entity, query);
  if (!sql && !residual) throw badRequest('deleteMany requires a query');
  if (residual) {
    const recs = await list(entity, { query, limit: 10000 });
    for (const r of recs) await remove(entity, r.id);
    return { success: true, deleted: recs.length };
  }
  const r = await db().run(`DELETE FROM ${quote(tableName(entity))} WHERE ${sql}`, params);
  return { success: true, deleted: r.changes };
}

// Service-role facade mirroring the client SDK shape: entities.Lesson.filter(...) etc.
export const entities = new Proxy({}, {
  get(_t, name) {
    if (typeof name !== 'string') return undefined;
    return {
      list: (sort, limit, skip) => list(name, { sort, limit, skip }),
      filter: (query, sort, limit, skip) => list(name, { query, sort, limit, skip }),
      get: (id) => get(name, id),
      findOne: (query) => findOne(name, query),
      count: (query) => count(name, query),
      create: (data, opts) => create(name, data, opts),
      bulkCreate: (items, opts) => bulkCreate(name, items, opts),
      update: (id, data) => update(name, id, data),
      delete: (id) => remove(name, id),
      deleteMany: (query) => removeMany(name, query),
    };
  },
});
