import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Enterprise onboarding (Use Case 007, Phase 3: six roles), over HTTP against a disposable database: each
// role end to end (verify → submit without a password → review → approve → existing invitation link →
// set password → sign in → orientation), role follow-ups, account-existence non-disclosure across the
// whole public flow, codes (expiry, durable attempts, lockout, resend invalidation, send caps), no account
// before approval, per-role grant limits and privilege-escalation refusal, atomic approval, reject /
// request-info / respond, AI fallbacks (model mocked), and secrets kept out of logs and model payloads.

const h = await startHarness('onboarding', {
  ONBOARDING_ENABLED: 'true', SELF_REGISTRATION_ENABLED: 'true', ONBOARDING_REVIEW_NOTIFY_EMAIL: 'reviews@example.com',
  ONBOARDING_IP_LIMIT_PER_HOUR: '1000',
});
const { setOnboardingLlm } = await import('../src/core/onboarding/ai.js');
const { settleReviews } = await import('../src/core/onboarding/review.js');
const { sweepOnboarding } = await import('../src/core/onboarding/service.js');
const { drainOutbox } = await import('../src/notify/outbox.js');
const { sendMail } = await import('../src/notify/mailer.js');
const db = h.db;
const NEW_PASSWORD = 'Chosen-after-approval-1';
let admin;

before(async () => {
  admin = await h.register('admin@example.com'); // first account: platform administrator (development)
});
after(async () => {
  await settleReviews();
  await h.stop();
});

const CASES = {
  INTERN: {
    category: 'INTERNSHIP_CANDIDATE',
    profile: { institution: 'Anna University', degree: 'B.E. Computer Science', academic_year: 'final_year', internship_department: 'Engineering', internship_duration: '3_to_6_months', has_mentor: 'yes', mentor_name: 'R. Kumar', start_month: '2026-12' },
    grant: ['learner', 'intern'],
  },
  ALUMNI: {
    category: 'ALUMNI_MEMBER',
    profile: { previous_designation: 'Intern', previous_team: 'Data', association_period: '2021 – 2022', completed_programme: 'yes', completion_year: 2022, current_designation: 'Data analyst', reconnect_interests: 'Mentoring current interns' },
    grant: ['learner', 'alumni'],
  },
  INDUSTRY_PARTNER: {
    category: 'INDUSTRY_PROFESSIONAL',
    org: 'Acme Robotics',
    profile: { designation: 'Head of Engineering', industry_sector: 'Manufacturing', partnership_nature: 'talent_and_hiring', collaboration_interests: 'Hiring interns', primary_contact: 'yes_me' },
    grant: ['learner'],
  },
  CEO: {
    category: 'EXECUTIVE_LEADER',
    org: 'Globex',
    profile: { official_designation: 'Chief Executive Officer', organization_size: '251_1000', responsibility_areas: 'Strategy and growth', access_request: 'Explore the innovation showcase' },
    grant: ['learner'],
  },
  VP: {
    category: 'EXECUTIVE_LEADER',
    org: 'Initech',
    profile: { functional_division: 'Engineering', official_designation: 'Vice President, Engineering', responsibility_areas: 'Platform teams', access_request: 'Learning programmes for my division' },
    grant: ['learner'],
  },
  DIRECTOR: {
    category: 'EXECUTIVE_LEADER',
    org: 'Umbrella',
    profile: { board_or_department: 'Board of Directors', official_designation: 'Non-Executive Director', responsibility_areas: 'Governance', access_request: 'Governance learning' },
    grant: ['learner'],
  },
};

let seq = 0;
const consent = async () => (await h.client().ok('GET', '/onboarding/config')).consent;
async function startBody(role, email, extra = {}) {
  const c = CASES[role];
  return {
    email, full_name: `Applicant ${++seq}`, onboarding_role: role, category_profile: c.profile, claimed_organization: c.org,
    preferences: { timezone: 'Asia/Kolkata', locale: 'en-IN', country_code: 'IN', platforms: ['academia', 'showcase'] },
    adult_confirmed: true, consent_accepted: true, consent_version: (await consent()).version, ...extra,
  };
}

/** An applicant: a client plus the current resume token (sent as the onboarding app would). */
function applicant() {
  const c = h.client();
  let token = '';
  const call = async (method, url, body) => {
    const r = await c.call(method, `/onboarding${url}`, body, token ? { 'X-Registration-Token': token } : {});
    if (r.data?.registration_token) token = r.data.registration_token;
    return r;
  };
  return { call, get token() { return token; }, set token(t) { token = t; } };
}

async function latestEmail(to, kind) {
  await drainOutbox();
  const [row] = await db.query('SELECT * FROM email_outbox WHERE to_email = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [to, kind]);
  return row || null;
}
const codeFor = async (email) => (await latestEmail(email, 'onboarding_code')).text_body.match(/\b(\d{6})\b/)[1];
const requestOf = async (email) => (await db.query('SELECT * FROM registration_requests WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [email]))[0];
const users = async (email) => db.query('SELECT * FROM users WHERE email = ?', [email]);
const approveBody = (role, roles = CASES[role].grant.slice(0, 1)) => ({ onboarding_role: role, roles: roles.map((r) => ({ role: r, scope_type: 'platform' })), confirm: true });

async function submitted(role, email, extra) {
  const a = applicant();
  const s = await a.call('POST', '/start', await startBody(role, email, extra));
  assert.equal(s.status, 202, JSON.stringify(s.data));
  const v = await a.call('POST', '/verify', { code: await codeFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const done = await a.call('POST', '/complete', {});
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return { a, row: await requestOf(email) };
}

test('config: flags default off; exactly the six roles are public; no grants or reviewer notes leak', async () => {
  const c = h.client();
  process.env.ONBOARDING_ENABLED = 'false';
  try {
    assert.equal((await c.ok('GET', '/onboarding/config')).enabled, false);
    assert.equal((await c.call('POST', '/onboarding/start', {})).status, 404);
    assert.equal((await c.ok('GET', '/config')).onboarding_enabled, false);
  } finally {
    process.env.ONBOARDING_ENABLED = 'true';
  }
  const cfg = await c.ok('GET', '/onboarding/config');
  assert.equal(cfg.enabled, true);
  assert.match(cfg.consent.text, /^DRAFT/);
  assert.deepEqual(cfg.roles.map((r) => r.code), ['INTERN', 'ALUMNI', 'INDUSTRY_PARTNER', 'CEO', 'VP', 'DIRECTOR']);
  assert.ok(!('categories' in cfg), 'no Student or legacy category in the public catalogue');
  for (const r of cfg.roles) {
    assert.ok(!('grants' in r) && !('verify' in r) && !('category' in r), `${r.code}: internal policy stays on the server`);
    for (const f of r.fields) assert.doesNotMatch(f.key, /phone|mobile|address|password|token/i, `${r.code}.${f.key} collects nothing forbidden`);
  }
});

test('production refuses to enable onboarding without an approved consent notice and code secret', async () => {
  const { onboardingConfig } = await import('../src/core/onboarding/config.js');
  const base = { NODE_ENV: 'production', ONBOARDING_ENABLED: 'true', SELF_REGISTRATION_ENABLED: 'true', PUBLIC_BASE_URL: 'https://apex.example.com' };
  assert.equal(onboardingConfig(base).enabled, false);
  assert.match(onboardingConfig(base).blocked, /consent/);
  const secret = 'x'.repeat(40);
  const approved = { ...base, REGISTRATION_CODE_SECRET: secret, ONBOARDING_CONSENT_VERSION: 'v1-2027-01', ONBOARDING_CONSENT_URL: 'https://apex.example.com/privacy' };
  assert.equal(onboardingConfig(approved).enabled, true);
  assert.equal(onboardingConfig({ ...approved, ONBOARDING_CONSENT_VERSION: 'draft-x' }).enabled, false, 'a draft version is never approved');
});

test('start validates: a role is required, Student is not a role, unknown and forbidden fields are refused, adults only, consent', async () => {
  const a = applicant();
  const noRole = await a.call('POST', '/start', { ...(await startBody('CEO', 'x1@example.com')), onboarding_role: undefined });
  assert.equal(noRole.status, 400);
  assert.ok(noRole.data.details.fields.onboarding_role);
  assert.equal((await a.call('POST', '/start', { ...(await startBody('CEO', 'x1@example.com')), onboarding_role: 'STUDENT_LEARNER' })).status, 400);
  const phone = await a.call('POST', '/start', { ...(await startBody('VP', 'x1@example.com')), category_profile: { ...CASES.VP.profile, phone: '+91 98765 43210' } });
  assert.equal(phone.status, 400);
  assert.ok(phone.data.details.fields.phone, 'a phone number is refused');
  const minor = await a.call('POST', '/start', { ...(await startBody('INTERN', 'kid@example.com')), adult_confirmed: false });
  assert.ok(minor.data.details.fields.adult_confirmed);
  assert.equal((await a.call('POST', '/start', { ...(await startBody('INTERN', 'kid@example.com')), consent_version: 'other' })).status, 400);
  assert.equal((await db.query('SELECT id FROM registration_requests WHERE email IN (?, ?)', ['x1@example.com', 'kid@example.com'])).length, 0);
});

test('role follow-ups: asked only when an earlier answer calls for them', async () => {
  const { validateRoleProfile, missingForRoleSubmission } = await import('@academy/shared');
  const intern = { ...CASES.INTERN.profile, has_mentor: 'yes' };
  delete intern.mentor_name;
  assert.ok(validateRoleProfile('INTERN', intern).missing.includes('mentor_name'), 'mentor name required once a mentor is assigned');
  const noMentor = validateRoleProfile('INTERN', { ...CASES.INTERN.profile, has_mentor: 'not_yet' });
  assert.equal(noMentor.value.mentor_name, undefined, 'a follow-up that no longer applies is dropped');
  assert.ok(validateRoleProfile('INDUSTRY_PARTNER', { ...CASES.INDUSTRY_PARTNER.profile, partnership_nature: 'other' }).missing.includes('partnership_other'));
  assert.ok(validateRoleProfile('INDUSTRY_PARTNER', { ...CASES.INDUSTRY_PARTNER.profile, primary_contact: 'someone_else' }).missing.includes('primary_contact_name'));
  assert.ok(validateRoleProfile('ALUMNI', { ...CASES.ALUMNI.profile, completion_year: undefined }).missing.includes('completion_year'));
  assert.deepEqual(missingForRoleSubmission({ onboarding_role: 'DIRECTOR', category_profile: {}, claimed_organization: '' }).slice(0, 1), ['claimed_organization']);
});

for (const role of Object.keys(CASES)) {
  test(`${role}: verify, submit without a password, review, approve, invitation link, set password, sign in, orientation`, async () => {
    const email = `${role.toLowerCase()}@example.org`;
    const { a, row } = await submitted(role, email);
    assert.equal(row.status, 'PENDING_APPROVAL');
    assert.equal(row.primary_category_code, CASES[role].category, 'role mapped onto the existing category codes');
    assert.equal(JSON.parse(row.category_profile).onboarding_role, role);
    assert.equal((await users(email)).length, 0, 'no account before approval');
    assert.equal((await a.call('GET', '/status')).data.state, 'PENDING_APPROVAL');
    assert.ok(await latestEmail('reviews@example.com', 'onboarding_review_needed'), 'configured reviewer destination notified');

    const list = await admin.ok('GET', `/core/registrations?role=${role}`);
    assert.ok(list.some((r) => r.id === row.id && r.onboarding_role === role), 'filter by role');
    assert.ok(list.every((r) => r.onboarding_role === role));
    const detail = await admin.ok('GET', `/core/registrations/${row.id}`);
    for (const secret of ['credential_hash', 'code_digest', 'resume_token_hash', 'respond_token_hash']) assert.ok(!(secret in detail), secret);
    assert.equal(detail.requested.onboarding_role, role);
    assert.equal(detail.verification.email_verified, true);
    assert.equal(detail.verification.affiliation_verified, false);
    assert.ok(detail.verification_note, 'what to verify for this role');
    assert.deepEqual(detail.grantable_roles, CASES[role].grant, 'only the roles this onboarding role allows');
    assert.deepEqual(detail.default_roles, ['learner']);
    assert.deepEqual(detail.requested.platforms, ['showcase', 'academia'], 'requested platforms, in catalogue order');
    assert.equal(detail.advice.suggested_role_code, 'learner');
    assert.ok(detail.advice.observations.some((o) => o.code === 'CATEGORY_POLICY'));

    const ok = await admin.ok('POST', `/core/registrations/${row.id}/approve`, approveBody(role, CASES[role].grant));
    assert.equal(ok.status, 'APPROVED');
    assert.equal(ok.invitation_sent, true);
    const [user] = await users(email);
    assert.equal(user.role, 'user');
    assert.equal(user.audience, 'external');
    const held = await db.query('SELECT role, scope_type FROM role_assignments WHERE user_id = ? AND valid_to IS NULL', [user.id]);
    assert.deepEqual(held.map((x) => x.role).sort(), [...CASES[role].grant].sort());
    assert.ok(held.every((x) => x.scope_type === 'platform'));
    const closed = await requestOf(email);
    for (const c of ['credential_hash', 'code_digest', 'resume_token_hash', 'respond_token_hash']) assert.equal(closed[c], null, c);

    // No password was ever collected: nothing signs in until the invitation link sets one.
    const guess = h.client();
    assert.equal((await guess.call('POST', '/auth/login', { email, password: 'Applicant-pass-123' })).status, 401);
    const invite = await latestEmail(email, 'invite');
    assert.ok(invite, 'the existing invitation email');
    const link = invite.text_body.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
    assert.ok(link, 'with its set-password link');
    // Each role's applicant is a different client address, as in real use (the existing reset limiter is per address).
    const from = { 'X-Forwarded-For': `10.0.0.${Object.keys(CASES).indexOf(role) + 10}` };
    await h.client().ok('POST', '/auth/reset-password', { resetToken: link[1], newPassword: NEW_PASSWORD }, from);
    assert.equal((await h.client().call('POST', '/auth/reset-password', { resetToken: link[1], newPassword: NEW_PASSWORD }, from)).status, 400, 'the link works once');

    const me = h.client();
    await me.ok('POST', '/auth/login', { email, password: NEW_PASSWORD });
    const { orientation } = await me.ok('GET', '/onboarding/orientation');
    assert.equal(orientation.category_code, CASES[role].category);
    assert.ok(orientation.steps.some((s) => s.id === 'profile'));
    const coreMe = await me.ok('GET', '/core/me');
    assert.ok(coreMe.roles.every((r) => !/admin|staff|assessor/.test(r.role)));
    assert.deepEqual(coreMe.platforms, ['showcase', 'academia'], 'APEX home shows the platforms asked for (approver kept them)');
  });
}

test('password chosen at onboarding: validated, stored only as a hash, works after approval without an invitation', async () => {
  const short = await applicant().call('POST', '/start', await startBody('DIRECTOR', 'chooser@example.org', { password: 'short' }));
  assert.equal(short.status, 400);
  assert.ok(short.data.details.fields.password, 'the account password rules apply');
  const mismatch = await applicant().call('POST', '/start', await startBody('DIRECTOR', 'chooser@example.org', { password: 'Chosen-pass-2026', password_confirmation: 'Other-pass-2026' }));
  assert.ok(mismatch.data.details.fields.password_confirmation);

  const { row } = await submitted('DIRECTOR', 'chooser@example.org', { password: 'Chosen-pass-2026', password_confirmation: 'Chosen-pass-2026' });
  assert.match(row.credential_hash, /^scrypt\$/, 'stored as a hash');
  assert.doesNotMatch(row.credential_hash, /Chosen-pass-2026/);
  const [started] = await db.query("SELECT detail FROM audit_events WHERE action = 'registration.started' AND target_id = ?", [row.id]);
  assert.doesNotMatch(String(started.detail), /Chosen-pass/, 'the password never reaches the audit log');
  assert.equal((await h.client().call('POST', '/auth/login', { email: 'chooser@example.org', password: 'Chosen-pass-2026' })).status, 401, 'no sign-in before approval');

  const ok = await admin.ok('POST', `/core/registrations/${row.id}/approve`, approveBody('DIRECTOR'));
  assert.equal(ok.password_chosen, true);
  assert.equal(ok.invitation_sent, false);
  assert.ok(await latestEmail('chooser@example.org', 'onboarding_approved'), '"approved, sign in" email');
  assert.equal(await latestEmail('chooser@example.org', 'invite'), null, 'no set-password link');
  assert.equal((await db.query('SELECT 1 FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = ?', ['chooser@example.org'])).length, 0);
  const me = h.client();
  await me.ok('POST', '/auth/login', { email: 'chooser@example.org', password: 'Chosen-pass-2026' }, { 'X-Forwarded-For': '10.0.1.7' });
  assert.equal((await requestOf('chooser@example.org')).credential_hash, null, 'the hash is cleared from the request once used');
});

test('APEX platforms: asked at onboarding, required to submit, confirmed or changed by the approver', async () => {
  const a = applicant();
  const bad = await a.call('POST', '/start', await startBody('VP', 'plat0@example.org', { preferences: { platforms: ['dropbox'] } }));
  assert.equal(bad.status, 400);
  assert.ok(bad.data.details.fields['preferences.platforms'], 'only known platforms');

  // Submitting without choosing a platform is refused with a field message.
  const b = applicant();
  assert.equal((await b.call('POST', '/start', await startBody('VP', 'plat1@example.org', { preferences: { timezone: 'Asia/Kolkata' } }))).status, 202);
  await b.call('POST', '/verify', { code: await codeFor('plat1@example.org') });
  const none = await b.call('POST', '/complete', {});
  assert.equal(none.status, 400);
  assert.ok(none.data.details.fields.platforms);

  // The approver can narrow the list; an empty list is refused.
  const { row } = await submitted('VP', 'plat2@example.org');
  const url = `/core/registrations/${row.id}/approve`;
  assert.equal((await admin.call('POST', url, { ...approveBody('VP'), platforms: [] })).status, 400);
  assert.equal((await admin.call('POST', url, { ...approveBody('VP'), platforms: ['nope'] })).status, 400);
  const ok = await admin.ok('POST', url, { ...approveBody('VP'), platforms: ['slidesvault'] });
  assert.deepEqual(ok.platforms, ['slidesvault']);
  const [user] = await users('plat2@example.org');
  const { userPlatforms } = await import('../src/core/platforms.js');
  assert.deepEqual(await userPlatforms(db, user.id), ['slidesvault']);
  const [audit] = await db.query("SELECT detail FROM audit_events WHERE action = 'registration.approved' AND target_id = ?", [row.id]);
  const detail = typeof audit.detail === 'string' ? JSON.parse(audit.detail) : audit.detail;
  assert.deepEqual([detail.requested_platforms, detail.platforms], [['showcase', 'academia'], ['slidesvault']], 'request and decision both audited');
  // An administrator without a setting sees everything (null).
  assert.equal((await admin.ok('GET', '/core/me')).platforms, null);
});

test('privilege escalation is refused: per-role grants, no administrator role, no organisation, explicit confirmation', async () => {
  const { row } = await submitted('CEO', 'ceo2@example.net');
  const url = `/core/registrations/${row.id}/approve`;
  for (const r of ['intern', 'alumni', 'mentor', 'student', 'platform_admin', 'org_admin', 'staff', 'assessor']) {
    assert.equal((await admin.call('POST', url, approveBody('CEO', [r]))).status, 403, `CEO cannot receive ${r}`);
  }
  assert.equal((await admin.call('POST', url, { ...approveBody('CEO'), roles: [{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }] })).status, 403);
  assert.equal((await admin.call('POST', url, { ...approveBody('CEO'), organization_id: 'x' })).status, 400);
  assert.equal((await admin.call('POST', url, { ...approveBody('CEO'), confirm: false })).status, 400);
  assert.equal((await admin.call('POST', url, { ...approveBody('CEO'), onboarding_role: 'STUDENT_LEARNER' })).status, 400);

  const { row: alum } = await submitted('ALUMNI', 'alum2@example.net');
  assert.equal((await admin.call('POST', `/core/registrations/${alum.id}/approve`, approveBody('ALUMNI', ['intern']))).status, 403, 'Alumni cannot receive intern');

  const learner = await h.invite(admin, 'plain@example.com');
  assert.equal((await learner.call('GET', '/core/registrations')).status, 403);
  assert.equal((await learner.call('GET', `/core/registrations/${row.id}`)).status, 403);
  assert.equal((await learner.call('POST', url, approveBody('CEO'))).status, 403);

  const results = await Promise.all([admin.call('POST', url, approveBody('CEO')), admin.call('POST', url, approveBody('CEO')), admin.call('POST', url, approveBody('CEO'))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await users('ceo2@example.net')).length, 1, 'exactly one account');
  const [u] = await users('ceo2@example.net');
  assert.equal((await db.query('SELECT id FROM role_assignments WHERE user_id = ?', [u.id])).length, 1);
});

test('a password is never accepted at submission (only at start); duplicate email never merges', async () => {
  const a = applicant();
  await a.call('POST', '/start', await startBody('VP', 'pw@example.net'));
  await a.call('POST', '/verify', { code: await codeFor('pw@example.net') });
  const pw = await a.call('POST', '/complete', { password: 'Some-password-1' });
  assert.equal(pw.status, 400);
  assert.match(pw.data.error, /first step/);

  const { row } = await submitted('ALUMNI', 'race@example.net');
  await admin.ok('POST', '/auth/invite', { email: 'race@example.net' });
  const r = await admin.call('POST', `/core/registrations/${row.id}/approve`, approveBody('ALUMNI'));
  assert.equal(r.data.details.code, 'ACCOUNT_EXISTS');
  assert.equal((await requestOf('race@example.net')).status, 'PENDING_APPROVAL');
});

test('existing, pending and new addresses look the same across start, status, resend, verify and update', async () => {
  await submitted('ALUMNI', 'pending@example.net');
  const flows = {};
  for (const [label, email] of [['new', 'fresh@example.net'], ['existing', 'admin@example.com'], ['pending', 'pending@example.net']]) {
    const a = applicant();
    const s = await a.call('POST', '/start', await startBody('INTERN', email));
    const st = await a.call('GET', '/status');
    const r1 = await a.call('POST', '/resend');
    const v = await a.call('POST', '/verify', { code: '000000' === (await latestEmail(email, 'onboarding_code'))?.text_body?.match(/\b(\d{6})\b/)?.[1] ? '111111' : '000000' });
    const upd = await a.call('POST', '/update', { full_name: 'X' });
    flows[label] = { a, s, st, r1, v, upd };
  }
  const shape = (r) => ({ status: r.status, keys: Object.keys(r.data || {}).sort(), code: r.data?.details?.code, message: r.data?.message || r.data?.error });
  for (const step of ['s', 'st', 'r1', 'v', 'upd']) {
    assert.deepEqual(shape(flows.existing[step]), shape(flows.new[step]), `existing vs new: ${step}`);
    assert.deepEqual(shape(flows.pending[step]), shape(flows.new[step]), `pending vs new: ${step}`);
  }
  assert.equal(await latestEmail('admin@example.com', 'onboarding_code'), null);
  assert.ok(await latestEmail('admin@example.com', 'onboarding_existing_account'));
  assert.ok(await latestEmail('pending@example.net', 'onboarding_already_pending'));
  assert.equal((await requestOf('pending@example.net')).status, 'PENDING_APPROVAL');
  assert.equal((await flows.existing.a.call('POST', '/complete', {})).data.details.code, 'VERIFY_FIRST');
});

test('codes: wrong guesses are durable, resend never resets them, lockout, expiry, invalidation, send cap', async () => {
  const email = 'codes@example.net';
  const a = applicant();
  await a.call('POST', '/start', await startBody('INTERN', email));
  const first = await codeFor(email);
  const wrong = first === '123456' ? '654321' : '123456';
  for (let i = 4; i >= 2; i -= 1) assert.equal((await a.call('POST', '/verify', { code: wrong })).data.details.attempts_remaining, i);
  assert.equal((await a.call('POST', '/resend')).data.details.code, 'TOO_SOON');
  await db.run("UPDATE registration_requests SET last_code_sent_at = '2000-01-01T00:00:00.000Z' WHERE email = ?", [email]);
  const re = await a.call('POST', '/resend');
  assert.equal(re.data.attempts_remaining, 2, 'resend keeps the failed-attempt budget');
  const second = await codeFor(email);
  if (second !== first) assert.equal((await a.call('POST', '/verify', { code: first })).data.details.code, 'WRONG_CODE', 'old generation invalid');
  else await a.call('POST', '/verify', { code: wrong });
  assert.equal((await requestOf(email)).failed_attempts, 4, 'failures are stored durably');
  await a.call('POST', '/verify', { code: wrong });
  assert.equal((await a.call('POST', '/verify', { code: second })).data.details.code, 'LOCKED');

  const b = applicant();
  await b.call('POST', '/start', await startBody('INTERN', 'expiry@example.net'));
  await db.run("UPDATE registration_requests SET code_expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'expiry@example.net'");
  assert.equal((await b.call('POST', '/verify', { code: await codeFor('expiry@example.net') })).status, 410);

  const c = applicant();
  await c.call('POST', '/start', await startBody('INTERN', 'cap@example.net'));
  for (let i = 0; i < 4; i += 1) {
    await db.run("UPDATE registration_requests SET last_code_sent_at = '2000-01-01T00:00:00.000Z' WHERE email = 'cap@example.net'");
    assert.equal((await c.call('POST', '/resend')).status, 202);
  }
  await db.run("UPDATE registration_requests SET last_code_sent_at = '2000-01-01T00:00:00.000Z' WHERE email = 'cap@example.net'");
  assert.equal((await c.call('POST', '/resend')).data.details.code, 'SEND_LIMIT');
});

test('conversation state: steps cannot be skipped, tokens rotate, resume, role edits before submission, email change starts over', async () => {
  const email = 'steps@example.net';
  const a = applicant();
  await a.call('POST', '/start', await startBody('INTERN', email));
  assert.equal((await a.call('POST', '/complete', {})).data.details.code, 'VERIFY_FIRST');
  const startToken = a.token;
  await a.call('POST', '/verify', { code: await codeFor(email) });
  assert.notEqual(a.token, startToken, 'token rotated at verification');
  const stale = applicant();
  stale.token = startToken;
  assert.equal((await stale.call('GET', '/status')).status, 401);
  const resumed = await a.call('GET', '/status');
  assert.equal(resumed.data.state, 'EMAIL_VERIFIED', 'resume where the person left off');
  assert.equal(resumed.data.draft.onboarding_role, 'INTERN');

  assert.equal((await a.call('POST', '/update', { email: 'other@example.net' })).data.details.code, 'EMAIL_CHANGE_RESTARTS');
  const edited = await a.call('POST', '/update', { onboarding_role: 'VP', category_profile: CASES.VP.profile, claimed_organization: 'Initech' });
  assert.equal(edited.data.draft.onboarding_role, 'VP', 'role corrected before submission');
  assert.equal(edited.data.draft.primary_category_code, 'EXECUTIVE_LEADER');
  await a.call('POST', '/update', { category_profile: { ...CASES.VP.profile, access_request: '' } });
  assert.equal((await a.call('POST', '/complete', {})).status, 400, 'required fields enforced at submission');

  const restart = await a.call('POST', '/start', { ...(await startBody('VP', 'steps2@example.net')), previous_token: a.token });
  assert.equal(restart.status, 202);
  assert.equal((await requestOf(email)).status, 'SUPERSEDED');
});

test('request-info, response link, respond, role correction at approval, and reject', async () => {
  const email = 'info@example.net';
  const { a, row } = await submitted('INDUSTRY_PARTNER', email);
  assert.equal((await admin.call('POST', `/core/registrations/${row.id}/reject`, { reason: '' })).status, 400, 'a reason is required');
  await admin.ok('POST', `/core/registrations/${row.id}/request-info`, { question: 'Which team would join?', note: 'internal: check with sales' });
  assert.equal((await a.call('GET', '/status')).data.state, 'INFO_REQUESTED');
  const mail = await latestEmail(email, 'onboarding_info_requested');
  const respondToken = decodeURIComponent(mail.text_body.match(/respond=([^\s]+)/)[1]);
  const b = applicant();
  const ex = await b.call('POST', '/exchange', { token: respondToken });
  assert.equal(ex.data.info_request, 'Which team would join?');
  assert.ok(!JSON.stringify(ex.data).includes('internal'), 'internal notes never reach the applicant');
  assert.equal((await b.call('POST', '/respond', { response: 'The platform team.' })).data.state, 'PENDING_APPROVAL');

  const { row: other } = await submitted('CEO', 'corr@example.net');
  await admin.ok('POST', `/core/registrations/${other.id}/approve`, approveBody('VP'));
  const audit = await admin.ok('GET', `/core/audit-events?target_id=${other.id}`);
  assert.ok(audit.some((e) => e.action === 'registration.role_corrected' && e.detail.from === 'CEO' && e.detail.to === 'VP'));

  await admin.ok('POST', `/core/registrations/${row.id}/reject`, { reason: 'Not a fit for the pilot', message: 'You are welcome to apply again.' });
  const closed = await requestOf(email);
  assert.equal(closed.status, 'REJECTED');
  assert.equal((await users(email)).length, 0);
  const rejected = await latestEmail(email, 'onboarding_rejected');
  assert.match(rejected.text_body, /apply again/);
  assert.ok(!rejected.text_body.includes('pilot'), 'the internal reason stays internal');
});

test('AI: review advice falls back, validates each field, ignores injected instructions, never sees secrets', async () => {
  process.env.ONBOARDING_AI_ENABLED = 'true';
  process.env.ONBOARDING_AI_TIMEOUT_MS = '1000';
  const payloads = [];
  try {
    for (const fn of [async () => 'not json', async () => { throw new Error('provider down'); }, () => new Promise(() => {})]) {
      setOnboardingLlm(fn);
      const { row } = await submitted('DIRECTOR', `aifail${++seq}@example.net`);
      await settleReviews();
      assert.equal((await admin.ok('GET', `/core/registrations/${row.id}`)).advice.source, 'rules', 'no AI, malformed, failing or slow: rules');
    }
    setOnboardingLlm(async (req) => {
      payloads.push(JSON.stringify(req));
      return {
        summary: 'Executive wants admin access.', suggested_category_code: 'EXECUTIVE_LEADER', suggested_role_code: 'platform_admin',
        suggested_organization_id: 'org-123', suggested_resource_ids: ['secret-project'], onboarding_path_code: 'NOT_A_PATH', observations: ['Title is unverified.'],
      };
    });
    const { row } = await submitted('CEO', 'aiexec@example.net', { full_name: 'Zebulon Quixote' });
    await settleReviews();
    const d = await admin.ok('GET', `/core/registrations/${row.id}`);
    assert.equal(d.advice.source, 'ai');
    assert.equal(d.advice.suggested_role_code, 'learner', 'platform_admin refused');
    assert.equal(d.advice.suggested_organization_id, null);
    assert.deepEqual(d.advice.suggested_resource_ids, []);
    assert.ok(d.advice.observations.some((o) => o.code === 'CATEGORY_POLICY'), 'mandatory rules observations kept');
    const sent = payloads.at(-1);
    for (const secret of ['Zebulon', 'aiexec@example.net']) assert.ok(!sent.includes(secret), `${secret} not sent to the model`);
  } finally {
    setOnboardingLlm(null);
    process.env.ONBOARDING_AI_ENABLED = 'false';
  }
});

test('secrets never reach the logs; the development code switch is opt-in and never in production; the sweep works', async () => {
  const lines = [];
  const saved = [console.log, console.error];
  console.log = (s) => lines.push(String(s));
  console.error = (s) => lines.push(String(s));
  let code;
  let token;
  try {
    const a = applicant();
    await a.call('POST', '/start', await startBody('INTERN', 'logs@example.net'));
    token = a.token;
    code = await codeFor('logs@example.net');
    await a.call('POST', '/verify', { code });
    await a.call('POST', '/complete', {});
    await drainOutbox();
    for (const [env, show] of [[{}, false], [{ ONBOARDING_DEV_LOG_CODES: 'true' }, true], [{ ONBOARDING_DEV_LOG_CODES: 'true', NODE_ENV: 'production' }, false]]) {
      const before = { ...process.env };
      Object.assign(process.env, env);
      lines.length = 0;
      await sendMail({ to: 't@example.net', subject: 's', text: 'code 424242', kind: 'onboarding_code' });
      process.env.NODE_ENV = before.NODE_ENV;
      process.env.ONBOARDING_DEV_LOG_CODES = before.ONBOARDING_DEV_LOG_CODES || '';
      assert.equal(lines.join('').includes('424242'), show, JSON.stringify(env));
    }
  } finally {
    [console.log, console.error] = saved;
  }
  assert.ok(!lines.join('\n').includes(code) && !lines.join('\n').includes(token));

  await db.run("UPDATE registration_requests SET created_at = '2000-01-01T00:00:00.000Z' WHERE email = 'cap@example.net'");
  const out = await sweepOnboarding(db);
  assert.ok(out.expired >= 1);
  assert.equal((await requestOf('cap@example.net')).status, 'EXPIRED');
});
