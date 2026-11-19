import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Optional intern mark sheet on an access request (migration 012), over HTTP against a disposable
// database: offered only to roles that list it and only when it can be encrypted; attached only to a
// verified draft; type proven by content; size capped; encrypted at rest with a checksum; replace, remove,
// dropped on a role change and when a draft closes unsubmitted; shown to reviewers only, every download
// audited; included in key rotation; and the 012 rollback.

const KEY = crypto.randomBytes(32).toString('base64');
const h = await startHarness('onboarding-docs', {
  ONBOARDING_ENABLED: 'true', SELF_REGISTRATION_ENABLED: 'true', ONBOARDING_IP_LIMIT_PER_HOUR: '1000', TOKEN_ENCRYPTION_KEY: KEY,
});
const { settleReviews } = await import('../src/core/onboarding/review.js');
const { sweepOnboarding } = await import('../src/core/onboarding/service.js');
const { readDocument } = await import('../src/core/onboarding/documents.js');
const { rollbackRegistrationDocuments } = await import('../src/core/index.js');
const { rewrapStoredSecrets } = await import('../src/lib/rewrapSecrets.js');
const { encrypt, parseKey } = await import('../src/lib/crypto.js');
const { drainOutbox } = await import('../src/notify/outbox.js');
const { cleanFileName, sniffDocumentType, ONBOARDING_DOCUMENT_MAX_BYTES } = await import('@academy/shared');
const db = h.db;
let admin;
let member;

before(async () => {
  admin = await h.register('admin@example.com'); // first account: platform administrator (development)
  member = await h.register('member@example.com'); // an ordinary account
});
after(async () => {
  await settleReviews();
  await h.stop();
});

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(2000), Buffer.from('\n%%EOF\n')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
const b64 = (buf) => buf.toString('base64');

const PROFILES = {
  INTERN: { institution: 'Anna University', degree: 'B.E. Computer Science', academic_year: 'final_year', internship_department: 'Engineering', internship_duration: '3_to_6_months', has_mentor: 'not_yet' },
  ALUMNI: { previous_designation: 'Intern', previous_team: 'Data', association_period: '2021 – 2022', completed_programme: 'no', current_designation: 'Analyst', reconnect_interests: 'Mentoring' },
};
let seq = 0;
async function startBody(role, email) {
  const consent = (await h.client().ok('GET', '/onboarding/config')).consent;
  return {
    email, full_name: `Applicant ${++seq}`, onboarding_role: role, category_profile: PROFILES[role],
    preferences: { timezone: 'Asia/Kolkata', platforms: ['academia'] }, adult_confirmed: true, consent_accepted: true, consent_version: consent.version,
  };
}
function applicant() {
  const c = h.client();
  let token = '';
  const call = async (method, url, body) => {
    const r = await c.call(method, `/onboarding${url}`, body, token ? { 'X-Registration-Token': token } : {});
    if (r.data?.registration_token) token = r.data.registration_token;
    return r;
  };
  return { call };
}
async function codeFor(email) {
  await drainOutbox();
  const [row] = await db.query("SELECT text_body FROM email_outbox WHERE to_email = ? AND kind = 'onboarding_code' ORDER BY created_at DESC, rowid DESC LIMIT 1", [email]);
  return row.text_body.match(/\b(\d{6})\b/)[1];
}
const requestOf = async (email) => (await db.query('SELECT * FROM registration_requests WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [email]))[0];
const docsOf = async (id) => db.query('SELECT * FROM registration_documents WHERE request_id = ?', [id]);

async function verified(role, email) {
  const a = applicant();
  assert.equal((await a.call('POST', '/start', await startBody(role, email))).status, 202);
  const v = await a.call('POST', '/verify', { code: await codeFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return a;
}
const attach = (a, buf, name = 'semester-6.pdf', kind = 'MARK_SHEET') => a.call('POST', '/document', { kind, file_name: name, data_base64: b64(buf) });

test('shared: the type is proven by content, and file names are cleaned for display and headers', () => {
  assert.equal(sniffDocumentType(PDF), 'application/pdf');
  assert.equal(sniffDocumentType(PNG), 'image/png');
  assert.equal(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffDocumentType(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(cleanFileName('C:\\Users\\me\\Mark Sheet.PDF', 'application/pdf'), 'Mark Sheet.pdf');
  assert.equal(cleanFileName('../../etc/passwd', 'image/png'), 'passwd.png');
  assert.equal(cleanFileName('a"b;\r\nc.exe', 'application/pdf'), 'abc.pdf', 'header-breaking characters removed, real type wins');
  assert.equal(cleanFileName('', 'image/jpeg'), 'mark-sheet.jpg');
  assert.ok(cleanFileName('x'.repeat(500), 'application/pdf').length <= 120);
});

test('config: the mark sheet is offered to interns only (see onboardingDocumentsNoKey.test.js without a key)', async () => {
  const c = h.client();
  const cfg = await c.ok('GET', '/onboarding/config');
  assert.equal(cfg.documents.enabled, true);
  assert.equal(cfg.documents.max_bytes, ONBOARDING_DOCUMENT_MAX_BYTES);
  assert.deepEqual(cfg.documents.types.map((t) => t.content_type), ['application/pdf', 'image/jpeg', 'image/png']);
  for (const r of cfg.roles) assert.deepEqual(r.documents, r.code === 'INTERN' ? ['MARK_SHEET'] : [], r.code);

});

test('intern: attach after verification, stored encrypted, optional at submit, reviewers download the exact file (audited)', async () => {
  const email = 'intern.docs@example.com';
  const a = await verified('INTERN', email);
  const up = await attach(a, PDF, 'Semester 6 "marks".pdf');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.documents.length, 1);
  assert.deepEqual({ ...up.data.documents[0], uploaded_at: 'x' }, { kind: 'MARK_SHEET', label: 'Mark sheet', file_name: 'Semester 6 marks.pdf', content_type: 'application/pdf', size_bytes: PDF.length, uploaded_at: 'x' });
  assert.ok(!('data_base64' in up.data.documents[0]) && !('content_encrypted' in up.data.documents[0]), 'metadata only');

  const row = await requestOf(email);
  const [stored] = await docsOf(row.id);
  assert.match(stored.content_encrypted, /^v1\./, 'AES-GCM envelope');
  assert.ok(!stored.content_encrypted.includes(b64(PDF).slice(0, 40)), 'not stored in the clear');
  assert.equal(stored.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  const audit = await db.query("SELECT detail FROM audit_events WHERE target_id = ? AND action = 'registration.document_attached'", [row.id]);
  assert.equal(audit.length, 1);
  assert.doesNotMatch(String(audit[0].detail), /Semester|marks|%PDF/, 'no file name or content in the audit');

  const st = await a.call('GET', '/status');
  assert.equal(st.data.documents[0].file_name, 'Semester 6 marks.pdf', 'a resumed draft sees what is attached');
  assert.equal((await a.call('POST', '/complete', {})).status, 200);
  assert.equal((await attach(a, PDF)).status, 409, 'nothing can be attached once submitted');

  const detail = await admin.ok('GET', `/core/registrations/${row.id}`);
  assert.equal(detail.documents.length, 1);
  assert.equal(detail.documents[0].size_bytes, PDF.length);
  assert.match(detail.verification_note, /mark sheet/);

  const url = `${h.base}/api/core/registrations/${row.id}/documents/MARK_SHEET`;
  const res = await fetch(url, { headers: { Cookie: admin.cookie } });
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF, 'the exact bytes');
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="Semester 6 marks\.pdf"/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const viewed = await db.query("SELECT actor_user_id FROM audit_events WHERE target_id = ? AND action = 'registration.document_viewed'", [row.id]);
  assert.equal(viewed.length, 1, 'every opening is audited');

  assert.equal((await fetch(url, { headers: { Cookie: member.cookie } })).status, 403, 'ordinary accounts cannot open it');
  assert.equal((await fetch(url)).status, 401, 'signed-out callers cannot open it');
  assert.equal((await fetch(`${h.base}/api/core/registrations/${row.id}/documents/OTHER`, { headers: { Cookie: admin.cookie } })).status, 404);
});

test('refused: before verification, other roles, unknown kinds, disguised or broken files, oversized files', async () => {
  const early = applicant();
  assert.equal((await early.call('POST', '/start', await startBody('INTERN', 'early@example.com'))).status, 202);
  const r0 = await attach(early, PDF);
  assert.equal(r0.status, 409);
  assert.equal(r0.data.details.code, 'VERIFY_FIRST');
  assert.equal((await attach(applicant(), PDF)).status, 401, 'no token: start again');

  const alum = await verified('ALUMNI', 'alum.docs@example.com');
  assert.ok((await attach(alum, PDF)).data.details.fields.kind, 'not asked for this role');

  const a = await verified('INTERN', 'refuse.docs@example.com');
  assert.ok((await attach(a, PDF, 'x.pdf', 'PASSPORT')).data.details.fields.kind);
  const fake = await attach(a, Buffer.from('<html><script>alert(1)</script></html>'), 'marks.pdf');
  assert.equal(fake.status, 400);
  assert.match(fake.data.details.fields.file, /PDF, JPG or PNG/, 'a renamed HTML file is refused by its content');
  assert.equal((await a.call('POST', '/document', { kind: 'MARK_SHEET', file_name: 'x.pdf', data_base64: 'not base64!' })).status, 400);
  assert.equal((await a.call('POST', '/document', { kind: 'MARK_SHEET', file_name: 'x.pdf', data_base64: '' })).status, 400);
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(ONBOARDING_DOCUMENT_MAX_BYTES)]);
  const tooBig = await attach(a, big);
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.data.details.fields.file, /larger than 5 MB/);
  assert.equal((await docsOf((await requestOf('refuse.docs@example.com')).id)).length, 0);
});

test('replace, remove, a role change and an unsubmitted draft all drop the file', async () => {
  const a = await verified('INTERN', 'change.docs@example.com');
  const id = (await requestOf('change.docs@example.com')).id;
  await attach(a, PDF);
  const replaced = await attach(a, PNG, 'scan.png');
  assert.equal(replaced.data.documents.length, 1, 'one per kind: a new upload replaces the old');
  assert.equal(replaced.data.documents[0].content_type, 'image/png');
  assert.equal((await docsOf(id)).length, 1);

  const removed = await a.call('POST', '/document', { kind: 'MARK_SHEET', action: 'remove' });
  assert.deepEqual(removed.data.documents, []);
  assert.equal((await docsOf(id)).length, 0);

  await attach(a, PDF);
  const moved = await a.call('POST', '/update', { onboarding_role: 'ALUMNI', category_profile: PROFILES.ALUMNI });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal((await docsOf(id)).length, 0, 'an alumnus keeps no intern mark sheet');

  const b = await verified('INTERN', 'stale.docs@example.com');
  await attach(b, PDF);
  const stale = await requestOf('stale.docs@example.com');
  await verified('INTERN', 'stale.docs@example.com'); // a new start supersedes the draft
  assert.equal((await db.query('SELECT status FROM registration_requests WHERE id = ?', [stale.id]))[0].status, 'SUPERSEDED');
  const swept = await sweepOnboarding(db);
  assert.ok(swept.documents_removed >= 1);
  assert.equal((await docsOf(stale.id)).length, 0, 'files of drafts never submitted are not kept');

  const c = await verified('INTERN', 'purge.docs@example.com');
  await attach(c, PDF);
  const purge = await requestOf('purge.docs@example.com');
  await db.run('DELETE FROM registration_requests WHERE id = ?', [purge.id]);
  assert.equal((await docsOf(purge.id)).length, 0, 'deleting a request deletes its file (cascade)');
});

test('key rotation: rewrap-secrets re-encrypts documents; a tampered file is never served', async () => {
  const a = await verified('INTERN', 'rotate.docs@example.com');
  await attach(a, PDF);
  const id = (await requestOf('rotate.docs@example.com')).id;
  const old = crypto.randomBytes(32);
  await db.run('UPDATE registration_documents SET content_encrypted = ? WHERE request_id = ?', [encrypt(b64(PDF), old), id]);
  const current = parseKey(KEY);
  const dry = await rewrapStoredSecrets(db, [current, old], { dryRun: true });
  assert.ok(dry.rewrapped >= 1);
  const done = await rewrapStoredSecrets(db, [current, old]);
  assert.ok(done.rewrapped >= 1 && done.failed.length === 0, JSON.stringify(done));
  assert.deepEqual((await readDocument(db, id, 'MARK_SHEET')).bytes, PDF, 'opens with the current key alone');
  assert.equal((await rewrapStoredSecrets(db, [current])).rewrapped, 0, 'nothing left under the old key');

  await db.run('UPDATE registration_documents SET sha256 = ? WHERE request_id = ?', ['0'.repeat(64), id]);
  await assert.rejects(readDocument(db, id, 'MARK_SHEET'), /checksum/);
});

test('rollback of 012 drops only the documents table and record; migrating again recreates it', async () => {
  const before = (await db.query('SELECT COUNT(*) AS n FROM registration_requests'))[0].n;
  const r = await rollbackRegistrationDocuments(db);
  assert.deepEqual(r, { tablesDropped: ['registration_documents'], recordsRemoved: 1 });
  await assert.rejects(db.query('SELECT 1 FROM registration_documents'));
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM registration_requests'))[0].n, before, 'access requests untouched');
  assert.equal((await rewrapStoredSecrets(db, [parseKey(KEY)])).failed.length, 0, 'rewrap still runs without the table');
  await h.migrate(db);
  assert.deepEqual(await db.query('SELECT id FROM registration_documents'), []);
  assert.equal((await db.query("SELECT id FROM schema_migrations WHERE id = '012_registration_documents'")).length, 1);
});
