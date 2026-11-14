import express from 'express';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { createSession, requireUser } from '../auth/sessions.js';
import { findUsablePasswordLink, markPasswordLinkUsed } from '../auth/passwordLinks.js';
import { findUserById, publicUser, recordLogin, updateUser } from '../repo/users.js';
import { insertAuditEvent, listAuditEvents } from './audit.js';
import { coreConfig } from './config.js';
import { activeAssignments, activeMemberships, can, hasAdminPower, isDisabled, loadActor } from './identity.js';
import { addMember, createOrganization, endMembership, listMembers, listOrganizations } from './organizations.js';
import { grantRole, revokeRole, transitionRole } from './roles.js';
import { confirmLink, confirmedLinkMap, linksForUser, listLinks, proposeLink, rejectLink } from './links.js';
import { externalIdentityProviders, linkGoogleIdentity, userForGoogleSubject, verifyGoogleCredential } from './google.js';
import { verifyServiceRequest } from './service.js';

// /api/core — APEX Core identity endpoints (contract §3). Default deny: everything except the Google
// sign-in routes and the gateway's resolve call needs a signed-in user, and each handler then checks
// the actor's active role assignments (never users.role, never membership or staff alone).

const router = express.Router();
const googleLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many sign-in attempts. Try again in a few minutes.' });
const ctx = (req) => ({ ip: req.ip || null });
const roleView = (r) => ({ role: r.role, scope_type: r.scope_type, scope_id: r.scope_id });

function googleClientIdOr404() {
  const id = coreConfig().googleClientId;
  if (!id) throw notFound(); // disabled: indistinguishable from an absent route
  return id;
}

// ---- Anonymous: Google sign-in by (provider, subject) only ---------------------------------------

router.post('/auth/google', googleLimiter, asyncHandler(async (req, res) => {
  const clientId = googleClientIdOr404();
  const { sub } = await verifyGoogleCredential(req.body?.credential, clientId);
  const user = await userForGoogleSubject(db(), sub);
  if (!user || isDisabled(user)) {
    await recordLogin({ userId: null, email: null, success: false, reason: 'google_unknown', ip: req.ip, userAgent: req.get('user-agent') });
    throw unauthorized('Google sign-in failed');
  }
  await updateUser(user.id, { last_login_at: new Date().toISOString() });
  await createSession(res, user, req);
  await recordLogin({ userId: user.id, email: user.email, success: true, reason: 'google', ip: req.ip, userAgent: req.get('user-agent') });
  await insertAuditEvent(db(), { actorUserId: user.id, action: 'auth.google_sign_in', targetType: 'user', targetId: user.id, ip: req.ip });
  res.json({ user: publicUser(user) });
}));

// Accept an invitation (set-password link) with a verified Google credential instead of a password.
// Only when Google is enabled, only for accounts that have never signed in, and the link is consumed.
router.post('/auth/google/accept-invite', googleLimiter, asyncHandler(async (req, res) => {
  const clientId = googleClientIdOr404();
  const { sub } = await verifyGoogleCredential(req.body?.credential, clientId);
  const link = await findUsablePasswordLink(db(), req.body?.token);
  const invalid = () => badRequest('This invite link is invalid or has expired');
  if (!link) throw invalid();
  const user = await findUserById(link.user_id);
  if (!user || isDisabled(user) || user.last_login_at) throw invalid();
  await db().transaction(async (tx) => {
    if (!(await markPasswordLinkUsed(tx, link.token_hash))) throw invalid();
    await linkGoogleIdentity(tx, user.id, sub, { actorUserId: user.id, ip: req.ip, via: 'invite' });
  });
  await updateUser(user.id, { last_login_at: new Date().toISOString() });
  await createSession(res, user, req);
  await recordLogin({ userId: user.id, email: user.email, success: true, reason: 'google_invite', ip: req.ip, userAgent: req.get('user-agent') });
  res.json({ user: publicUser(user) });
}));

// ---- Gateway service call ----------------------------------------------------------------------

router.post('/identity/resolve', asyncHandler(async (req, res) => {
  const check = verifyServiceRequest(req);
  if (!check.ok) {
    log.warn('core.service_assertion_rejected', { reason: check.reason, peer: req.socket?.remoteAddress });
    throw unauthorized('Service authentication required');
  }
  const sub = typeof req.body?.sub === 'string' ? req.body.sub : '';
  if (!sub) throw badRequest('sub is required');
  const user = await findUserById(sub);
  if (!user || isDisabled(user)) return res.json({ active: false });
  const roles = (await activeAssignments(db(), user.id)).map(roleView);
  res.json({
    active: true,
    user: { id: user.id, email: user.email, full_name: user.full_name || '' },
    roles,
    links: await confirmedLinkMap(db(), user.id),
    // Apex sessions issued before this instant must be revoked (password change/reset, disable).
    sessions_valid_after: (await db().query('SELECT valid_after FROM user_session_epochs WHERE user_id = ?', [user.id]))[0]?.valid_after || null,
  });
}));

// ---- Signed-in -----------------------------------------------------------------------------------

router.use(requireUser, asyncHandler(async (req, _res, next) => {
  req.actor = await loadActor(db(), req.user.id);
  if (!req.actor) throw unauthorized();
  next();
}));

router.get('/me', asyncHandler(async (req, res) => {
  const me = req.actor;
  res.json({
    user: req.user,
    roles: me.roles.map((r) => ({ id: r.id, ...roleView(r), valid_from: r.valid_from })),
    memberships: await activeMemberships(db(), me.id),
    links: (await linksForUser(db(), me.id, { confirmedOnly: true })).map((l) => ({ id: l.id, app: l.app, app_user_id: l.app_user_id, evidence: l.evidence, reviewed_at: l.reviewed_at })),
  });
}));

router.post('/external-identities/google', asyncHandler(async (req, res) => {
  const clientId = googleClientIdOr404();
  const { sub } = await verifyGoogleCredential(req.body?.credential, clientId);
  const out = await db().transaction((tx) => linkGoogleIdentity(tx, req.actor.id, sub, { ip: req.ip }));
  res.status(out.created ? 201 : 200).json({ id: out.id, provider: 'google', created: out.created });
}));

router.get('/users', asyncHandler(async (req, res) => {
  if (!can(req.actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 200);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = q
    ? await db().query("SELECT * FROM users WHERE lower(email) LIKE ? ESCAPE '\\' OR lower(full_name) LIKE ? ESCAPE '\\' ORDER BY email LIMIT 50", [like, like])
    : await db().query('SELECT * FROM users ORDER BY email LIMIT 50');
  res.json(rows.map(publicUser));
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const actor = req.actor;
  if (!hasAdminPower(actor)) throw forbidden('Not allowed');
  const user = await findUserById(req.params.id);
  if (!user) throw notFound('User not found');
  const memberships = await activeMemberships(db(), user.id);
  const roles = await activeAssignments(db(), user.id);
  if (can(actor, 'platform.admin')) {
    const history = await db().query('SELECT * FROM role_assignments WHERE user_id = ? ORDER BY valid_from', [user.id]);
    return res.json({
      user: publicUser(user),
      roles: roles.map((r) => ({ id: r.id, ...roleView(r), valid_from: r.valid_from })),
      role_history: history,
      memberships,
      links: await linksForUser(db(), user.id),
      external_identities: (await externalIdentityProviders(db(), user.id)).map((e) => ({ provider: e.provider, verified_at: e.verified_at })),
    });
  }
  // org_admin: only a member of an organisation they administer, and only that organisation's data.
  const shared = new Set(memberships.map((m) => m.organization_id).filter((id) => actor.orgAdminOf.has(id)));
  if (!shared.size) throw notFound('User not found');
  const u = publicUser(user);
  res.json({
    user: { id: u.id, email: u.email, full_name: u.full_name, disabled: u.disabled },
    roles: roles.filter((r) => r.scope_type === 'organization' && shared.has(r.scope_id)).map((r) => ({ id: r.id, ...roleView(r), valid_from: r.valid_from })),
    memberships: memberships.filter((m) => shared.has(m.organization_id)),
  });
}));

router.get('/organizations', asyncHandler(async (req, res) => res.json(await listOrganizations(db(), req.actor))));
router.post('/organizations', asyncHandler(async (req, res) => res.status(201).json(await createOrganization(db(), req.actor, req.body, ctx(req)))));
router.get('/organizations/:id/members', asyncHandler(async (req, res) => res.json(await listMembers(db(), req.actor, req.params.id))));
router.post('/organizations/:id/members', asyncHandler(async (req, res) => res.status(201).json(await addMember(db(), req.actor, req.params.id, req.body, ctx(req)))));
router.post('/memberships/:id/end', asyncHandler(async (req, res) => res.json(await endMembership(db(), req.actor, req.params.id, req.body, ctx(req)))));

router.post('/role-assignments', asyncHandler(async (req, res) => res.status(201).json(await grantRole(db(), req.actor, req.body, ctx(req)))));
router.post('/role-assignments/:id/revoke', asyncHandler(async (req, res) => res.json(await revokeRole(db(), req.actor, req.params.id, req.body, ctx(req)))));
router.post('/role-assignments/:id/transition', asyncHandler(async (req, res) => res.json(await transitionRole(db(), req.actor, req.params.id, req.body, ctx(req)))));

router.get('/identity-links', asyncHandler(async (req, res) => res.json(await listLinks(db(), req.actor, { status: req.query.status ? String(req.query.status) : undefined }))));
router.post('/identity-links', asyncHandler(async (req, res) => res.status(201).json(await proposeLink(db(), req.actor, req.body, ctx(req)))));
router.post('/identity-links/:id/confirm', asyncHandler(async (req, res) => res.json(await confirmLink(db(), req.actor, req.params.id, req.body, ctx(req)))));
router.post('/identity-links/:id/reject', asyncHandler(async (req, res) => res.json(await rejectLink(db(), req.actor, req.params.id, req.body, ctx(req)))));

router.get('/audit-events', asyncHandler(async (req, res) => {
  if (!can(req.actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  res.json(await listAuditEvents(db(), {
    action: req.query.action ? String(req.query.action) : undefined,
    targetId: req.query.target_id ? String(req.query.target_id) : undefined,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
}));


export default router;
