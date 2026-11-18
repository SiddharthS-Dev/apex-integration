import crypto from 'node:crypto';
import { log } from '../../lib/logger.js';

// Stakeholder onboarding settings (Use Case 007; docs/implementation/ONBOARDING_PLAN.md §6). Read from
// the environment on every call, like the Core config, so operators and tests can change them without a
// re-import. Every flag defaults OFF (DEC-014).
//
// Production enablement is refused unless an approved consent-notice version is configured (DEC-016):
// the DRAFT notice is allowed only outside production, or in the isolated staging stack, which marks
// itself with APEX_DEPLOYMENT=staging.

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const int = (v, fallback, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
};

export const DRAFT_CONSENT_VERSION = 'draft-2026-11-16';
export const DRAFT_CONSENT_TEXT = [
  'DRAFT — not yet approved. This notice is for development and staging only.',
  'Inspironics uses the details you enter here only to review your request for access to APEX and to contact you about it.',
  'Your request is reviewed by an Inspironics administrator. An AI assistant may help summarise it; the assistant never decides and never sees your password or verification code.',
  'Profile links you give are stored as text and are not visited automatically.',
  'If your request is not approved, or is not completed, the details are removed under the retention policy.',
].join('\n\n');

// A per-process secret when none is configured outside production: codes then stop working across a
// restart (they live 10 minutes anyway). Production requires REGISTRATION_CODE_SECRET.
let ephemeralSecret = null;
function ephemeral() {
  if (!ephemeralSecret) ephemeralSecret = crypto.randomBytes(32).toString('base64url');
  return ephemeralSecret;
}

let warned = '';
function warnOnce(reason) {
  if (warned === reason) return;
  warned = reason;
  log.warn('onboarding.disabled', { reason });
}

export function onboardingConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const staging = String(env.APEX_DEPLOYMENT || '').trim().toLowerCase() === 'staging';
  const approvedVersion = String(env.ONBOARDING_CONSENT_VERSION || '').trim();
  const approvedUrl = String(env.ONBOARDING_CONSENT_URL || '').trim();
  const draftAllowed = !production || staging;
  const approved = !!approvedVersion && !/^draft/i.test(approvedVersion) && /^https:\/\//i.test(approvedUrl);
  const consent = approved
    ? { version: approvedVersion.slice(0, 100), draft: false, url: approvedUrl, text: null }
    : draftAllowed ? { version: DRAFT_CONSENT_VERSION, draft: true, url: null, text: DRAFT_CONSENT_TEXT } : null;

  const secretRaw = String(env.REGISTRATION_CODE_SECRET || '');
  const secret = secretRaw.length >= 32 ? secretRaw : production ? '' : ephemeral();
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

  let blocked = null;
  if (!consent) blocked = 'no approved consent notice (ONBOARDING_CONSENT_VERSION and an https ONBOARDING_CONSENT_URL)';
  else if (!secret) blocked = 'REGISTRATION_CODE_SECRET is missing or shorter than 32 characters';
  else if (production && !/^https:\/\//i.test(publicBaseUrl)) blocked = 'PUBLIC_BASE_URL must be an https origin in production';

  const wanted = bool(env.ONBOARDING_ENABLED);
  if (wanted && blocked) warnOnce(blocked);
  const enabled = wanted && !blocked;

  return {
    enabled,
    blocked: wanted ? blocked : null,
    selfRegistration: enabled && bool(env.SELF_REGISTRATION_ENABLED),
    aiEnabled: enabled && bool(env.ONBOARDING_AI_ENABLED),
    helpAssistant: bool(env.HELP_ASSISTANT_ENABLED), // deferred (plan §7): no route reads it yet
    consent,
    secret,
    // Trusted origin for emailed links; never the request's Host header. Outside production it may be
    // empty, and links are then relative (the operator reads them from the outbox).
    publicBaseUrl,
    codeTtlMs: int(env.ONBOARDING_CODE_TTL_MINUTES, 10, 1, 60) * 60_000,
    maxAttempts: int(env.ONBOARDING_CODE_MAX_ATTEMPTS, 5, 1, 20),
    resendSpacingMs: int(env.ONBOARDING_RESEND_SECONDS, 60, 10, 3600) * 1000,
    maxSends: int(env.ONBOARDING_MAX_SENDS, 5, 1, 20),
    // Starts per address per 24 hours (durable, counted in the database).
    maxStartsPerEmail: int(env.ONBOARDING_MAX_STARTS_PER_EMAIL, 5, 1, 50),
    draftTtlMs: int(env.ONBOARDING_DRAFT_HOURS, 24, 1, 168) * 3600_000,
    pendingTokenTtlMs: int(env.ONBOARDING_PENDING_TOKEN_DAYS, 30, 1, 180) * 86_400_000,
    respondTtlMs: int(env.ONBOARDING_RESPOND_DAYS, 14, 1, 60) * 86_400_000,
    // Days after a request closes before its row is deleted. No default: the privacy policy sets it
    // (secrets are cleared at close whatever this says).
    retentionDays: env.ONBOARDING_RETENTION_DAYS ? int(env.ONBOARDING_RETENTION_DAYS, 0, 1, 3650) : null,
    reviewNotifyEmail: String(env.ONBOARDING_REVIEW_NOTIFY_EMAIL || '').trim().toLowerCase() || null,
    aiTimeoutMs: int(env.ONBOARDING_AI_TIMEOUT_MS, 8000, 1000, 30000),
    ipLimitPerHour: int(env.ONBOARDING_IP_LIMIT_PER_HOUR, 30, 1, 1000),
    // The "we received your request" acknowledgement email. On unless set to false (the assistant already
    // shows the same message on screen, so some deployments send only the code email).
    submittedEmail: String(env.ONBOARDING_SUBMITTED_EMAIL ?? '').trim() === '' ? true : bool(env.ONBOARDING_SUBMITTED_EMAIL),
  };
}

/** An absolute link against the trusted public origin (relative when none is configured, outside production). */
export function publicLink(path, cfg = onboardingConfig()) {
  return `${cfg.publicBaseUrl}${path}`;
}
