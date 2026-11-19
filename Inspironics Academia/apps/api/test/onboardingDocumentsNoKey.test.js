import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Without TOKEN_ENCRYPTION_KEY the optional mark sheet is not offered and an upload is refused: a file
// is never stored in the clear, and the intern's request still completes without it.

const h = await startHarness('onboarding-docs-nokey', {
  ONBOARDING_ENABLED: 'true', SELF_REGISTRATION_ENABLED: 'true', ONBOARDING_IP_LIMIT_PER_HOUR: '1000', TOKEN_ENCRYPTION_KEY: '',
});
const { settleReviews } = await import('../src/core/onboarding/review.js');
const { drainOutbox } = await import('../src/notify/outbox.js');
const db = h.db;
after(async () => {
  await settleReviews();
  await h.stop();
});

test('no encryption key: not offered, refused with 503, nothing stored, request completes', async () => {
  const c = h.client();
  const cfg = await c.ok('GET', '/onboarding/config');
  assert.equal(cfg.documents.enabled, false);
  let token = '';
  const call = async (method, url, body) => {
    const r = await c.call(method, `/onboarding${url}`, body, token ? { 'X-Registration-Token': token } : {});
    if (r.data?.registration_token) token = r.data.registration_token;
    return r;
  };
  const email = 'nokey@example.com';
  const s = await call('POST', '/start', {
    email, full_name: 'No Key', onboarding_role: 'INTERN', adult_confirmed: true, consent_accepted: true, consent_version: cfg.consent.version,
    category_profile: { institution: 'VIT', degree: 'MCA', academic_year: 'postgraduate', internship_department: 'Data', internship_duration: 'not_decided', has_mentor: 'not_yet' },
    preferences: { platforms: ['academia'] },
  });
  assert.equal(s.status, 202, JSON.stringify(s.data));
  await drainOutbox();
  const [mail] = await db.query("SELECT text_body FROM email_outbox WHERE to_email = ? AND kind = 'onboarding_code'", [email]);
  assert.equal((await call('POST', '/verify', { code: mail.text_body.match(/\b(\d{6})\b/)[1] })).status, 200);
  const up = await call('POST', '/document', { kind: 'MARK_SHEET', file_name: 'm.pdf', data_base64: Buffer.from('%PDF-1.4 test file').toString('base64') });
  assert.equal(up.status, 503);
  assert.equal(up.data.details.code, 'DOCUMENTS_UNAVAILABLE');
  assert.equal((await db.query('SELECT id FROM registration_documents')).length, 0, 'never stored in the clear');
  assert.equal((await call('POST', '/complete', {})).status, 200);
});
