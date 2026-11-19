import crypto from 'node:crypto';
import { APEX_PLATFORMS, ONBOARDING_LIMITS, ONBOARDING_ROLE_CODES, cleanText, fieldApplies, onboardingRole, validatePlatforms } from '@academy/shared';
import { setUserPlatforms } from '../platforms.js';
import { randomToken, sha256 } from '../../auth/passwords.js';
import { sendAccountEmail } from '../../notify/index.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { createUser } from '../../repo/users.js';
import { insertAuditEvent, listAuditEvents } from '../audit.js';
import { can, nowIso, validateRoleScope } from '../identity.js';
import { insertAssignment, isUniqueViolation } from '../roles.js';
import { onboardingConfig } from './config.js';
import { joinLink, sendOnboardingEmail } from './emails.js';

const INVITE_TTL_MS = 7 * 24 * 3600_000; // the existing invitation link lifetime (auth/routes.js)
import { tokenHash } from './service.js';
import { documentsFor, readDocument } from './documents.js';

// Administrator review of access requests (prompt §9; plan §4; Phase 3: six roles, invitation link). Permissions: can(actor,
// 'registration.review' | 'registration.decide') — platform administrators in v1 — plus, for every role
// granted at approval, the same can(actor, 'role.grant', …) the role API uses (delegable authority).
// Approval can only grant the roles the onboarding role allows (shared catalogue: learner for everyone;
// intern only for Intern, alumni only for Alumni, each after verification) at platform scope; anything
// else — every administrator role, any executive access — is refused here whatever the approver holds.
// Approval creates the account with an unusable credential and sends the existing invitation email,
// whose set-password link is how the person chooses a password (none is collected during onboarding).

const REVIEWABLE = ['PENDING_APPROVAL', 'INFO_REQUESTED'];
const SECRET_COLUMNS = ['code_digest', 'credential_hash', 'resume_token_hash', 'resume_token_expires_at', 'respond_token_hash', 'respond_token_expires_at'];

const parse = (text, fallback) => {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};
const refuse = (status, code, error, extra = {}) => new HttpError(status, error, { code, ...extra });

function requireReview(actor) {
  if (!can(actor, 'registration.review')) throw forbidden('Reviewing access requests requires platform administrator access');
}
function requireDecide(actor) {
  if (!can(actor, 'registration.decide')) throw forbidden('Deciding access requests requires platform administrator access');
}

const roleOf = (r) => parse(r.category_profile, {}).onboarding_role || null;

const summaryRow = (r) => ({
  id: r.id,
  onboarding_role: roleOf(r),
  role_label: onboardingRole(roleOf(r))?.label || null,
  full_name: r.full_name,
  email: r.email,
  email_verified_at: r.email_verified_at,
  claimed_organization: r.claimed_organization,
  primary_category_code: r.primary_category_code,
  status: r.status,
  submitted_at: r.submitted_at,
  created_at: r.created_at,
  advice_source: r.ai_recommendation_source,
  decided_at: r.decided_at,
});

/** GET /registrations?status=&category=&from=&to=&q= — reviewable requests by default. */
export async function listRegistrations(db, actor, query = {}) {
  requireReview(actor);
  const where = [];
  const params = [];
  const status = String(query.status || 'reviewable');
  if (status === 'reviewable') where.push("status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')");
  else if (status !== 'all') { where.push('status = ?'); params.push(status); }
  else where.push("status NOT IN ('CODE_SENT', 'EMAIL_VERIFIED')"); // unverified drafts are not reviewable material
  if (query.role) {
    if (!ONBOARDING_ROLE_CODES.includes(query.role)) throw badRequest('Unknown role');
    // The role lives in the stored profile JSON, written by the server as {"schema_version":2,"onboarding_role":"…",…}.
    where.push('category_profile LIKE ?'); params.push(`%"onboarding_role":"${query.role}"%`);
  }
  if (query.from) { where.push('submitted_at >= ?'); params.push(String(query.from).slice(0, 30)); }
  if (query.to) { where.push('submitted_at <= ?'); params.push(String(query.to).slice(0, 30)); }
  const q = String(query.q || '').trim().toLowerCase().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(lower(COALESCE(claimed_organization, '')) LIKE ? ESCAPE '\\' OR lower(full_name) LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const rows = await db.query(
    `SELECT * FROM registration_requests WHERE ${where.join(' AND ')} ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 200`,
    params,
  );
  return rows.map(summaryRow);
}

/** Roles this actor could grant for this onboarding role (the UI offers only these; the API checks again). */
export function grantableRoles(actor, roleCode) {
  const grants = onboardingRole(roleCode)?.grants || [];
  return grants.filter((role) => can(actor, 'role.grant', { role, scopeType: 'platform', scopeId: '', targetUserId: null }));
}

/** GET /registrations/:id — everything a reviewer needs, never a secret or token. */
export async function registrationDetail(db, actor, id) {
  requireReview(actor);
  const [r] = await db.query('SELECT * FROM registration_requests WHERE id = ?', [String(id)]);
  if (!r) throw notFound('Access request not found');
  const out = { ...r };
  for (const c of SECRET_COLUMNS) delete out[c];
  const profile = parse(r.category_profile, {});
  const role = onboardingRole(profile.onboarding_role);
  return {
    ...summaryRow(r),
    verification: { email: r.email, email_verified: !!r.email_verified_at, email_verified_at: r.email_verified_at, affiliation_verified: false },
    requested: {
      onboarding_role: role?.code || null,
      role_label: role?.label || null,
      category_code: r.primary_category_code,
      category_label: role?.label || r.primary_category_code,
      claimed_organization: r.claimed_organization,
      interest_codes: parse(r.interest_codes, []),
      interest_other: r.interest_other,
      // The APEX platforms the applicant asked to use (the approver confirms them at approval).
      platforms: parse(r.preferences, {}).platforms || [],
    },
    platform_catalogue: APEX_PLATFORMS,
    profile,
    profile_fields: (role?.fields || []).filter((f) => fieldApplies(f, profile)).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
    verification_note: role?.verify || null,
    // Optional supporting documents (metadata; the file itself is fetched with registrationDocument).
    documents: await documentsFor(db, r.id),
    preferences: parse(r.preferences, {}),
    consent: { version: r.consent_version, accepted_at: r.consent_accepted_at, adult_confirmed_at: r.adult_confirmed_at },
    advice: { source: r.ai_recommendation_source, model: r.ai_model, schema_version: r.ai_schema_version, ...parse(r.ai_recommendation, {}) },
    clarification: { question: r.info_request, asked_at: r.info_requested_at, answer: r.info_response, answered_at: r.info_responded_at },
    decision: {
      decided_by: r.decided_by, decided_at: r.decided_at, reason: r.decision_reason, message: r.decision_message,
      approved_user_id: r.approved_user_id, approved_category_code: r.approved_category_code, approved_roles: parse(r.approved_roles, null),
    },
    internal_note: r.internal_note,
    grantable_roles: grantableRoles(actor, role?.code),
    default_roles: ['learner'],
    history: (await listAuditEvents(db, { targetId: r.id, limit: 50 })).map((e) => ({ at: e.at, action: e.action, actor_user_id: e.actor_user_id, detail: e.detail })),
  };
}

/**
 * GET /registrations/:id/documents/:kind — one attached document, decrypted, for a reviewer. Every opening
 * is audited (who, which request, which kind; never the content or file name).
 */
export async function registrationDocument(db, actor, id, kind, { ip = null } = {}) {
  requireReview(actor);
  const [r] = await db.query('SELECT id FROM registration_requests WHERE id = ?', [String(id)]);
  if (!r) throw notFound('Access request not found');
  let doc;
  try {
    doc = await readDocument(db, r.id, String(kind));
  } catch {
    throw refuse(500, 'DOCUMENT_UNREADABLE', 'This file could not be opened. Ask the applicant to send it again.');
  }
  if (!doc) throw notFound('No such document on this request');
  await insertAuditEvent(db, { actorUserId: actor.id, action: 'registration.document_viewed', targetType: 'registration_request', targetId: r.id, detail: { kind: doc.kind }, ip });
  return doc;
}

function note(value, label = 'Internal note') {
  const t = cleanText(value, { label, max: 2000, multiline: true });
  if (t.error) throw badRequest(t.error);
  return t.value;
}

/** Validates the approver's explicit choices. Returns { role, category, roles }. */
function approvalChoices(actor, body) {
  if (body?.confirm !== true) throw badRequest('Confirm the approval (confirm: true) after checking the role and every access choice');
  const approvedRole = onboardingRole(body?.onboarding_role);
  if (!approvedRole) throw badRequest(`onboarding_role must be one of: ${ONBOARDING_ROLE_CODES.join(', ')}`);
  const category = approvedRole.category;
  if (body.organization_id != null && body.organization_id !== '') {
    throw badRequest('Organisation access is not granted at approval in this release. Add it afterwards in People & access.');
  }
  if (Array.isArray(body.resource_ids) && body.resource_ids.length) throw badRequest('Resource access is not granted at approval in this release.');
  if (!Array.isArray(body.roles) || body.roles.length > 5) throw badRequest('roles must be a list of at most 5 role choices (it may be empty)');
  const roles = [];
  for (const choice of body.roles) {
    const role = String(choice?.role || '');
    const scopeType = String(choice?.scope_type || 'platform');
    const scopeId = choice?.scope_id == null ? '' : String(choice.scope_id);
    if (!approvedRole.grants.includes(role)) {
      throw forbidden(`${role || 'That role'} cannot be granted when approving a ${approvedRole.label} request.`);
    }
    if (scopeType !== 'platform') throw badRequest('Only platform-scope roles can be granted at approval in this release');
    const problem = validateRoleScope(role, scopeType, scopeId);
    if (problem) throw badRequest(problem);
    if (!can(actor, 'role.grant', { role, scopeType, scopeId, targetUserId: null })) throw forbidden(`You cannot grant ${role}`);
    if (!roles.some((r) => r.role === role)) roles.push({ role, scope_type: scopeType, scope_id: '' });
  }
  // Platforms shown on the person's APEX home. Omitted = what the applicant asked for.
  let platforms = null;
  if (body.platforms !== undefined) {
    const p = validatePlatforms(body.platforms);
    if (p.error) throw badRequest(p.error);
    if (!p.value.length) throw badRequest('Choose at least one APEX platform for this person');
    platforms = p.value;
  }
  return { role: approvedRole.code, category, roles, platforms };
}

/**
 * POST /registrations/:id/approve { onboarding_role, roles: [{ role, scope_type }], confirm: true, note? }
 * One transaction: claim the request (conditional UPDATE, so a concurrent or repeated approval gets 0
 * rows), refuse an address that already has an account (never a merge), create the user through the
 * users repository with the request's credential hash, open the chosen assignments, clear every secret,
 * audit. The approval email is queued after commit.
 */
export async function approveRegistration(db, actor, id, body, { ip = null } = {}) {
  requireDecide(actor);
  const { role: approvedRole, category, roles, platforms: chosenPlatforms } = approvalChoices(actor, body);
  const internalNote = note(body?.note);
  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [r] = await tx.query('SELECT * FROM registration_requests WHERE id = ?', [String(id)]);
      if (!r) throw notFound('Access request not found');
      if (!REVIEWABLE.includes(r.status)) {
        throw refuse(409, 'ALREADY_DECIDED', `This request is ${r.status.toLowerCase().replace('_', ' ')}`, { status: r.status, approved_user_id: r.approved_user_id });
      }
      const [existing] = await tx.query('SELECT id FROM users WHERE email = ?', [r.email]);
      if (existing) throw refuse(409, 'ACCOUNT_EXISTS', 'An account with this email address already exists. Accounts are never merged; reject this request or contact the person.');
      const credential = r.credential_hash;
      const at = nowIso();
      const claimed = await tx.run(
        `UPDATE registration_requests SET status = 'APPROVED', code_digest = NULL, code_expires_at = NULL, credential_hash = NULL, resume_token_hash = NULL,
           resume_token_expires_at = NULL, respond_token_hash = NULL, respond_token_expires_at = NULL, decided_by = ?, decided_at = ?, closed_at = ?,
           approved_category_code = ?, internal_note = COALESCE(?, internal_note), retention_due_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')`,
        [actor.id, at, at, category, internalNote, null, at, r.id],
      );
      if (!claimed.changes) throw refuse(409, 'ALREADY_DECIDED', 'This request was decided at the same time by someone else');
      const user = await createUser({ email: r.email, fullName: r.full_name, role: 'user', passwordHash: credential, audience: 'external' }, tx);
      // Did the applicant choose their password at /start (recorded in the start audit event)? Then the
      // account works with it now; otherwise the existing invitation: a one-time set-password link, 7 days.
      const [started] = await tx.query("SELECT detail FROM audit_events WHERE action = 'registration.started' AND target_id = ? ORDER BY at DESC LIMIT 1", [r.id]);
      const startDetail = started ? (typeof started.detail === 'string' ? parse(started.detail, {}) : started.detail || {}) : {};
      const passwordChosen = startDetail.password_chosen === true;
      let inviteToken = null;
      if (!passwordChosen) {
        inviteToken = randomToken();
        await tx.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
          [sha256(inviteToken), user.id, new Date(Date.now() + INVITE_TTL_MS).toISOString()]);
      }
      const granted = [];
      for (const choice of roles) {
        const a = await insertAssignment(tx, {
          userId: user.id, role: choice.role, scopeType: 'platform', scopeId: '', grantedBy: actor.id, grantedVia: 'api', reason: `access request ${r.id} approved`, at,
        });
        granted.push({ id: a.id, ...choice });
        await insertAuditEvent(tx, {
          actorUserId: actor.id, action: 'role.granted', targetType: 'role_assignment', targetId: a.id,
          detail: { user_id: user.id, role: choice.role, scope_type: 'platform', scope_id: '', via: 'onboarding', registration_id: r.id }, ip,
        });
      }
      await tx.run('UPDATE registration_requests SET approved_user_id = ?, approved_roles = ? WHERE id = ?', [user.id, JSON.stringify(roles), r.id]);
      // APEX home platforms: the approver's choice, else what the applicant asked for (none = show all).
      const requestedPlatforms = validatePlatforms(parse(r.preferences, {}).platforms || []).value || [];
      const platforms = chosenPlatforms || requestedPlatforms;
      if (platforms.length) await setUserPlatforms(tx, user.id, platforms, at);
      const requestedRole = roleOf(r);
      if (approvedRole !== requestedRole) {
        await insertAuditEvent(tx, {
          actorUserId: actor.id, action: 'registration.role_corrected', targetType: 'registration_request', targetId: r.id,
          detail: { from: requestedRole, to: approvedRole }, ip,
        });
      }
      await insertAuditEvent(tx, {
        actorUserId: actor.id, action: 'registration.approved', targetType: 'registration_request', targetId: r.id,
        detail: { user_id: user.id, requested_role: requestedRole, approved_role: approvedRole, approved_category: category, roles: roles.map((x) => x.role), organization_id: null, resource_ids: [], invitation: !passwordChosen, password_chosen: passwordChosen, requested_platforms: requestedPlatforms, platforms }, ip,
      });
      await insertAuditEvent(tx, {
        actorUserId: actor.id, action: 'user.provisioned', targetType: 'user', targetId: user.id,
        detail: { via: 'onboarding', registration_id: r.id, created: roles.map((x) => x.role) }, ip,
      });
      return { email: r.email, name: r.full_name, userId: user.id, granted, inviteToken, platforms, passwordChosen };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw refuse(409, 'ACCOUNT_EXISTS', 'An account with this email address already exists. Accounts are never merged.');
    throw err;
  }
  // After commit: "approved, sign in with your password" when the applicant chose one; otherwise the
  // existing invitation email (set your password), exactly as an admin invite sends it.
  let emailSent;
  if (result.passwordChosen) {
    emailSent = await sendOnboardingEmail('onboarding_approved', result.email, { name: result.name }, { dedupeKey: `onb-approved:${id}` });
  } else {
    emailSent = await sendAccountEmail('invite', result.email, { name: result.name, invitedBy: actor.user?.full_name || actor.user?.email, link: `/reset-password?token=${result.inviteToken}` },
      { userId: result.userId }).catch(() => false);
  }
  return {
    id: String(id), status: 'APPROVED', user_id: result.userId, onboarding_role: approvedRole, approved_category_code: category, roles: result.granted, platforms: result.platforms,
    password_chosen: result.passwordChosen, invitation_sent: !result.passwordChosen && !!emailSent, approval_email_sent: !!emailSent,
  };
}

/** POST /registrations/:id/reject { reason, message?, note? } */
export async function rejectRegistration(db, actor, id, body, { ip = null } = {}) {
  requireDecide(actor);
  const reason = cleanText(body?.reason, { label: 'Reason', max: ONBOARDING_LIMITS.reason, multiline: true, required: true });
  if (reason.error) throw badRequest(reason.error);
  if (reason.value.length < 5) throw badRequest('Give a meaningful reason (at least 5 characters)');
  const message = note(body?.message, 'Message to the applicant');
  const internalNote = note(body?.note);
  const cfg = onboardingConfig();
  const email = await db.transaction(async (tx) => {
    const [r] = await tx.query('SELECT id, email, status FROM registration_requests WHERE id = ?', [String(id)]);
    if (!r) throw notFound('Access request not found');
    const at = nowIso();
    const done = await tx.run(
      `UPDATE registration_requests SET status = 'REJECTED', code_digest = NULL, code_expires_at = NULL, credential_hash = NULL, resume_token_hash = NULL,
         resume_token_expires_at = NULL, respond_token_hash = NULL, respond_token_expires_at = NULL, decided_by = ?, decided_at = ?, closed_at = ?,
         decision_reason = ?, decision_message = ?, internal_note = COALESCE(?, internal_note), retention_due_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')`,
      [actor.id, at, at, reason.value, message, internalNote, cfg.retentionDays ? new Date(Date.now() + cfg.retentionDays * 86_400_000).toISOString() : null, at, r.id],
    );
    if (!done.changes) throw refuse(409, 'ALREADY_DECIDED', `This request is ${r.status.toLowerCase().replace('_', ' ')}`, { status: r.status });
    await insertAuditEvent(tx, {
      actorUserId: actor.id, action: 'registration.rejected', targetType: 'registration_request', targetId: r.id,
      detail: { reason_length: reason.value.length, message_sent: !!message }, ip,
    });
    return r.email;
  });
  await sendOnboardingEmail('onboarding_rejected', email, { message }, { dedupeKey: `onb-rejected:${id}` });
  return { id: String(id), status: 'REJECTED' };
}

/** POST /registrations/:id/request-info { question, note? } — the question is shown to the applicant. */
export async function requestInfo(db, actor, id, body, { ip = null } = {}) {
  requireDecide(actor);
  const q = cleanText(body?.question, { label: 'Question', max: ONBOARDING_LIMITS.infoQuestion, multiline: true, required: true });
  if (q.error) throw badRequest(q.error);
  const internalNote = note(body?.note);
  const cfg = onboardingConfig();
  const token = crypto.randomBytes(32).toString('base64url');
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.query('SELECT id, email, status FROM registration_requests WHERE id = ?', [String(id)]);
    if (!r) throw notFound('Access request not found');
    const at = nowIso();
    const done = await tx.run(
      `UPDATE registration_requests SET status = 'INFO_REQUESTED', info_request = ?, info_requested_at = ?, info_requested_by = ?, info_response = NULL,
         info_responded_at = NULL, respond_token_hash = ?, respond_token_expires_at = ?, internal_note = COALESCE(?, internal_note), updated_at = ?
        WHERE id = ? AND status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')`,
      [q.value, at, actor.id, tokenHash(token), new Date(Date.now() + cfg.respondTtlMs).toISOString(), internalNote, at, r.id],
    );
    if (!done.changes) throw refuse(409, 'ALREADY_DECIDED', `This request is ${r.status.toLowerCase().replace('_', ' ')}`, { status: r.status });
    await insertAuditEvent(tx, {
      actorUserId: actor.id, action: 'registration.info_requested', targetType: 'registration_request', targetId: r.id, detail: { question_length: q.value.length }, ip,
    });
    return { email: r.email, at };
  });
  await sendOnboardingEmail('onboarding_info_requested', out.email, { question: q.value, link: joinLink(`?respond=${encodeURIComponent(token)}`) },
    { dedupeKey: `onb-info:${id}:${out.at}` });
  return { id: String(id), status: 'INFO_REQUESTED' };
}
