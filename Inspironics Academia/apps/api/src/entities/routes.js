import express from 'express';
import { ENTITIES, matchesQuery, ruleFor, ruleToQuery } from '@academy/shared';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import * as repo from '../repo/entities.js';
import { deleteUser, findUserById, listUsers, publicUser, updateUser } from '../repo/users.js';
import { destroyUserSessions, requireUser } from '../auth/sessions.js';

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

router.get('/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const rule = access(name, 'read', req.user);
  if (rule === false) return res.json([]);
  const query = parseQuery(req.query.q);
  const combined = rule === true ? query : { $and: [query, rule] };
  res.json(await repo.list(name, { query: combined, sort: req.query.sort, limit: req.query.limit, skip: req.query.skip }));
}));

router.get('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const record = await repo.get(name, id);
  if (!record || !allowed(record, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  res.json(record);
}));

async function createOne(name, body, user) {
  const rule = access(name, 'create', user);
  if (rule === false) throw forbidden(`Not allowed to create ${name}`);
  const data = repo.sanitize(name, body);
  if (!allowed(data, rule)) throw forbidden(`Not allowed to create this ${name}`);
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
  await createOne(name, req.body, req.user);
  res.status(201).json(await repo.create(name, req.body, { userId: req.user?.id }));
}));

router.patch('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const rule = access(name, 'update', req.user);
  const existing = await repo.get(name, id);
  if (!existing || !allowed(existing, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  if (!allowed(existing, rule)) throw forbidden(`Not allowed to update this ${name}`);
  const merged = { ...existing, ...repo.sanitize(name, req.body, { partial: true }) };
  if (!allowed(merged, rule)) throw forbidden('Update would move the record outside your access');
  res.json(await repo.update(name, id, req.body));
}));

router.delete('/:name/:id', asyncHandler(async (req, res) => {
  const { name, id } = req.params;
  const existing = await repo.get(name, id);
  if (!existing || !allowed(existing, access(name, 'read', req.user))) throw notFound(`${name} not found`);
  if (!allowed(existing, access(name, 'delete', req.user))) throw forbidden(`Not allowed to delete this ${name}`);
  res.json(await repo.remove(name, id));
}));

export default router;
