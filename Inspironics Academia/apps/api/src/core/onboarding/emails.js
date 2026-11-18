import { config } from '../../config.js';
import { log } from '../../lib/logger.js';
import { layout } from '../../notify/templates.js';
import { drainOutbox, enqueueEmail } from '../../notify/outbox.js';
import { onboardingConfig } from './config.js';

// Onboarding emails (Use Case 007). Always queued through the outbox AFTER the transaction that caused
// them has committed, with a dedupe key, so a delivery failure retries without undoing or repeating the
// transition. Bodies never carry applicant profile data; only the code and response-link emails carry a
// one-time secret, and those kinds are withheld from the log transport (notify/mailer.js).
//
// Links use the trusted public origin (PUBLIC_BASE_URL; required in production), never a Host header.
// Outside production APP_ORIGIN, which the gateway sets for the Core, stands in.

const BRAND = 'APEX';
const FOOTER = `${BRAND} · access requests`;

const base = () => onboardingConfig().publicBaseUrl || config.appOrigin;
export const joinLink = (query = '') => `${base()}/join${query}`;
// Sign-in and review happen in the portal (the gateway origin APP_ORIGIN, and the Academia app at
// APP_BASE_URL), never on the separate onboarding page.
export const signInLink = () => `${config.appOrigin}/login`;

const minutes = (ms) => Math.round(ms / 60_000);

const TEMPLATES = {
  onboarding_code: ({ code, ttlMs }) => layout({
    title: `Your ${BRAND} verification code`, // never the code itself: subjects are logged and shown on lock screens
    paragraphs: [
      `Enter this code to confirm your email address for your ${BRAND} access request: ${code}`,
      `It expires in ${minutes(ttlMs)} minutes. If you did not ask for this, ignore this email; nothing is created without the code.`,
    ],
    footer: FOOTER,
  }),
  onboarding_existing_account: () => layout({
    title: `About your ${BRAND} access request`,
    paragraphs: [
      `Someone (hopefully you) started an access request with this email address. This address already has an ${BRAND} account, so no new request was created.`,
      'Sign in with your existing account. If you have forgotten your password, use "Forgot password" on the sign-in page.',
    ],
    action: { label: 'Sign in', link: signInLink() },
    footer: FOOTER,
  }),
  onboarding_already_pending: () => layout({
    title: `About your ${BRAND} access request`,
    paragraphs: [
      'Someone (hopefully you) started an access request with this email address. A request for this address is already being reviewed, so no new request was created.',
      'We will email you when a decision is made. You do not need to do anything now.',
    ],
    footer: FOOTER,
  }),
  onboarding_submitted: () => layout({
    title: `We received your ${BRAND} access request`,
    paragraphs: [
      'Thank you. Your request is waiting for review by our team. Submitting a request does not create an account or grant access; you will hear from us by email.',
    ],
    footer: FOOTER,
  }),
  onboarding_review_needed: ({ categoryLabel }) => layout({
    title: 'A new APEX access request is waiting for review',
    paragraphs: [`Category (self-selected): ${categoryLabel}.`, 'Open the APEX admin console to review it. Applicant details are shown there, not in this email.'],
    action: { label: 'Open the admin console', link: `${config.appOrigin}/admin` },
    footer: FOOTER,
  }),
  onboarding_info_requested: ({ question, link }) => layout({
    title: `More information is needed for your ${BRAND} access request`,
    paragraphs: ['Our team asked:', question, 'The link below works for you only and expires. Do not forward this email.'],
    action: { label: 'Answer the question', link },
    footer: FOOTER,
  }),
  // Approval sends the existing invitation email (notify/templates.js 'invite') with its set-password link,
  // or — when the applicant chose a password during onboarding — this one.
  onboarding_approved: ({ name }) => layout({
    title: `Your ${BRAND} access is approved`,
    paragraphs: [
      `${name ? `Hi ${name}, ` : ''}your access request was approved and your account is ready.`,
      'Sign in with your email address and the password you chose when you applied. If you have forgotten it, use "Forgot password" on the sign-in page.',
    ],
    action: { label: 'Sign in to APEX', link: signInLink() },
    footer: FOOTER,
  }),
  onboarding_rejected: ({ message }) => layout({
    title: `About your ${BRAND} access request`,
    paragraphs: ['Thank you for your interest. Your request was not approved this time, and the details you gave will be removed under our retention policy.', ...(message ? [message] : [])],
    footer: FOOTER,
  }),
};

/** Queues one onboarding email and starts a drain. Never throws (a failed email must not fail the action). */
export async function sendOnboardingEmail(kind, to, data = {}, { dedupeKey = null } = {}) {
  try {
    const email = TEMPLATES[kind](data);
    const queued = await enqueueEmail({ userId: null, to, kind, ...email, dedupeKey });
    drainOutbox().catch((err) => log.warn('email.drain_failed', { error: err.message }));
    return queued;
  } catch (err) {
    log.error('onboarding.email_failed', { kind, error: err.message });
    return false;
  }
}

export const ONBOARDING_EMAIL_KINDS = Object.keys(TEMPLATES);
