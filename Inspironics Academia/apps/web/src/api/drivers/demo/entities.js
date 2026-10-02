import { matchesQuery, ruleFor, ruleToQuery, sortRecords } from '@academy/shared';
import { currentUser, currentUserRow, db, persist, publicUser, replaceTable, table } from '@/api/drivers/demo/store';
import { badRequest, clone, forbidden, notFound, nowIso, sanitize, schemaFor, stamp } from '@/api/drivers/demo/records';

// Generic entity handlers with the same row-level security as the API (shared rules in @academy/shared).

const tick = () => new Promise((resolve) => { setTimeout(resolve, 15); });

function access(name, action, user) {
  return ruleToQuery(ruleFor(schemaFor(name), action), user);
}

const allowed = (record, rule) => rule === true || (rule !== false && matchesQuery(record, rule));

function page(records, sort, limit, skip) {
  const off = Math.max(Number(skip) || 0, 0);
  const lim = Math.min(Number(limit) || 5000, 10000);
  return sortRecords(records, sort).slice(off, off + lim).map(clone);
}

function query(name, q, sort, limit, skip) {
  if (q !== undefined && (q === null || typeof q !== 'object' || Array.isArray(q))) throw badRequest('q must be a JSON object');
  const rule = access(name, 'read', currentUser());
  if (rule === false) return [];
  const rows = table(name).filter((r) => matchesQuery(r, q || {}) && allowed(r, rule));
  return page(rows, sort, limit, skip);
}

function readable(name, id) {
  const record = table(name).find((r) => r.id === id);
  if (!record || !allowed(record, access(name, 'read', currentUser()))) throw notFound(`${name} not found`);
  return record;
}

function checkCreate(name, data) {
  const rule = access(name, 'create', currentUser());
  if (rule === false) throw forbidden(`Not allowed to create ${name}`);
  if (!allowed(sanitize(name, data), rule)) throw forbidden(`Not allowed to create this ${name}`);
}

function entityHandler(name) {
  return {
    async list(sort, limit, skip) { await tick(); return query(name, {}, sort, limit, skip); },
    async filter(q, sort, limit, skip) { await tick(); return query(name, q || {}, sort, limit, skip); },
    async get(id) { await tick(); return clone(readable(name, id)); },
    async create(data) {
      await tick();
      checkCreate(name, data);
      const rec = stamp(name, data, currentUser()?.id);
      table(name).push(rec);
      persist();
      return clone(rec);
    },
    async bulkCreate(items) {
      await tick();
      if (!Array.isArray(items)) throw badRequest('Body must be an array');
      items.forEach((item) => checkCreate(name, item));
      const recs = items.map((item) => stamp(name, item, currentUser()?.id));
      table(name).push(...recs);
      persist();
      return clone(recs);
    },
    async update(id, data) {
      await tick();
      const existing = readable(name, id);
      const rule = access(name, 'update', currentUser());
      if (!allowed(existing, rule)) throw forbidden(`Not allowed to update this ${name}`);
      const patch = sanitize(name, data, { partial: true });
      if (!allowed({ ...existing, ...patch }, rule)) throw forbidden('Update would move the record outside your access');
      Object.assign(existing, patch, { updated_date: nowIso() });
      persist();
      return clone(existing);
    },
    async delete(id) {
      await tick();
      const existing = readable(name, id);
      if (!allowed(existing, access(name, 'delete', currentUser()))) throw forbidden(`Not allowed to delete this ${name}`);
      replaceTable(name, table(name).filter((r) => r.id !== id));
      persist();
      return { success: true, deleted: 1 };
    },
    async deleteMany(q) {
      await tick();
      const rule = access(name, 'delete', currentUser());
      if (rule === false) throw forbidden();
      if (!q || typeof q !== 'object' || Object.keys(q).length === 0) throw badRequest('query is required');
      const doomed = new Set(table(name).filter((r) => matchesQuery(r, q) && allowed(r, rule)).map((r) => r.id));
      replaceTable(name, table(name).filter((r) => !doomed.has(r.id)));
      persist();
      return { success: true, deleted: doomed.size };
    },
  };
}

// Built-in User entity: admins manage everyone, others only see themselves.
function userHandler() {
  const requireAdmin = () => { if (currentUser()?.role !== 'admin') throw forbidden(); };
  const find = (id) => db().users.find((u) => u.id === id);
  const visible = () => {
    const me = currentUser();
    if (!me) return [];
    return me.role === 'admin' ? db().users.map(publicUser) : [me];
  };
  return {
    async list(sort = '-created_date', limit, skip) { await tick(); return page(visible(), sort, limit, skip); },
    async filter(q, sort = '-created_date', limit, skip) { await tick(); return page(visible().filter((u) => matchesQuery(u, q || {})), sort, limit, skip); },
    async get(id) {
      await tick();
      const u = visible().find((x) => x.id === id);
      if (!u) throw notFound('User not found');
      return u;
    },
    async create() { throw forbidden('Use invite to add users'); },
    async bulkCreate() { throw forbidden('Use invite to add users'); },
    async update(id, data = {}) {
      await tick();
      requireAdmin();
      const u = find(id);
      if (!u) throw notFound('User not found');
      if (data.role !== undefined) {
        if (!['admin', 'user'].includes(data.role)) throw badRequest('role must be admin or user');
        if (id === currentUserRow().id && data.role !== 'admin') throw badRequest('You cannot remove your own admin role');
        u.role = data.role;
      }
      if (typeof data.full_name === 'string') u.full_name = data.full_name.trim();
      if (data.disabled !== undefined) u.disabled = !!data.disabled;
      u.updated_date = nowIso();
      persist();
      return publicUser(u);
    },
    async delete(id) {
      await tick();
      requireAdmin();
      if (id === currentUserRow().id) throw badRequest('You cannot delete your own account');
      db().users = db().users.filter((u) => u.id !== id);
      persist();
      return { success: true };
    },
    async deleteMany() { throw forbidden(); },
  };
}

export function createEntities() {
  const cache = new Map();
  return new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string') return undefined;
      if (!cache.has(name)) cache.set(name, name === 'User' ? userHandler() : entityHandler(name));
      return cache.get(name);
    },
  });
}
