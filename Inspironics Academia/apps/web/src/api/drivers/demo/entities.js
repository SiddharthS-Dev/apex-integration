import {
  AUDIENCE_KEYS, UNCLASSIFIED, allowedCategories, matchesQuery, onCoursePublished, resolveToday, ruleFor, ruleToQuery, sortRecords,
} from '@academy/shared';
import { currentUser, currentUserRow, db, persist, publicUser, replaceTable, table } from '@/api/drivers/demo/store';
import { notify, store } from '@/api/drivers/demo/backend';
import { badRequest, clone, forbidden, notFound, nowIso, sanitize, schemaFor, stamp } from '@/api/drivers/demo/records';

// Generic entity handlers with the same row-level security as the API (shared rules in @academy/shared).

const tick = () => new Promise((resolve) => { setTimeout(resolve, 15); });

function access(name, action, user) {
  return ruleToQuery(ruleFor(schemaFor(name), action), user);
}

const allowed = (record, rule) => rule === true || (rule !== false && matchesQuery(record, rule));

// Audience scope, as the API enforces it: a learner sees playbooks and courses only in categories their
// audience is allowed, and a course's modules, lessons, questions, flashcards and assessments with it.
const SCOPED = new Set(['Playbook', 'Course', 'Module', 'Lesson', 'Question', 'Flashcard', 'Assessment']);
const catOf = (r) => (r?.category && String(r.category).trim()) || UNCLASSIFIED;

function scopeFor(user) {
  const cats = allowedCategories(user, table('PlaybookCategory'));
  if (cats === null) return () => true;
  const ok = new Set(cats);
  const courses = new Set(table('Course').filter((c) => ok.has(catOf(c))).map((c) => c.id));
  const modules = new Set(table('Module').filter((m) => courses.has(m.course_id)).map((m) => m.id));
  const lessons = new Set(table('Lesson').filter((l) => modules.has(l.module_id)).map((l) => l.id));
  const assessments = new Set(table('Assessment').filter((a) => courses.has(a.course_id)).map((a) => a.id));
  return (name, r) => {
    switch (name) {
      case 'Playbook': return ok.has(catOf(r));
      case 'Course': return courses.has(r.id);
      case 'Module': return courses.has(r.course_id);
      case 'Lesson': return modules.has(r.module_id);
      case 'Assessment': return courses.has(r.course_id);
      case 'Flashcard': return lessons.has(r.lesson_id);
      case 'Question': return lessons.has(r.lesson_id) || assessments.has(r.assessment_id);
      default: return true;
    }
  };
}
const inScope = (name, record, user) => !SCOPED.has(name) || scopeFor(user)(name, record);

// A playbook's category travels to its courses (they are filtered by it).
function propagateCategory(playbookId, category) {
  for (const c of table('Course')) if (c.playbook_id === playbookId) c.category = category;
}

function page(records, sort, limit, skip) {
  const off = Math.max(Number(skip) || 0, 0);
  const lim = Math.min(Number(limit) || 5000, 10000);
  return sortRecords(records, sort).slice(off, off + lim).map(clone);
}

function query(name, q, sort, limit, skip) {
  if (q !== undefined && (q === null || typeof q !== 'object' || Array.isArray(q))) throw badRequest('q must be a JSON object');
  const user = currentUser();
  const rule = access(name, 'read', user);
  if (rule === false) return [];
  const scope = SCOPED.has(name) ? scopeFor(user) : null;
  const rows = table(name).filter((r) => matchesQuery(r, q || {}) && allowed(r, rule) && (!scope || scope(name, r)));
  return page(rows, sort, limit, skip);
}

function readable(name, id) {
  const record = table(name).find((r) => r.id === id);
  const user = currentUser();
  if (!record || !allowed(record, access(name, 'read', user)) || !inScope(name, record, user)) throw notFound(`${name} not found`);
  return record;
}

function checkCreate(name, data) {
  const rule = access(name, 'create', currentUser());
  if (rule === false) throw forbidden(`Not allowed to create ${name}`);
  if (!allowed(sanitize(name, data), rule)) throw forbidden(`Not allowed to create this ${name}`);
}

// Action items: an owner who isn't an admin may change only the status of their own item. Any change
// stamps completed_date when it is done; an admin's change marks the item edited (kept on reprocess).
// Returns the newly assigned owner's id, if the owner changed.
const OWNER_FIELDS = new Set(['status']);
function actionItemPatch(existing, patch, user) {
  const admin = user?.role === 'admin';
  if (!admin && Object.keys(patch).some((k) => !OWNER_FIELDS.has(k))) throw forbidden('You can only change the status of your own action items');
  if (patch.status && patch.status !== existing.status) {
    patch.completed_date = patch.status === 'done' ? resolveToday() : '';
  }
  if (admin) patch.edited = true;
  return admin && patch.owner_user_id && patch.owner_user_id !== existing.owner_user_id ? patch.owner_user_id : null;
}

function entityHandler(name) {
  return {
    async list(sort, limit, skip) { await tick(); return query(name, {}, sort, limit, skip); },
    async filter(q, sort, limit, skip) { await tick(); return query(name, q || {}, sort, limit, skip); },
    async get(id) { await tick(); return clone(readable(name, id)); },
    async create(data) {
      await tick();
      checkCreate(name, data);
      // A playbook added by hand: the category chosen at upload, or Unclassified for review.
      // Same as the API: a chosen category is an admin's (manual); none means Unclassified, from upload.
      if (name === 'Playbook') data = { ...data, category: data?.category || UNCLASSIFIED, category_source: data?.category ? 'manual' : 'upload' };
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
      const assignedTo = name === 'ActionItem' ? actionItemPatch(existing, patch, currentUser()) : null;
      // An admin's category change is a manual assignment (sync never overrides it) and moves the courses too.
      const recategorised = name === 'Playbook' && patch.category !== undefined && patch.category !== existing.category;
      if (recategorised) patch.category_source = 'manual';
      const wasPublished = existing.status === 'published';
      Object.assign(existing, patch, { updated_date: nowIso() });
      if (recategorised) propagateCategory(existing.id, existing.category);
      persist();
      // Same hook as the API: publishing a course starts pending recertifications and announces it.
      if (name === 'Course' && !wasPublished && existing.status === 'published') {
        await onCoursePublished(store, clone(existing), { today: resolveToday(), notify });
        persist();
      }
      // Same as the API: a newly assigned owner of a published item hears about it.
      if (assignedTo && existing.published) {
        notify(assignedTo, 'action_item_assigned', {
          task: existing.task, meeting_title: existing.meeting_title, meeting_id: existing.meeting_id, due_date: existing.due_date,
        }, `action_item_assigned:${existing.id}:${assignedTo}`);
      }
      return clone(existing);
    },
    async delete(id) {
      await tick();
      const existing = readable(name, id);
      if (!allowed(existing, access(name, 'delete', currentUser()))) throw forbidden(`Not allowed to delete this ${name}`);
      // Same as the API: the standard categories stay; a custom one's playbooks go back to review.
      if (name === 'PlaybookCategory') {
        if (existing.built_in) throw forbidden('The standard categories can be edited but not deleted');
        for (const p of table('Playbook')) {
          if (p.category === existing.key) { p.category = UNCLASSIFIED; p.category_source = 'manual'; propagateCategory(p.id, UNCLASSIFIED); }
        }
      }
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
      if (data.audience !== undefined) {
        if (!AUDIENCE_KEYS.includes(data.audience)) throw badRequest('audience must be intern, employee or leadership');
        u.audience = data.audience;
      }
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
