import express from 'express';
import { AUDIENCE_KEYS, ENTITIES, UNCLASSIFIED, matchesQuery, onCoursePublished, ruleFor, ruleToQuery } from '@academy/shared';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import * as repo from '../repo/entities.js';
import { deleteUser, findUserById, listUsers, publicUser, updateUser } from '../repo/users.js';
import { destroyUserSessions, requireUser } from '../auth/sessions.js';
import { log } from '../lib/logger.js';
import { notify } from '../notify/index.js';
import { store } from '../repo/store.js';
import { ignoreDropboxIds, removePlaybooks } from '../pipeline/deletePlaybooks.js';
import { classificationPatch, propagateCategory } from '../pipeline/classifyPlaybooks.js';
import { createScope } from './categoryScope.js';

// Generic entity REST API with row-level security enforced server-side from the shared RLS rules.
//   GET    /api/entities/:name?q=<json>&sort=&limit=&skip=
//   GET    /api/entities/:name/:id
//   POST   /api/entities/:name            (create)
//   POST   /api/entities/:name/bulk       (bulkCreate — array body)
//   PATCH  /api/entities/:name/:id
//   DELETE /api/entities/:name/:id
//   POST   /api/entities/:name/delete-many { query }

const router = express.Router();

// Every entity route needs a signed-in user: no public page reads entities, and rules like `{}`
// would otherwise expose lesson scripts and quiz answers to anonymous callers.
router.use(requireUser);

function schemaFor(name) {
  const schema = ENTITIES[name];
  if (!schema) throw notFound(`Unknown entity ${name}`);
  return schema;
}

// Returns true (unrestricted), false (denied) or a filter query the record must match.
function access(name, action, user) {
  return ruleToQuery(ruleFor(schemaFor(name), action), user);
}

function allowed(record, rule) {
  return rule === true || (rule !== false && matchesQuery(record, rule));
}

function parseQuery(raw) {
  if (!raw) return {};
  try {
    const q = JSON.parse(raw);
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error();
    return q;
  } catch {
    throw badRequest('q must be a JSON object');
  }
}

// ---- User (built-in): admins manage everyone; others see only themselves ----------------------

const userRouter = express.Router();

userRouter.get('/', asyncHandler(async (req, res) => {
  if (!req.user) return res.json([]);
  if (req.user.role !== 'admin') return res.json([req.user]);
  const q = parseQuery(req.query.q);
  res.json((await listUsers()).filter((u) => matchesQuery(u, q)));
}));

userRouter.get('/:id', asyncHandler(async (req, res) => {
  if (!req.user) throw notFound();
  if (req.user.role !== 'admin' && req.params.id !== req.user.id) throw notFound();
  const user = await findUserById(req.params.id);
  if (!user) throw notFound();
  res.json(publicUser(user));
}));

userRouter.patch('/:id', asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') throw forbidden();
  const patch = {};
  if (req.body?.role !== undefined) {
    if (!['admin', 'user'].includes(req.body.role)) throw badRequest('role must be admin or user');
    if (req.params.id === req.user.id && req.body.role !== 'admin') throw badRequest('You cannot remove your own admin role');
    patch.role = req.body.role;
  }
  if (typeof req.body?.full_name === 'string') patch.full_name = req.body.full_name.trim();
  if (req.body?.disabled !== undefined) patch.disabled = !!req.body.disabled;
  if (req.body?.audience !== undefined) {
    if (!AUDIENCE_KEYS.includes(req.body.audience)) throw badRequest(`audience must be one of: ${AUDIENCE_KEYS.join(', ')}`);
    patch.audience = req.body.audience;
  }
  const user = await updateUser(req.params.id, patch);
  if (!user) throw notFound();
  if (patch.disabled) await destroyUserSessions(user.id);
  res.json(publicUser(user));
}));

userRouter.delete('/:id', asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') throw forbidden();
  if (req.params.id === req.user.id) throw badRequest('You cannot delete your own account');
  await deleteUser(req.params.id);
  res.json({ success: true });
}));

router.use('/User', userRouter);

// ---- Generic entities ---------------------------------------------------------------------------

// Reads of playbook content are also limited to the categories the user's audience may see
// (categoryScope.js) — enforced here, not only hidden in the UI.
router.get('/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const rule = access(name, 'read', req.user);
  if (rule === false) return res.json([]);
  const scope = await createScope(req.user)(name);
  const query = parseQuery(req.query.q);
  const parts = [query, ...(rule === true ? [] : [rule]), ...(scope ? [scope] : [])];
  const combined = parts.length === 1 ? query : { $and: parts };
  res.json(await repo.list(name, { query: combined, sort: req.query.sort, limit: req.query.limit, skip: req.query.skip }));
}));

router.get('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const record = await repo.get(name, id);
  if (!record || !allowed(record, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  const scope = await createScope(req.user)(name);
  if (scope && !matchesQuery(record, scope)) throw notFound(`${name} not found`);
  res.json(record);
}));

// Results only the server may record: the final test is graded by submitFinalTest, which writes the
// final attempt and the progress fields below. A learner may write the rest of their own progress
// (lessons done, chapter tests), but not claim a final-test pass the admin dashboards would trust.
// field -> how its value compares (writing back the unchanged value, as a full-record save does, is fine)
const SERVER_OWNED = { CourseProgress: { final_score: (v) => Number(v) || 0, final_passed: (v) => !!v } };
function guardServerOwned(name, data, user, existing = null) {
  if (user?.role === 'admin' || !data || typeof data !== 'object') return;
  if (name === 'QuizAttempt' && (data.type === 'final' || existing?.type === 'final')) {
    throw forbidden('Final test attempts are recorded by the server when the test is submitted');
  }
  for (const [field, norm] of Object.entries(SERVER_OWNED[name] || {})) {
    if (field in data && norm(data[field]) !== norm(existing?.[field])) {
      throw forbidden(`${field} is recorded by the server when the final test is submitted`);
    }
  }
}

async function createOne(name, body, user) {
  const rule = access(name, 'create', user);
  if (rule === false) throw forbidden(`Not allowed to create ${name}`);
  const data = repo.sanitize(name, body);
  if (!allowed(data, rule)) throw forbidden(`Not allowed to create this ${name}`);
  guardServerOwned(name, data, user);
  return data;
}

router.post('/:name/bulk', asyncHandler(async (req, res) => {
  const { name } = req.params;
  if (!Array.isArray(req.body)) throw badRequest('Body must be an array');
  if (req.body.length > 1000) throw badRequest('At most 1000 records per bulk request');
  for (const item of req.body) await createOne(name, item, req.user);
  res.status(201).json(await repo.bulkCreate(name, req.body, { userId: req.user?.id }));
}));

router.post('/:name/delete-many', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const rule = access(name, 'delete', req.user);
  if (rule === false) throw forbidden();
  const query = req.body?.query;
  if (!query || typeof query !== 'object' || Object.keys(query).length === 0) throw badRequest('query is required');
  res.json(await repo.removeMany(name, rule === true ? query : { $and: [query, rule] }));
}));

router.post('/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const body = await beforeCreate(name, req.body);
  await createOne(name, body, req.user);
  const created = await repo.create(name, body, { userId: req.user?.id });
  res.status(201).json(created);
  afterCreate(name, created);
}));

router.patch('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const rule = access(name, 'update', req.user);
  const existing = await repo.get(name, id);
  if (!existing || !allowed(existing, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  if (!allowed(existing, rule)) throw forbidden(`Not allowed to update this ${name}`);
  const body = await beforeUpdate(name, existing, req.body, req.user);
  guardServerOwned(name, repo.sanitize(name, body, { partial: true }), req.user, existing);
  const merged = { ...existing, ...repo.sanitize(name, body, { partial: true }) };
  if (!allowed(merged, rule)) throw forbidden('Update would move the record outside your access');
  const updated = await repo.update(name, id, body);
  res.json(updated);
  afterUpdate(name, existing, updated);
}));

// ---- per-entity rules the declarative RLS can't express -------------------------------------------

const ACTION_ITEM_FIELDS = ['task', 'detail', 'owner_name', 'owner_user_id', 'due_date', 'priority'];
const today = () => new Date().toISOString().slice(0, 10);

// An action item added by hand is a person's work: reprocessing the meeting keeps it.
// A playbook uploaded by hand goes to the category the admin chose, or to Unclassified for review.
async function beforeCreate(name, body) {
  if (!body || typeof body !== 'object') return body;
  if (name === 'ActionItem') return { ...body, edited: true };
  if (name === 'Playbook') {
    const patch = await classificationPatch(body);
    return { ...body, ...patch, category: patch.category || UNCLASSIFIED, category_source: patch.category ? 'manual' : 'upload' };
  }
  if (name === 'PlaybookCategory') {
    const key = String(body.key || body.label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!key || key === UNCLASSIFIED) throw badRequest('Give the category a name');
    if (await repo.findOne('PlaybookCategory', { key })) throw badRequest(`A category with the key "${key}" already exists`);
    const audiences = (Array.isArray(body.audiences) ? body.audiences : []).filter((a) => AUDIENCE_KEYS.includes(a));
    return { ...body, key, audiences, built_in: false };
  }
  return body;
}

// An action item's owner may only move its status; completion is dated here. An admin's edit of the
// item itself marks it edited, so reprocessing the meeting keeps it.
async function beforeUpdate(name, existing, body, user) {
  if (!body || typeof body !== 'object') return body;
  // An admin's category choice is recorded as manual, so the Dropbox sync never overrides it.
  if (name === 'Playbook') {
    const patch = await classificationPatch(body);
    const out = { ...body, ...patch };
    if (patch.category !== undefined && patch.category !== existing.category) out.category_source = 'manual';
    else delete out.category_source;
    return out;
  }
  // A category's key is what playbooks store; it and the standard flag never change.
  if (name === 'PlaybookCategory') {
    const out = { ...body };
    delete out.key;
    delete out.built_in;
    if (out.audiences !== undefined) out.audiences = (Array.isArray(out.audiences) ? out.audiences : []).filter((a) => AUDIENCE_KEYS.includes(a));
    return out;
  }
  if (name !== 'ActionItem') return body;
  const out = { ...body };
  if (user?.role !== 'admin') {
    const extra = Object.keys(out).filter((k) => k !== 'status');
    if (extra.length) throw forbidden('You can only change the status of your action items');
  } else if (ACTION_ITEM_FIELDS.some((k) => k in out && out[k] !== existing[k])) {
    out.edited = true;
  }
  if (out.status && out.status !== existing.status) out.completed_date = out.status === 'done' ? today() : '';
  return out;
}

const runHook = (label, promise) => promise.catch((err) => log.error(label, { error: err.message }));

function afterCreate(name, created) {
  if (name === 'ActionItem' && created.published && created.owner_user_id) runHook('action_item.assign_failed', notifyAssigned(created));
}

// Side effects of an update, run after the response: publishing a course opens recertifications
// waiting on it and tells learners about it; reassigning a published action item tells the new
// owner. Failures are logged, never surfaced to the editor.
function afterUpdate(name, before, after) {
  // A playbook's courses follow its category (who may see them).
  if (name === 'Playbook' && after.category !== before.category) {
    runHook('playbook.category_propagate_failed', propagateCategory(after.id, after.category));
  }
  if (name === 'Course' && before.status !== 'published' && after.status === 'published') {
    onCoursePublished(store, after, { notify })
      .then((r) => log.info('course.published', { course_id: after.id, ...r }))
      .catch((err) => log.error('course.published_hook_failed', { course_id: after.id, error: err.message }));
  }
  if (name === 'ActionItem' && after.published && after.owner_user_id && after.owner_user_id !== before.owner_user_id) {
    runHook('action_item.assign_failed', notifyAssigned(after));
  }
}

const notifyAssigned = (a) => notify(a.owner_user_id, 'action_item_assigned', {
  meeting_id: a.meeting_id, meeting_title: a.meeting_title, task: a.task, due_date: a.due_date,
}, `action_item_assigned:${a.id}:${a.owner_user_id}`);

router.delete('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const existing = await repo.get(name, id);
  if (!existing || !allowed(existing, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  if (!allowed(existing, access(name, 'delete', req.user))) throw forbidden(`Not allowed to delete this ${name}`);
  // The three standard categories can be edited but not deleted; deleting a custom one sends its
  // playbooks (and their courses) to Unclassified for review — nothing is lost.
  if (name === 'PlaybookCategory') {
    if (existing.built_in) throw forbidden('The standard categories can be edited but not deleted');
    const moved = await repo.list('Playbook', { query: { category: existing.key }, limit: 100_000 });
    for (const p of moved) {
      await repo.update('Playbook', p.id, { category: UNCLASSIFIED, category_source: 'manual' });
      await propagateCategory(p.id, UNCLASSIFIED);
    }
    await repo.remove(name, id);
    return res.json({ success: true, deleted: 1, moved_to_unclassified: moved.length });
  }
  // A playbook takes its chapters and courses with it (see deletePlaybooks).
  if (name === 'Playbook') {
    await removePlaybooks([id]);
    return res.json({ success: true, deleted: 1 });
  }
  const result = await repo.remove(name, id);
  // A meeting's transcript and action items go with it, and a Dropbox transcript is not synced back.
  if (name === 'Meeting') {
    await repo.removeMany('MeetingTranscript', { meeting_id: id });
    await repo.removeMany('ActionItem', { meeting_id: id });
    if (existing.source === 'dropbox' && existing.external_id) await ignoreDropboxIds([existing.external_id]);
  }
  res.json(result);
}));

export default router;
