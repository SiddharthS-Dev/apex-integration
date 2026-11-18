import crypto from 'node:crypto';
import {
  APEX_PLATFORMS, DATE_FORMATS, ISO_COUNTRY_CODES, ONBOARDING_LOCALES, ONBOARDING_ROLE_GROUPS, ONBOARDING_ROLE_STEPS, ONBOARDING_ROLES, ROLE_PROFILE_SCHEMA_VERSION, UNIT_SYSTEMS,
  ONBOARDING_LIMITS, cleanText, isValidEmail, missingForRoleSubmission, normalizeEmail, onboardingRole,
  validateInterests, validatePreferences, validateRoleProfile,
} from '@academy/shared';
import { hashPassword, randomToken, validatePassword } from '../../auth/passwords.js';
import { HttpError, badRequest, notFound } from '../../lib/errors.js';
import { log } from '../../lib/logger.js';
import { insertAuditEvent } from '../audit.js';
import { isUniqueViolation } from '../roles.js';
import { onboardingConfig } from './config.js';
import { sendOnboardingEmail } from './emails.js';
import { ACCOUNT_SECRET_KINDS } from '../../notify/mailer.js';
import { scheduleReview, rulesRecommendation } from './review.js';

// Public stakeholder-onboarding flow (Use Case 007; plan §4, prompt §7–§8). Server-enforced states:
//
//   CODE_SENT → EMAIL_VERIFIED → PENDING_APPROVAL → APPROVED | REJECTED     (decisions: admin.js)
//   PENDING_APPROVAL ↔ INFO_REQUESTED
//   CODE_SENT | EMAIL_VERIFIED → SUPERSEDED (a new start for the address) | EXPIRED (sweep)
//
// No user, session, role or membership exists before approval. The browser holds one opaque resume
// token (the gateway keeps it in an HttpOnly cookie); only its SHA-256 is stored, and it rotates at
// every sensitive transition. Codes are six random digits stored as an HMAC bound to the request id and
// the code generation, with a server secret. Attempts are reserved with an atomic conditional UPDATE
// that commits on its own before the code is compared, so a failure is never rolled back, and a resend
// never resets the attempt budget.
//
// Account existence never shows: for an address that already has an account, a request under review,
// or too many starts, `start` answers exactly as for a new address but backs the token with a
// registration_decoys row, and status / resend / verify then behave as for a real CODE_SENT request
// whose code is never right. The real owner is told privately by email (deduplicated per hour).

export const GENERIC_SENT = 'If this address can continue, we have sent the next steps by email.';
const RESTART = 'This request has expired or is no longer available. Start again.';

const nowIso = () => new Date().toISOString();
const plus = (ms) => new Date(Date.now() + ms).toISOString();
const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmacHex = (secret, s) => crypto.createHmac('sha256', secret).update(s, 'utf8').digest('hex');
export const tokenHash = (token) => sha256Hex(`apex-onboarding-token:${token}`);
const newToken = () => crypto.randomBytes(32).toString('base64url');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const codeDigest = (secret, id, generation, code) => hmacHex(secret, `code:${id}:${generation}:${code}`);
const emailDigest = (secret, email) => hmacHex(secret, `email:${email}`);
const hourBucket = () => new Date().toISOString().slice(0, 13);

const parse = (text, fallback) => {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};

const refuse = (status, code, error, extra = {}) => new HttpError(status, error, { code, ...extra });
const restart = () => refuse(401, 'RESTART', RESTART);

function requireFlow(cfg = onboardingConfig()) {
  if (!cfg.enabled || !cfg.selfRegistration) throw notFound(); // off: indistinguishable from no route
  return cfg;
}

/** Validation errors as one 400 with a field map. */
function invalid(errors) {
  const first = Object.values(errors)[0];
  return badRequest(first || 'Check the highlighted fields', { code: 'INVALID', fields: errors });
}

/** Validates the profile part of a draft (shared by start and update). Partial: completeness is checked at submit. */
function validateDraft(body) {
  const errors = {};
  const name = cleanText(body.full_name, { label: 'Name', max: ONBOARDING_LIMITS.fullName, required: true });
  if (name.error) errors.full_name = name.error;
  const org = cleanText(body.claimed_organization, { label: 'Organisation or institution', max: ONBOARDING_LIMITS.organization });
  if (org.error) errors.claimed_organization = org.error;
  // One of the six onboarding roles (shared catalogue). The stored category is the role's mapping onto
  // the existing category codes; a client cannot choose it separately.
  const roleCode = typeof body.onboarding_role === 'string' ? body.onboarding_role : '';
  const role = onboardingRole(roleCode);
  const profile = validateRoleProfile(roleCode, body.category_profile, { partial: true });
  Object.assign(errors, profile.errors);
  const code = role ? role.category : '';
  const interests = validateInterests(body.interest_codes, body.interest_other);
  Object.assign(errors, interests.errors);
  const prefs = validatePreferences(body.preferences);
  Object.assign(errors, prefs.errors);
  return {
    errors,
    value: {
      full_name: name.value, claimed_organization: org.value ?? null, onboarding_role: roleCode, primary_category_code: code, category_profile: profile.value,
      interest_codes: interests.codes || [], interest_other: interests.other ?? null, preferences: prefs.value || {},
    },
  };
}

/** What the verified applicant sees of their own draft (never review notes, AI advice or decisions). */
export function publicDraft(row) {
  const profile = parse(row.category_profile, {});
  return {
    email: row.email,
    full_name: row.full_name,
    claimed_organization: row.claimed_organization,
    onboarding_role: profile.onboarding_role || null,
    primary_category_code: row.primary_category_code,
    category_profile: profile,
    interest_codes: parse(row.interest_codes, []),
    interest_other: row.interest_other,
    preferences: parse(row.preferences, {}),
  };
}

/** The CODE_SENT view: identical keys and meaning for a real request and a decoy. */
function codeView(row, cfg) {
  const resendAt = new Date(Date.parse(row.last_code_sent_at) + cfg.resendSpacingMs).toISOString();
  return {
    state: 'CODE_SENT',
    code_expires_at: row.code_expires_at,
    resend_available_at: resendAt,
    sends_remaining: Math.max(0, cfg.maxSends - Number(row.sends)),
    attempts_remaining: Math.max(0, cfg.maxAttempts - Number(row.failed_attempts)),
  };
}

/** Clears every secret of a request that is closing (the table's CHECKs require it). */
const CLOSE_SECRETS = `code_digest = NULL, code_expires_at = NULL, credential_hash = NULL, resume_token_hash = NULL,
  resume_token_expires_at = NULL, respond_token_hash = NULL, respond_token_expires_at = NULL`;

function retentionDue(cfg) {
  return cfg.retentionDays ? plus(cfg.retentionDays * 86_400_000) : null;
}

async function supersede(tx, row, cfg, { ip, why }) {
  const at = nowIso();
  const r = await tx.run(
    `UPDATE registration_requests SET status = 'SUPERSEDED', ${CLOSE_SECRETS}, closed_at = ?, retention_due_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('CODE_SENT', 'EMAIL_VERIFIED')`,
    [at, retentionDue(cfg), at, row.id],
  );
  if (r.changes) {
    await insertAuditEvent(tx, { actorKind: 'system', action: 'registration.superseded', targetType: 'registration_request', targetId: row.id, detail: { reason: why }, ip });
  }
  return r.changes > 0;
}

async function createDecoy(q, cfg, email, { ip, reason }) {
  const token = newToken();
  const at = nowIso();
  await q.run(
    `INSERT INTO registration_decoys (token_hash, email_digest, failed_attempts, sends, last_code_sent_at, code_expires_at, expires_at, created_at)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?)`,
    [tokenHash(token), emailDigest(cfg.secret, email), at, plus(cfg.codeTtlMs), plus(cfg.draftTtlMs), at],
  );
  await insertAuditEvent(q, { actorKind: 'system', action: 'registration.start_withheld', targetType: 'registration_request', detail: { reason }, ip });
  return token;
}

async function startsInLastDay(q, cfg, email) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [a] = await q.query('SELECT COUNT(*) AS n FROM registration_requests WHERE email = ? AND created_at > ?', [email, since]);
  const [b] = await q.query('SELECT COUNT(*) AS n FROM registration_decoys WHERE email_digest = ? AND created_at > ?', [emailDigest(cfg.secret, email), since]);
  return Number(a.n) + Number(b.n);
}

/** Finds what a resume token stands for: { kind: 'request' | 'decoy', row } or null. */
async function lookup(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const h = tokenHash(token);
  const at = nowIso();
  const [row] = await db.query(
    "SELECT * FROM registration_requests WHERE resume_token_hash = ? AND resume_token_expires_at > ? AND status IN ('CODE_SENT', 'EMAIL_VERIFIED', 'PENDING_APPROVAL', 'INFO_REQUESTED')",
    [h, at],
  );
  if (row) return { kind: 'request', row };
  const [decoy] = await db.query('SELECT * FROM registration_decoys WHERE token_hash = ? AND expires_at > ?', [h, at]);
  return decoy ? { kind: 'decoy', row: decoy } : null;
}

async function rotateToken(tx, id, ttlMs) {
  const token = newToken();
  await tx.run('UPDATE registration_requests SET resume_token_hash = ?, resume_token_expires_at = ? WHERE id = ?', [tokenHash(token), plus(ttlMs), id]);
  return token;
}

// ---- Public entry points (each returns the JSON body; the route sends it) ----------------------------

/** GET /config — flags and the public catalogue (no secrets). */
export function publicConfig() {
  const cfg = onboardingConfig();
  return {
    enabled: cfg.enabled && cfg.selfRegistration,
    ai_suggestions: cfg.aiEnabled,
    consent: cfg.enabled && cfg.consent ? { version: cfg.consent.version, draft: cfg.consent.draft, url: cfg.consent.url, text: cfg.consent.text } : null,
    // The six roles and their questions, which the assistant asks one at a time. Never the grantable
    // roles or the reviewer's verification notes.
    role_groups: ONBOARDING_ROLE_GROUPS,
    roles: ONBOARDING_ROLES.map((r) => ({
      code: r.code, label: r.label, group: r.group, description: r.description, email_label: r.emailLabel, organization: r.organization, fields: r.fields,
      steps: ONBOARDING_ROLE_STEPS[r.code],
    })),
    preferences: { countries: ISO_COUNTRY_CODES, locales: ONBOARDING_LOCALES, date_formats: DATE_FORMATS, unit_systems: UNIT_SYSTEMS },
    // The APEX platforms the applicant may ask to use (a request; the approver confirms).
    platforms: APEX_PLATFORMS,
    limits: {
      code_ttl_minutes: Math.round(cfg.codeTtlMs / 60_000), max_attempts: cfg.maxAttempts, resend_seconds: Math.round(cfg.resendSpacingMs / 1000),
      max_sends: cfg.maxSends, ...ONBOARDING_LIMITS,
    },
  };
}

/** POST /start */
export async function start(db, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const input = body && typeof body === 'object' ? body : {};
  const email = normalizeEmail(input.email);
  const errors = {};
  if (!isValidEmail(email)) errors.email = 'Enter a valid email address';
  const draft = validateDraft(input);
  Object.assign(errors, draft.errors);
  if (input.adult_confirmed !== true) errors.adult_confirmed = 'Access requests are open to adults (18 or older) only for now.';
  if (input.consent_accepted !== true || input.consent_version !== cfg.consent.version) errors.consent_accepted = 'Read and accept the notice to continue.';
  // Optional: the applicant chooses the account password now (the onboarding app asks for it). It is
  // hashed at once and kept only as a hash; the account is created with it only if an administrator
  // approves. Without one, approval sends the invitation (set-password) link as before.
  const choosePassword = input.password !== undefined && input.password !== null && input.password !== '';
  if (choosePassword) {
    const problem = validatePassword(input.password);
    if (problem) errors.password = problem;
    else if (input.password_confirmation !== undefined && input.password_confirmation !== input.password) errors.password_confirmation = 'The passwords do not match';
  }
  if (Object.keys(errors).length) throw invalid(errors);
  // Hashed on every path (decoys included), so the response time does not reveal which path ran.
  const chosenHash = choosePassword ? await hashPassword(input.password) : null;

  const reply = (token, view) => ({ ok: true, message: GENERIC_SENT, registration_token: token, ...view });
  const decoyReply = async (reason) => {
    const token = await createDecoy(db, cfg, email, { ip, reason });
    const [row] = await db.query('SELECT * FROM registration_decoys WHERE token_hash = ?', [tokenHash(token)]);
    return reply(token, codeView(row, cfg));
  };

  // A restart from the same browser (e.g. to change the email address) supersedes the earlier draft.
  const previous = await lookup(db, input.previous_token);
  if (previous?.kind === 'request') {
    await db.transaction((tx) => supersede(tx, previous.row, cfg, { ip, why: 'restarted' }));
  }

  if ((await startsInLastDay(db, cfg, email)) >= cfg.maxStartsPerEmail) return decoyReply('start_limit');

  const [user] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (user) {
    const out = await decoyReply('existing_account');
    await sendOnboardingEmail('onboarding_existing_account', email, {}, { dedupeKey: `onb-existing:${emailDigest(cfg.secret, email)}:${hourBucket()}` });
    return out;
  }

  const [open] = await db.query(
    "SELECT * FROM registration_requests WHERE email = ? AND status IN ('CODE_SENT', 'EMAIL_VERIFIED', 'PENDING_APPROVAL', 'INFO_REQUESTED')",
    [email],
  );
  if (open && ['PENDING_APPROVAL', 'INFO_REQUESTED'].includes(open.status)) {
    const out = await decoyReply('request_under_review');
    await sendOnboardingEmail('onboarding_already_pending', email, {}, { dedupeKey: `onb-pending:${emailDigest(cfg.secret, email)}:${hourBucket()}` });
    return out;
  }

  const id = crypto.randomUUID();
  const code = newCode();
  const token = newToken();
  const at = nowIso();
  const d = draft.value;
  let row;
  try {
    row = await db.transaction(async (tx) => {
      if (open) await supersede(tx, open, cfg, { ip, why: 'new_start' });
      await tx.run(
        `INSERT INTO registration_requests (id, email, full_name, claimed_organization, primary_category_code, category_profile, profile_schema_version,
           interest_codes, interest_other, preferences, consent_version, consent_accepted_at, adult_confirmed_at, status, code_digest, code_generation,
           code_expires_at, last_code_sent_at, failed_attempts, sends, resume_token_hash, resume_token_expires_at, credential_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CODE_SENT', ?, 1, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
        [id, email, d.full_name, d.claimed_organization, d.primary_category_code, JSON.stringify(d.category_profile), ROLE_PROFILE_SCHEMA_VERSION,
          JSON.stringify(d.interest_codes), d.interest_other, JSON.stringify(d.preferences), cfg.consent.version, at, at,
          codeDigest(cfg.secret, id, 1, code), plus(cfg.codeTtlMs), at, tokenHash(token), plus(cfg.draftTtlMs), chosenHash, at, at],
      );
      await insertAuditEvent(tx, {
        actorKind: 'system', action: 'registration.started', targetType: 'registration_request', targetId: id,
        // password_chosen tells approval whether to send the invitation link (never the password itself).
        detail: { category: d.primary_category_code, consent_version: cfg.consent.version, password_chosen: !!chosenHash }, ip,
      });
      const [r] = await tx.query('SELECT * FROM registration_requests WHERE id = ?', [id]);
      return r;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return decoyReply('concurrent_start'); // another start for this address won the race
  }
  await sendOnboardingEmail('onboarding_code', email, { code, ttlMs: cfg.codeTtlMs }, { dedupeKey: `onb-code:${id}:1` });
  return reply(token, codeView(row, cfg));
}

/** GET /status — the minimum needed to resume. */
export async function status(db, token) {
  const cfg = requireFlow();
  const found = await lookup(db, token);
  if (!found) throw restart();
  const { kind, row } = found;
  if (kind === 'decoy' || row.status === 'CODE_SENT') return codeView(row, cfg);
  if (row.status === 'EMAIL_VERIFIED') return { state: 'EMAIL_VERIFIED', draft: publicDraft(row) };
  if (row.status === 'INFO_REQUESTED') return { state: 'INFO_REQUESTED', info_request: row.info_request };
  return { state: 'PENDING_APPROVAL', submitted_at: row.submitted_at };
}

/** POST /resend */
export async function resend(db, token, { ip = null } = {}) {
  const cfg = requireFlow();
  const found = await lookup(db, token);
  if (!found) throw restart();
  const { kind, row } = found;
  if (kind === 'request' && row.status !== 'CODE_SENT') throw refuse(409, 'NOT_WAITING_FOR_CODE', 'Your email address is already confirmed.', { state: row.status });
  if (Number(row.failed_attempts) >= cfg.maxAttempts) throw refuse(429, 'LOCKED', 'Too many wrong codes. Start again.');
  if (Number(row.sends) >= cfg.maxSends) throw refuse(429, 'SEND_LIMIT', 'No more codes can be sent for this request. Start again later.');
  const earliest = Date.parse(row.last_code_sent_at) + cfg.resendSpacingMs;
  const tooSoon = () => refuse(429, 'TOO_SOON', 'Wait a moment before asking for another code.', { resend_available_at: new Date(earliest).toISOString() });
  if (Date.now() < earliest) throw tooSoon();
  const at = nowIso();
  const cutoff = new Date(Date.now() - cfg.resendSpacingMs).toISOString();
  const expires = plus(cfg.codeTtlMs);

  if (kind === 'decoy') {
    const r = await db.run(
      'UPDATE registration_decoys SET sends = sends + 1, last_code_sent_at = ?, code_expires_at = ? WHERE token_hash = ? AND sends < ? AND last_code_sent_at <= ?',
      [at, expires, row.token_hash, cfg.maxSends, cutoff],
    );
    if (!r.changes) throw tooSoon();
    const [fresh] = await db.query('SELECT * FROM registration_decoys WHERE token_hash = ?', [row.token_hash]);
    return { ok: true, message: GENERIC_SENT, ...codeView(fresh, cfg) };
  }

  const generation = Number(row.code_generation) + 1;
  const code = newCode();
  // The new generation's digest replaces the old one: the previous code stops working. Attempts stay.
  const r = await db.run(
    `UPDATE registration_requests SET code_generation = ?, code_digest = ?, code_expires_at = ?, sends = sends + 1, last_code_sent_at = ?, updated_at = ?
      WHERE id = ? AND status = 'CODE_SENT' AND code_generation = ? AND sends < ? AND last_code_sent_at <= ?`,
    [generation, codeDigest(cfg.secret, row.id, generation, code), expires, at, at, row.id, generation - 1, cfg.maxSends, cutoff],
  );
  if (!r.changes) throw tooSoon();
  await insertAuditEvent(db, { actorKind: 'system', action: 'registration.code_resent', targetType: 'registration_request', targetId: row.id, detail: { generation }, ip });
  await sendOnboardingEmail('onboarding_code', row.email, { code, ttlMs: cfg.codeTtlMs }, { dedupeKey: `onb-code:${row.id}:${generation}` });
  const [fresh] = await db.query('SELECT * FROM registration_requests WHERE id = ?', [row.id]);
  return { ok: true, message: GENERIC_SENT, ...codeView(fresh, cfg) };
}

function codeMatches(secret, row, code) {
  if (!row.code_digest) return false;
  const given = Buffer.from(codeDigest(secret, row.id, Number(row.code_generation), code), 'hex');
  const expected = Buffer.from(String(row.code_digest), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** POST /verify { code } */
export async function verify(db, token, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) throw invalid({ code: 'Enter the 6-digit code from the email' });
  const found = await lookup(db, token);
  if (!found) throw restart();
  const { kind, row } = found;
  if (kind === 'request' && row.status !== 'CODE_SENT') throw refuse(409, 'NOT_WAITING_FOR_CODE', 'Your email address is already confirmed.', { state: row.status });

  // Reserve one attempt first, in its own statement (autocommit), so nothing can roll it back and two
  // concurrent guesses cannot both slip under the budget.
  const reserved = kind === 'decoy'
    ? await db.run('UPDATE registration_decoys SET failed_attempts = failed_attempts + 1 WHERE token_hash = ? AND failed_attempts < ?', [row.token_hash, cfg.maxAttempts])
    : await db.run(
      "UPDATE registration_requests SET failed_attempts = failed_attempts + 1, updated_at = ? WHERE id = ? AND status = 'CODE_SENT' AND failed_attempts < ?",
      [nowIso(), row.id, cfg.maxAttempts],
    );
  const audit = (action, detail) => (kind === 'request'
    ? insertAuditEvent(db, { actorKind: 'system', action, targetType: 'registration_request', targetId: row.id, detail, ip })
    : null);
  if (!reserved.changes) {
    await audit('registration.verify_failed', { reason: 'locked' });
    throw refuse(429, 'LOCKED', 'Too many wrong codes. Start again.');
  }
  const remaining = Math.max(0, cfg.maxAttempts - Number(row.failed_attempts) - 1);
  if (row.code_expires_at <= nowIso()) {
    await audit('registration.verify_failed', { reason: 'expired' });
    throw refuse(410, 'CODE_EXPIRED', 'That code has expired. Ask for a new one.', { attempts_remaining: remaining });
  }
  if (kind === 'decoy' || !codeMatches(cfg.secret, row, code)) {
    await audit('registration.verify_failed', { reason: 'wrong_code', attempts_remaining: remaining });
    throw refuse(400, 'WRONG_CODE', remaining ? 'That code is not right. Check the latest email and try again.' : 'That code is not right. Start again.', { attempts_remaining: remaining });
  }

  const result = await db.transaction(async (tx) => {
    const at = nowIso();
    // The successful attempt is given back: failed_attempts counts failures only.
    const r = await tx.run(
      `UPDATE registration_requests SET status = 'EMAIL_VERIFIED', email_verified_at = ?, code_digest = NULL, code_expires_at = NULL,
         failed_attempts = failed_attempts - 1, updated_at = ?
        WHERE id = ? AND status = 'CODE_SENT' AND code_generation = ?`,
      [at, at, row.id, Number(row.code_generation)],
    );
    if (!r.changes) return null;
    const next = await rotateToken(tx, row.id, cfg.draftTtlMs);
    await insertAuditEvent(tx, { actorKind: 'system', action: 'registration.email_verified', targetType: 'registration_request', targetId: row.id, ip });
    const [fresh] = await tx.query('SELECT * FROM registration_requests WHERE id = ?', [row.id]);
    return { token: next, row: fresh };
  });
  if (!result) throw refuse(409, 'CODE_REPLACED', 'A newer code was sent. Use the code from the latest email.');
  return { state: 'EMAIL_VERIFIED', registration_token: result.token, draft: publicDraft(result.row) };
}

async function requireState(db, token, states) {
  const found = await lookup(db, token);
  if (!found) throw restart();
  if (found.kind === 'decoy' || !states.includes(found.row.status)) {
    const state = found.kind === 'decoy' ? 'CODE_SENT' : found.row.status;
    throw refuse(409, state === 'CODE_SENT' ? 'VERIFY_FIRST' : 'WRONG_STATE', state === 'CODE_SENT' ? 'Confirm your email address first.' : 'This step is not available now.', { state });
  }
  return found.row;
}

/** POST /update — edits a verified draft. The email address cannot change here: a new start does that. */
export async function update(db, token, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const row = await requireState(db, token, ['EMAIL_VERIFIED']);
  const input = body && typeof body === 'object' ? body : {};
  if (input.email !== undefined && normalizeEmail(input.email) !== row.email) {
    throw refuse(409, 'EMAIL_CHANGE_RESTARTS', 'To use a different email address, start again with that address; it will need its own code.');
  }
  const merged = { ...publicDraft(row), ...input };
  const draft = validateDraft(merged);
  if (Object.keys(draft.errors).length) throw invalid(draft.errors);
  const d = draft.value;
  const changed = ['full_name', 'claimed_organization', 'onboarding_role', 'category_profile', 'interest_codes', 'interest_other', 'preferences']
    .filter((k) => JSON.stringify(d[k]) !== JSON.stringify(publicDraft(row)[k]));
  if (!changed.length) return { state: 'EMAIL_VERIFIED', draft: publicDraft(row) };
  return db.transaction(async (tx) => {
    const r = await tx.run(
      `UPDATE registration_requests SET full_name = ?, claimed_organization = ?, primary_category_code = ?, category_profile = ?, interest_codes = ?,
         interest_other = ?, preferences = ?, updated_at = ? WHERE id = ? AND status = 'EMAIL_VERIFIED'`,
      [d.full_name, d.claimed_organization, d.primary_category_code, JSON.stringify(d.category_profile), JSON.stringify(d.interest_codes),
        d.interest_other, JSON.stringify(d.preferences), nowIso(), row.id],
    );
    if (!r.changes) throw restart();
    await insertAuditEvent(tx, {
      actorKind: 'system', action: 'registration.updated', targetType: 'registration_request', targetId: row.id, ip,
      detail: { fields: changed, ...(changed.includes('onboarding_role') ? { role_from: publicDraft(row).onboarding_role, role_to: d.onboarding_role } : {}) },
    });
    const [fresh] = await tx.query('SELECT * FROM registration_requests WHERE id = ?', [row.id]);
    return { state: 'EMAIL_VERIFIED', draft: publicDraft(fresh) };
  });
}

/**
 * POST /complete {} — submits the verified request for review. The password, if the applicant chose
 * one, was given (and hashed) at /start; it is never accepted here. Without one, the request holds a
 * random credential nobody knows and approval sends the invitation (set-password) link.
 */
export async function complete(db, token, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const row = await requireState(db, token, ['EMAIL_VERIFIED']);
  if (body && (body.password !== undefined || body.password_confirmation !== undefined)) {
    throw invalid({ password: 'The password is chosen in the first step, not at submission.' });
  }
  const draft = publicDraft(row);
  const full = validateRoleProfile(draft.onboarding_role, draft.category_profile, { partial: false });
  const missing = missingForRoleSubmission(draft);
  if (missing.length || Object.keys(full.errors).length) {
    const fields = { ...full.errors };
    if (missing.includes('claimed_organization')) fields.claimed_organization = 'Organisation is required for this role';
    if (missing.includes('platforms')) fields.platforms = 'Choose at least one APEX platform';
    throw invalid(fields);
  }
  // The address is verified, so telling its owner it already has an account reveals nothing.
  const [user] = await db.query('SELECT id FROM users WHERE email = ?', [row.email]);
  if (user) throw refuse(409, 'ACCOUNT_EXISTS', 'This email address already has an account. Sign in instead.');

  // The applicant's chosen password hash is kept; without one, a random credential nobody knows (the
  // invitation link sets a real password after approval).
  const credentialHash = await hashPassword(randomToken(32));
  const rules = rulesRecommendation(row);
  const out = await db.transaction(async (tx) => {
    const at = nowIso();
    const r = await tx.run(
      `UPDATE registration_requests SET status = 'PENDING_APPROVAL', submitted_at = ?, credential_hash = COALESCE(credential_hash, ?), ai_recommendation = ?,
         ai_recommendation_source = 'rules', ai_model = NULL, ai_schema_version = ?, updated_at = ?
        WHERE id = ? AND status = 'EMAIL_VERIFIED'`,
      [at, credentialHash, JSON.stringify(rules), rules.schema_version, at, row.id],
    );
    if (!r.changes) throw restart();
    const next = await rotateToken(tx, row.id, cfg.pendingTokenTtlMs);
    await insertAuditEvent(tx, {
      actorKind: 'system', action: 'registration.submitted', targetType: 'registration_request', targetId: row.id, detail: { role: draft.onboarding_role, category: row.primary_category_code }, ip,
    });
    return { token: next, at };
  });
  if (cfg.submittedEmail) await sendOnboardingEmail('onboarding_submitted', row.email, {}, { dedupeKey: `onb-submitted:${row.id}` });
  if (cfg.reviewNotifyEmail) {
    await sendOnboardingEmail('onboarding_review_needed', cfg.reviewNotifyEmail, { categoryLabel: onboardingRole(parse(row.category_profile, {}).onboarding_role)?.label || row.primary_category_code },
      { dedupeKey: `onb-review:${row.id}:${out.at}` });
  }
  scheduleReview(db, row.id); // optional AI advice after commit; the rules advice is already stored
  return { state: 'PENDING_APPROVAL', registration_token: out.token, submitted_at: out.at };
}

/** POST /exchange { token } — swaps an emailed response link for a resume token (the link leaves the URL). */
export async function exchange(db, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const raw = typeof body?.token === 'string' ? body.token : '';
  if (raw.length < 20 || raw.length > 200) throw restart();
  const [row] = await db.query(
    "SELECT * FROM registration_requests WHERE respond_token_hash = ? AND respond_token_expires_at > ? AND status = 'INFO_REQUESTED'",
    [tokenHash(raw), nowIso()],
  );
  if (!row) throw restart();
  const next = await db.transaction(async (tx) => {
    const t = await rotateToken(tx, row.id, cfg.pendingTokenTtlMs);
    await insertAuditEvent(tx, { actorKind: 'system', action: 'registration.response_link_used', targetType: 'registration_request', targetId: row.id, ip });
    return t;
  });
  return { state: 'INFO_REQUESTED', registration_token: next, info_request: row.info_request };
}

/** POST /respond { response } */
export async function respond(db, token, body, { ip = null } = {}) {
  const cfg = requireFlow();
  const row = await requireState(db, token, ['INFO_REQUESTED']);
  const text = cleanText(body?.response, { label: 'Your answer', max: ONBOARDING_LIMITS.infoResponse, multiline: true, required: true });
  if (text.error) throw invalid({ response: text.error });
  const out = await db.transaction(async (tx) => {
    const at = nowIso();
    const r = await tx.run(
      `UPDATE registration_requests SET status = 'PENDING_APPROVAL', info_response = ?, info_responded_at = ?, respond_token_hash = NULL,
         respond_token_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'INFO_REQUESTED'`,
      [text.value, at, at, row.id],
    );
    if (!r.changes) throw restart();
    const next = await rotateToken(tx, row.id, cfg.pendingTokenTtlMs);
    await insertAuditEvent(tx, { actorKind: 'system', action: 'registration.info_responded', targetType: 'registration_request', targetId: row.id, ip });
    return { token: next, at };
  });
  if (cfg.reviewNotifyEmail) {
    await sendOnboardingEmail('onboarding_review_needed', cfg.reviewNotifyEmail, { categoryLabel: onboardingRole(parse(row.category_profile, {}).onboarding_role)?.label || row.primary_category_code },
      { dedupeKey: `onb-review:${row.id}:${out.at}` });
  }
  scheduleReview(db, row.id); // refresh the advice with the answer
  return { state: 'PENDING_APPROVAL', registration_token: out.token, submitted_at: row.submitted_at };
}

// ---- Housekeeping --------------------------------------------------------------------------------

const SECRET_KINDS = ['onboarding_code', 'onboarding_info_requested'];

/**
 * Expires stale drafts, drops expired decoys and response links, blanks secret email bodies once sent
 * (or after a day), and deletes closed requests whose retention period (if configured) has passed.
 */
export async function sweepOnboarding(db, cfg = onboardingConfig()) {
  const at = nowIso();
  const draftCutoff = new Date(Date.now() - cfg.draftTtlMs).toISOString();
  const expired = await db.run(
    `UPDATE registration_requests SET status = 'EXPIRED', ${CLOSE_SECRETS}, closed_at = ?, retention_due_at = ?, updated_at = ?
      WHERE status IN ('CODE_SENT', 'EMAIL_VERIFIED') AND created_at < ?`,
    [at, retentionDue(cfg), at, draftCutoff],
  );
  await db.run('UPDATE registration_requests SET respond_token_hash = NULL, respond_token_expires_at = NULL WHERE respond_token_expires_at < ?', [at]);
  const decoys = await db.run('DELETE FROM registration_decoys WHERE expires_at < ?', [at]);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const blanked = await db.run(
    `UPDATE email_outbox SET text_body = '[removed: one-time secret]', html_body = NULL
      WHERE kind IN (?, ?) AND text_body <> '[removed: one-time secret]' AND (status = 'sent' OR created_at < ?)`,
    [...SECRET_KINDS, dayAgo],
  );
  // Account reset/invite links (live one-time secrets): blanked once delivered or finally failed, at the next sweep.
  const accountKinds = [...ACCOUNT_SECRET_KINDS];
  const accountBlanked = (await db.run(
    `UPDATE email_outbox SET text_body = '[removed: one-time secret]', html_body = NULL
      WHERE kind IN (${accountKinds.map(() => '?').join(', ')}) AND text_body <> '[removed: one-time secret]' AND status IN ('sent', 'failed')`,
    accountKinds,
  )).changes;
  let purged = 0;
  if (cfg.retentionDays) {
    purged = (await db.run(
      "DELETE FROM registration_requests WHERE status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED') AND retention_due_at IS NOT NULL AND retention_due_at < ?",
      [at],
    )).changes;
  }
  const result = { expired: expired.changes, decoys_removed: decoys.changes, secret_emails_blanked: blanked.changes + accountBlanked, purged };
  if (Object.values(result).some(Boolean)) log.info('onboarding.sweep', result);
  return result;
}

