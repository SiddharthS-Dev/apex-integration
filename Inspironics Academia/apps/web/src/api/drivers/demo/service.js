import { matchesQuery, sortRecords } from '@academy/shared';
import { persist, replaceTable, table } from '@/api/drivers/demo/store';
import { notFound, nowIso, sanitize, stamp } from '@/api/drivers/demo/records';

// Service-role data access for the demo pipeline (no RLS — like the API's backend functions).

export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export const findAll = (name, q = {}, sort) => sortRecords(table(name).filter((r) => matchesQuery(r, q)), sort);
export const findOne = (name, q) => table(name).find((r) => matchesQuery(r, q)) || null;

export function mustGet(name, id) {
  const rec = table(name).find((r) => r.id === id);
  if (!rec) throw notFound(`${name} not found`);
  return rec;
}

export function insert(name, data, userId) {
  const rec = stamp(name, data, userId);
  table(name).push(rec);
  return rec;
}

export function patch(name, id, data) {
  const rec = mustGet(name, id);
  Object.assign(rec, sanitize(name, data, { partial: true }), { updated_date: nowIso() });
  return rec;
}

export function removeWhere(name, q) {
  const before = table(name).length;
  replaceTable(name, table(name).filter((r) => !matchesQuery(r, q)));
  return before - table(name).length;
}

export { persist };
