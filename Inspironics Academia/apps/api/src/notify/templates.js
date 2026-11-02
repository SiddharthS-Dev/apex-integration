import { config } from '../config.js';

// Email bodies: a plain-text part and a simple inline-styled HTML part (no external assets, so it
// renders the same in every mail client). In-app links become absolute against APP_BASE_URL.

const BRAND = 'Inspironics Academia';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const absoluteUrl = (link) => (/^https?:\/\//.test(link || '') ? link : `${config.appBaseUrl}${link?.startsWith('/') ? '' : '/'}${link || ''}`);

/** { subject, text, html } for a headline, paragraphs and an optional call to action. */
export function layout({ title, paragraphs = [], action, footer }) {
  const url = action ? absoluteUrl(action.link) : '';
  const text = [
    title,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(action ? [`${action.label}: ${url}`, ''] : []),
    '—',
    footer || `${BRAND} · manage notification emails in your profile: ${absoluteUrl('/profile')}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:linear-gradient(90deg,#4f46e5,#7c3aed);padding:16px 24px;color:#ffffff;font-weight:600;font-size:15px">${BRAND}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111827">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join('\n')}
${action ? `<p style="margin:20px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${esc(action.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #f0f0f3;font-size:12px;color:#6b7280">${esc(footer || 'You can change which emails you receive in your profile.')}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: title, text, html };
}

/** Email for an in-app notification ({ title, body, link } from buildNotification). */
export function notificationEmail(n) {
  return layout({ title: n.title, paragraphs: [n.body].filter(Boolean), action: n.link ? { label: 'Open Academia', link: n.link } : null });
}

// Account emails go out regardless of notification preferences.
export const accountEmails = {
  password_reset: ({ link }) => layout({
    title: 'Reset your password',
    paragraphs: ['Someone (hopefully you) asked to reset the password for your Academia account. The link works once and expires in an hour.', 'If you did not ask for this, ignore this email — your password stays the same.'],
    action: { label: 'Choose a new password', link },
    footer: `${BRAND} · account security`,
  }),
  invite: ({ name, invitedBy, link }) => layout({
    title: `You're invited to ${BRAND}`,
    paragraphs: [`${name ? `Hi ${name}, ` : ''}${invitedBy || 'An administrator'} has created an Academia account for you.`, 'Set your password to sign in. The link expires in 7 days.'],
    action: { label: 'Set your password', link },
    footer: `${BRAND} · account`,
  }),
  test: () => layout({
    title: 'Academia email is working',
    paragraphs: ['This is a test message sent from the Integrations page. If you can read it, notification emails will reach your learners.'],
    footer: `${BRAND} · test`,
  }),
};
