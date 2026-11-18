import { config } from '../config.js';
import { log } from '../lib/logger.js';

// Email transports. `log` writes the message to the server log (development, and the fallback that
// keeps password-reset links reachable by an operator); `resend` posts to the Resend HTTP API;
// `smtp` sends through nodemailer (an API dependency, imported only when that transport is selected).

const PROVIDERS = ['log', 'resend', 'smtp', 'emailjs'];

export const emailProvider = () => (PROVIDERS.includes(config.email.provider) ? config.email.provider : 'log');

const emailjsReady = () => { const e = config.email.emailjs || {}; return !!(e.serviceId && e.templateId && e.publicKey && e.privateKey); };

/** True when mail actually leaves the server (anything but the log transport, with its credentials). */
export function emailConfigured() {
  const p = emailProvider();
  if (p === 'resend') return !!config.email.resendApiKey;
  if (p === 'smtp') return !!config.email.smtpUrl;
  if (p === 'emailjs') return emailjsReady();
  return false;
}

// EmailJS REST API (server-side). One generic EmailJS template renders every APEX email from these
// parameters: {{to_email}} in "To Email", {{subject}} in "Subject", and {{{html_message}}} (three braces,
// raw HTML) or {{message}} (plain text) in the body. The private key ("accessToken") never leaves this server.
export async function sendEmailjs(msg, fetchImpl = fetch) {
  const e = config.email.emailjs || {};
  if (!emailjsReady()) throw new Error('EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY and EMAILJS_PRIVATE_KEY must all be set');
  const fromName = String(config.email.from || '').replace(/\s*<[^>]*>\s*$/, '').trim() || 'Inspironics APEX';
  const params = {
    to_email: msg.to, email: msg.to, user_email: msg.to, recipient: msg.to, reply_to: msg.to,
    // Bodies carry no applicant profile data (Use Case 007), so there is no name to send: a neutral greeting.
    name: 'there', to_name: 'there', user_name: 'there',
    subject: msg.subject,
    message: msg.text,
    html_message: msg.html || '',
    from_name: fromName, company_name: fromName,
  };
  const isCode = msg.kind === 'onboarding_code';
  if (isCode) {
    // The code and lifetime come from the APEX code email (core/onboarding/emails.js). The common OTP
    // template variable names are all filled, so any EmailJS OTP template shows the code.
    const code = (String(msg.text || '').match(/\b(\d{6})\b/) || [])[1] || '';
    const mins = Number((String(msg.text || '').match(/expires in (\d+) minutes/i) || [])[1] || 10);
    const until = new Date(Date.now() + mins * 60_000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    Object.assign(params, { passcode: code, otp: code, code, otp_code: code, verification_code: code, time: until, expiry_time: until, expires_in: `${mins} minutes`, minutes: String(mins) });
  }
  const res = await fetchImpl('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: e.serviceId,
      template_id: isCode && e.otpTemplateId ? e.otpTemplateId : e.templateId,
      user_id: e.publicKey,
      accessToken: e.privateKey,
      template_params: params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // The response never echoes template params, so the code cannot leak into this error.
    throw new Error(`EmailJS ${res.status}: ${body.slice(0, 200)}`);
  }
  return { id: 'emailjs' };
}

async function sendResend(msg) {
  if (!config.email.resendApiKey) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.email.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html || undefined }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  return { id: data.id || '' };
}

/** The nodemailer module (loaded lazily so the log and Resend transports never touch it). */
export async function loadNodemailer() {
  try {
    const mod = await import('nodemailer');
    return mod.default || mod;
  } catch {
    throw new Error('EMAIL_PROVIDER=smtp needs the nodemailer package: npm install nodemailer -w @academy/api');
  }
}

let smtpTransport;
async function sendSmtp(msg) {
  if (!config.email.smtpUrl) throw new Error('SMTP_URL is not set');
  if (!smtpTransport) smtpTransport = (await loadNodemailer()).createTransport(config.email.smtpUrl);
  const info = await smtpTransport.sendMail({ from: config.email.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html || undefined });
  return { id: info.messageId || '' };
}

// Kinds whose body carries a one-time secret (an onboarding verification code, or an onboarding
// response link). The log transport never writes their body; it stays in email_outbox only (and the
// onboarding retention job blanks it there).
export const SECRET_BODY_KINDS = new Set(['onboarding_code', 'onboarding_info_requested']);
// Account mail that carries a live one-time link (set-password / reset). In production the log transport
// withholds these unless EMAIL_LOG_SECRETS=true, and the outbox body is blanked once sent (outbox.js).
export const ACCOUNT_SECRET_KINDS = new Set(['password_reset', 'invite']);

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
/** EMAIL_LOG_SECRETS=true: the operator explicitly accepts reset/invite links in the production log. */
export const logSecretsOptIn = () => truthy(process.env.EMAIL_LOG_SECRETS);

/** Sends one message ({ to, subject, text, html, kind }). Throws on failure; the outbox retries. */
export async function sendMail(msg) {
  const provider = emailProvider();
  if (provider === 'resend') return sendResend(msg);
  if (provider === 'smtp') return sendSmtp(msg);
  if (provider === 'emailjs') return sendEmailjs(msg);
  // Development only, opt-in: ONBOARDING_DEV_LOG_CODES=true prints onboarding codes and response links when no
  // email service is configured, so a local applicant can finish. Never in production.
  const devShow = process.env.NODE_ENV !== 'production' && /^(1|true|yes|on)$/i.test(String(process.env.ONBOARDING_DEV_LOG_CODES || '').trim());
  const accountWithheld = ACCOUNT_SECRET_KINDS.has(msg.kind) && process.env.NODE_ENV === 'production' && !logSecretsOptIn();
  const body = (SECRET_BODY_KINDS.has(msg.kind) && !devShow) || accountWithheld
    ? '[withheld: contains a one-time secret; configure an email provider, or set EMAIL_LOG_SECRETS=true]'
    : msg.text;
  log.info('email.logged', { to: msg.to, subject: msg.subject, body });
  return { id: 'log' };
}
