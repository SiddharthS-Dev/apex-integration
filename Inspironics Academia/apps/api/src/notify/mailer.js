import { config } from '../config.js';
import { log } from '../lib/logger.js';

// Email transports. `log` writes the message to the server log (development, and the fallback that
// keeps password-reset links reachable by an operator); `resend` posts to the Resend HTTP API;
// `smtp` sends through nodemailer (an API dependency, imported only when that transport is selected).

const PROVIDERS = ['log', 'resend', 'smtp'];

export const emailProvider = () => (PROVIDERS.includes(config.email.provider) ? config.email.provider : 'log');

/** True when mail actually leaves the server (anything but the log transport, with its credentials). */
export function emailConfigured() {
  const p = emailProvider();
  if (p === 'resend') return !!config.email.resendApiKey;
  if (p === 'smtp') return !!config.email.smtpUrl;
  return false;
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

/** Sends one message ({ to, subject, text, html }). Throws on failure; the outbox retries. */
export async function sendMail(msg) {
  const provider = emailProvider();
  if (provider === 'resend') return sendResend(msg);
  if (provider === 'smtp') return sendSmtp(msg);
  log.info('email.logged', { to: msg.to, subject: msg.subject, body: msg.text });
  return { id: 'log' };
}
