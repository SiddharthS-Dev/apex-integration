// Stakeholder onboarding (Use Case 007, slice O1): the category catalogue, the interest allow-list, the
// request states and the profile validator. Shared by the Core API (which validates every request
// server-side) and the web/gateway UI (which may use it to shape forms). Imports nothing.
//
// Categories are profile data, never roles: nothing here grants access. The approver chooses roles
// explicitly at approval (docs/implementation/ONBOARDING_PLAN.md §2).
//
// Forbidden data is never asked for: no age or birth date (adults-only attestation is a boolean, DEC-015),
// no gender, nationality, religion, health, government ID, home address or phone. Unknown profile keys
// are refused, so a client cannot store extra data either. Links are untrusted text: syntax-checked,
// stored, shown as text, never fetched.

export const PROFILE_SCHEMA_VERSION = 1;

export const ONBOARDING_STATES = Object.freeze([
  'CODE_SENT', 'EMAIL_VERIFIED', 'PENDING_APPROVAL', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED',
]);
/** States in which a request is live (one per normalised email). */
export const ONBOARDING_OPEN_STATES = Object.freeze(['CODE_SENT', 'EMAIL_VERIFIED', 'PENDING_APPROVAL', 'INFO_REQUESTED']);
/** States an administrator can decide. */
export const ONBOARDING_REVIEWABLE_STATES = Object.freeze(['PENDING_APPROVAL', 'INFO_REQUESTED']);

export const ONBOARDING_LIMITS = Object.freeze({
  email: 254, fullName: 120, organization: 200, text: 200, longText: 1000, url: 500, interestOther: 200,
  infoQuestion: 2000, infoResponse: 2000, reason: 1000, maxInterests: 8,
});

const AVAILABLE = 'available';
const NOT_YET = 'not_yet';

const YEAR_OF_STUDY = ['first', 'second', 'third', 'fourth_or_later', 'postgraduate', 'other'];
const AVAILABILITY = ['immediately', 'within_3_months', 'within_6_months', 'later'];
const DURATION = ['up_to_3_months', '3_to_6_months', 'over_6_months', 'flexible'];
const EXPERIENCE = ['0_2', '3_5', '6_10', '11_20', 'over_20'];
const ORG_SIZE = ['1_50', '51_250', '251_1000', '1001_5000', 'over_5000'];
const ENGAGEMENT = ['briefing', 'partnership', 'talent', 'learning_programme', 'other'];

const text = (key, label, required = false, max = ONBOARDING_LIMITS.text) => ({ key, label, type: 'text', required, max });
const long = (key, label, required = false) => ({ key, label, type: 'longtext', required, max: ONBOARDING_LIMITS.longText });
const choice = (key, label, options, required = false) => ({ key, label, type: 'enum', required, options });
const url = (key, label) => ({ key, label, type: 'url', required: false, max: ONBOARDING_LIMITS.url });
const year = (key, label) => ({ key, label, type: 'year', required: false, min: 1950, max: 2100 });
const card = (code, title, description, availability = AVAILABLE) => ({ code, title, description, availability });
// Every category asks which purpose cards apply (at least one). Cards for modules that do not exist yet
// may be chosen: they record interest for the team and promise nothing.
const withPurposes = (cat) => ({
  ...cat,
  fields: [...cat.fields, { key: 'purposes', label: 'What would you like to do?', type: 'multi', required: true, options: cat.purposes.map((c) => c.code), max: 4 }],
});

/**
 * The five categories. `organization` says whether the top-level claimed_organization is required.
 * `default_roles` is the least-privileged proposal shown to the approver (plan §2); it is never applied
 * automatically. Purpose cards are truthful: modules that do not exist yet are marked not_yet.
 */
export const ONBOARDING_CATEGORIES = Object.freeze([
  {
    code: 'STUDENT_LEARNER',
    label: 'Student / Learner',
    description: 'You are studying, or learning on your own, and want structured courses.',
    organization: 'optional',
    fields: [
      text('institution', 'School, college or university', true),
      text('programme', 'Programme or subject', true),
      choice('year_of_study', 'Year of study', YEAR_OF_STUDY),
      year('expected_completion_year', 'Expected completion year'),
      long('learning_goal', 'What do you want to learn?', true),
      text('skills', 'Skills you already have', false, 500),
      url('portfolio_url', 'Portfolio or profile link'),
    ],
    purposes: [
      card('LEARN_COURSES', 'Take structured courses', 'Work through Learning Hub courses with lessons, quizzes and a final test.'),
      card('TRACK_PROGRESS', 'Track progress and certificates', 'See completed lessons and earn certificates for finished courses.'),
      card('SPACED_REVIEW', 'Practise with spaced review', 'Review key points with flashcards scheduled for you.'),
      card('APPLIED_PROJECTS', 'Applied projects', 'Hands-on project work is not available on the platform yet.', NOT_YET),
    ],
    default_roles: [{ role: 'student', scope_type: 'platform', scope_id: '' }, { role: 'learner', scope_type: 'platform', scope_id: '' }],
  },
  {
    code: 'INTERNSHIP_CANDIDATE',
    label: 'Internship candidate',
    description: 'You are interested in an internship with Inspironics.',
    organization: 'optional',
    fields: [
      text('institution_or_background', 'Institution or background', true),
      long('areas_of_interest', 'Areas you would like to work in', true),
      choice('availability', 'When could you start?', AVAILABILITY, true),
      choice('preferred_duration', 'Preferred duration', DURATION),
      text('skills', 'Skills you already have', false, 500),
      url('portfolio_url', 'Portfolio or profile link'),
    ],
    purposes: [
      card('PREPARE_COURSES', 'Prepare with Learning Hub courses', 'Build skills with the courses available to learners.'),
      card('INTERNSHIP_OFFERS', 'Internship opportunities', 'Internship offers are not handled on the platform yet; our team will contact you.', NOT_YET),
      card('MENTORING', 'Mentoring', 'Mentoring is not available on the platform yet.', NOT_YET),
    ],
    default_roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }],
  },
  {
    code: 'ALUMNI_MEMBER',
    label: 'Alumni',
    description: 'You studied or worked with Inspironics before.',
    organization: 'optional',
    fields: [
      text('alumni_relationship', 'Your earlier programme, cohort or team', true),
      year('cohort_year', 'Year you finished'),
      text('current_role', 'Current role', true),
      text('current_organization', 'Current organisation'),
      long('purpose', 'What would you like to do now?', true),
      url('profile_url', 'Professional profile link'),
    ],
    purposes: [
      card('CONTINUE_LEARNING', 'Keep learning', 'Take Learning Hub courses and refresh certificates.'),
      card('EXPLORE_SHOWCASE', 'Explore solutions', 'Browse solution blueprints in the Solution Explorer.'),
      card('MENTOR_OTHERS', 'Mentor others', 'Mentoring is not available on the platform yet.', NOT_YET),
      card('ALUMNI_NETWORK', 'Alumni network', 'An alumni network is not available on the platform yet.', NOT_YET),
    ],
    default_roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }],
  },
  {
    code: 'INDUSTRY_PROFESSIONAL',
    label: 'Industry professional',
    description: 'You work in industry and want to learn, collaborate or explore.',
    organization: 'required',
    fields: [
      text('job_title', 'Job title', true),
      text('industry', 'Industry', true),
      choice('years_experience', 'Years of experience', EXPERIENCE),
      long('collaboration_interest', 'What are you interested in?', true),
      url('profile_url', 'Professional profile link'),
      url('organization_website', 'Organisation website'),
    ],
    purposes: [
      card('UPSKILL', 'Upskill with courses', 'Take Learning Hub courses relevant to your work.'),
      card('EXPLORE_SHOWCASE', 'Explore solutions', 'Browse solution blueprints in the Solution Explorer.'),
      card('INDUSTRY_CHALLENGES', 'Industry challenges', 'Posting industry challenges is not available on the platform yet.', NOT_YET),
      card('PARTNERSHIPS', 'Partnerships', 'Partnership workflows are not available on the platform yet; our team will contact you.', NOT_YET),
    ],
    default_roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }],
  },
  {
    code: 'EXECUTIVE_LEADER',
    label: 'Executive / Leader',
    description: 'You lead an organisation or a function and want to explore working with Inspironics.',
    organization: 'required',
    fields: [
      text('job_title', 'Job title', true),
      choice('organization_size', 'Organisation size (people)', ORG_SIZE, true),
      text('industry', 'Industry'),
      long('strategic_objective', 'What would you like to achieve?', true),
      choice('preferred_engagement', 'Preferred way to engage', ENGAGEMENT),
      url('profile_url', 'Professional profile link'),
    ],
    purposes: [
      card('EXPLORE_SHOWCASE', 'Explore solutions', 'Browse solution blueprints in the Solution Explorer.'),
      card('SAMPLE_LEARNING', 'Try the learning experience', 'Take Learning Hub courses as a learner.'),
      card('EXECUTIVE_DASHBOARDS', 'Executive dashboards', 'Executive dashboards are not available on the platform yet.', NOT_YET),
      card('PARTNERSHIPS', 'Partnerships and talent', 'Partnership and talent workflows are not available yet; our team will contact you.', NOT_YET),
    ],
    default_roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }],
  },
].map(withPurposes));

export const ONBOARDING_CATEGORY_CODES = Object.freeze(ONBOARDING_CATEGORIES.map((c) => c.code));
export const onboardingCategory = (code) => ONBOARDING_CATEGORIES.find((c) => c.code === code) || null;

// ---- The six enterprise onboarding roles (Phase 3 approval, 2026-11-17) ----------------------------
//
// One central, reusable configuration. Each role has its own questions (asked one at a time by the
// assistant; `ask` is the conversational wording), follow-ups that appear only when an earlier answer
// calls for them (`when`), quick-reply ideas, the roles a reviewer MAY grant (`grants`, never
// automatic) and what a reviewer should verify. A role maps onto an existing category code
// (registration_requests.primary_category_code, migration 011, unchanged); the role itself is stored in
// the profile (`onboarding_role`, profile schema version 2).
//
// Data minimisation (founder decision): no phone or contact numbers, no residential address, no
// location beyond an optional country; no passwords anywhere in the conversation.
// Self-selected roles grant nothing: every role is learner-only by default, `intern` and `alumni` are
// grantable only for their own role and only after verification, and no executive or administrator
// access exists to grant.

export const ROLE_PROFILE_SCHEMA_VERSION = 2;

const ask = (spec) => (spec.type === 'year'
  ? { required: false, min: 1950, max: 2100, ...spec }
  : { required: false, ...spec, max: spec.max ?? (spec.type === 'longtext' ? ONBOARDING_LIMITS.longText : spec.type === 'url' ? ONBOARDING_LIMITS.url : ONBOARDING_LIMITS.text) });
const ORG_SIZE_OPTIONS = ORG_SIZE;

export const ONBOARDING_ROLE_GROUPS = Object.freeze([
  { code: 'EARLY_CAREER', label: 'Early Career & Talent' },
  { code: 'PARTNERS', label: 'Industry & External Partners' },
  { code: 'EXECUTIVE', label: 'Executive Leadership' },
]);

export const ONBOARDING_ROLES = Object.freeze([
  {
    code: 'INTERN',
    label: 'Intern',
    group: 'EARLY_CAREER',
    category: 'INTERNSHIP_CANDIDATE',
    description: 'You are joining, or applying to join, an internship programme.',
    emailLabel: 'your email address (your college address is fine)',
    organization: 'none',
    fields: [
      ask({ key: 'institution', label: 'College or university', type: 'text', required: true, ask: 'Which college or university are you with?', ideas: ['Anna University', 'IIT Madras', 'VIT', 'PSG College of Technology'] }),
      ask({ key: 'degree', label: 'Degree and specialisation', type: 'text', required: true, ask: 'What degree and specialisation are you studying?', ideas: ['B.E. Computer Science', 'B.Tech Information Technology', 'MCA', 'M.Sc Data Science'] }),
      ask({ key: 'academic_year', label: 'Current academic year', type: 'enum', required: true, ask: 'Which academic year are you in?', options: ['first_year', 'second_year', 'third_year', 'final_year', 'postgraduate', 'graduated'] }),
      ask({ key: 'internship_department', label: 'Internship department', type: 'text', required: true, ask: 'Which department or team is your internship with?', ideas: ['Engineering', 'Data and AI', 'Product', 'Cloud and DevOps'] }),
      ask({ key: 'internship_duration', label: 'Internship duration', type: 'enum', required: true, ask: 'How long is the internship?', options: ['up_to_3_months', '3_to_6_months', 'over_6_months', 'not_decided'] }),
      ask({ key: 'start_month', label: 'Internship start', type: 'month', ask: 'When does (or did) the internship start? Pick the month.' }),
      ask({ key: 'has_mentor', label: 'Mentor assigned', type: 'enum', required: true, ask: 'Has a mentor been assigned to you yet?', options: ['yes', 'not_yet'] }),
      ask({ key: 'mentor_name', label: 'Assigned mentor', type: 'text', required: true, when: { key: 'has_mentor', equals: 'yes' }, ask: 'Great — what is your mentor’s name?' }),
      ask({ key: 'skills', label: 'Relevant skills', type: 'longtext', ask: 'Which skills would you like us to know about? (optional)', ideas: ['Python, SQL', 'React and Node.js', 'Machine learning basics', 'Cloud (AWS / Azure)'] }),
    ],
    grants: ['learner', 'intern'],
    verify: 'Confirm the internship offer with the hiring team before granting the intern role; otherwise grant learner only.',
  },
  {
    code: 'ALUMNI',
    label: 'Alumni / Former Member',
    group: 'EARLY_CAREER',
    category: 'ALUMNI_MEMBER',
    description: 'You studied, interned or worked with us before and want to reconnect.',
    emailLabel: 'your email address',
    organization: 'none',
    fields: [
      ask({ key: 'previous_designation', label: 'Previous designation', type: 'text', required: true, ask: 'What was your designation when you were with us?', ideas: ['Intern', 'Software Engineer', 'Analyst', 'Trainee'] }),
      ask({ key: 'previous_team', label: 'Department or team', type: 'text', required: true, ask: 'Which department or team were you part of?' }),
      ask({ key: 'association_period', label: 'Period of association', type: 'text', required: true, max: 60, ask: 'When were you with us? For example “2019 – 2022”.' }),
      ask({ key: 'completed_programme', label: 'Completed a programme with us', type: 'enum', required: true, ask: 'Did you complete a programme, degree or internship with us?', options: ['yes', 'no'] }),
      ask({ key: 'completion_year', label: 'Completion year', type: 'year', required: true, when: { key: 'completed_programme', equals: 'yes' }, ask: 'Which year did you complete it?' }),
      ask({ key: 'current_organization', label: 'Current organisation', type: 'text', ask: 'Where are you working now? (optional)' }),
      ask({ key: 'current_designation', label: 'Current designation', type: 'text', required: true, ask: 'And your current designation?' }),
      ask({ key: 'reconnect_interests', label: 'Areas of interest in reconnecting', type: 'longtext', required: true, ask: 'What would you like to reconnect with us for?', ideas: ['Continue learning', 'Mentoring current interns', 'Collaborating on projects', 'Hiring and referrals'] }),
    ],
    grants: ['learner', 'alumni'],
    verify: 'Verify the former association from records before granting the alumni role; otherwise grant learner only.',
  },
  {
    code: 'INDUSTRY_PARTNER',
    label: 'Industry Partner',
    group: 'PARTNERS',
    category: 'INDUSTRY_PROFESSIONAL',
    description: 'You represent an organisation exploring collaboration with us.',
    emailLabel: 'your business email address',
    organization: 'required',
    fields: [
      ask({ key: 'designation', label: 'Designation', type: 'text', required: true, ask: 'What is your designation there?', ideas: ['Head of Engineering', 'Partnerships Manager', 'Solutions Architect', 'HR / Talent Lead'] }),
      ask({ key: 'industry_sector', label: 'Industry sector', type: 'text', required: true, ask: 'Which industry sector is your organisation in?', ideas: ['IT services', 'Manufacturing', 'Banking and finance', 'Healthcare'] }),
      ask({ key: 'company_website', label: 'Company website', type: 'url', ask: 'What is your company website? (optional — we store it as text and do not visit it automatically)' }),
      ask({ key: 'partnership_nature', label: 'Nature of partnership', type: 'enum', required: true, ask: 'What kind of partnership are you interested in?', options: ['technology', 'research', 'talent_and_hiring', 'training_and_upskilling', 'sponsorship', 'other'] }),
      ask({ key: 'partnership_other', label: 'Partnership described', type: 'text', required: true, when: { key: 'partnership_nature', equals: 'other' }, ask: 'Could you describe the partnership in a few words?' }),
      ask({ key: 'collaboration_interests', label: 'Collaboration interests', type: 'longtext', required: true, ask: 'What would you like to collaborate on?', ideas: ['Joint innovation projects', 'Hiring interns', 'Upskilling our team', 'Research collaboration'] }),
      ask({ key: 'primary_contact', label: 'Primary contact', type: 'enum', required: true, ask: 'Will you be the primary contact for this partnership?', options: ['yes_me', 'someone_else'] }),
      ask({ key: 'primary_contact_name', label: 'Primary contact person', type: 'text', required: true, when: { key: 'primary_contact', equals: 'someone_else' }, ask: 'What is the primary contact’s name? (name only — please don’t share their phone or address)' }),
    ],
    grants: ['learner'],
    verify: 'Confirm the organisation and any partnership agreement with the partnerships team. Approval grants learner access only; it does not create a partnership.',
  },
  {
    code: 'CEO',
    label: 'Chief Executive Officer',
    group: 'EXECUTIVE',
    category: 'EXECUTIVE_LEADER',
    description: 'You lead an organisation as its Chief Executive Officer.',
    emailLabel: 'your corporate email address',
    organization: 'required',
    fields: [
      ask({ key: 'official_designation', label: 'Official designation', type: 'text', required: true, ask: 'What is your official designation?', ideas: ['Chief Executive Officer', 'Founder & CEO', 'Managing Director & CEO'] }),
      ask({ key: 'organization_size', label: 'Organisation size (people)', type: 'enum', required: true, ask: 'Roughly how many people work in your organisation?', options: ORG_SIZE_OPTIONS }),
      ask({ key: 'responsibility_areas', label: 'Areas of organisational responsibility', type: 'longtext', required: true, ask: 'Which areas of the organisation are you responsible for?', ideas: ['Overall strategy and growth', 'Technology and innovation', 'Talent and culture'] }),
      ask({ key: 'access_request', label: 'Executive access request', type: 'longtext', required: true, ask: 'What would you like to access or explore on APEX, and why?', ideas: ['Explore the innovation showcase', 'Leadership learning for my team', 'Talent partnership discussions'] }),
    ],
    grants: ['learner'],
    verify: 'Verify identity and organisation through a trusted contact. APEX has no executive role: approval grants learner access only.',
  },
  {
    code: 'VP',
    label: 'Vice President',
    group: 'EXECUTIVE',
    category: 'EXECUTIVE_LEADER',
    description: 'You lead a function or division as a Vice President.',
    emailLabel: 'your corporate email address',
    organization: 'required',
    fields: [
      ask({ key: 'functional_division', label: 'Functional division', type: 'text', required: true, ask: 'Which functional division do you lead?', ideas: ['Engineering', 'Operations', 'Sales and marketing', 'Human resources'] }),
      ask({ key: 'official_designation', label: 'Official designation', type: 'text', required: true, ask: 'What is your official designation?', ideas: ['Vice President, Engineering', 'Senior Vice President', 'VP, Talent'] }),
      ask({ key: 'responsibility_areas', label: 'Areas of responsibility', type: 'longtext', required: true, ask: 'What are your main areas of responsibility?' }),
      ask({ key: 'access_request', label: 'Executive access request', type: 'longtext', required: true, ask: 'What would you like to access or explore on APEX, and why?', ideas: ['Learning programmes for my division', 'Explore the innovation showcase', 'Hiring interns'] }),
    ],
    grants: ['learner'],
    verify: 'Verify identity and organisation through a trusted contact. APEX has no executive role: approval grants learner access only.',
  },
  {
    code: 'DIRECTOR',
    label: 'Director',
    group: 'EXECUTIVE',
    category: 'EXECUTIVE_LEADER',
    description: 'You serve as a Director of a board or department.',
    emailLabel: 'your corporate email address',
    organization: 'required',
    fields: [
      ask({ key: 'board_or_department', label: 'Board or department association', type: 'text', required: true, ask: 'Which board or department are you associated with?', ideas: ['Board of Directors', 'Engineering', 'Finance', 'Strategy'] }),
      ask({ key: 'official_designation', label: 'Official designation', type: 'text', required: true, ask: 'What is your official designation?', ideas: ['Director', 'Executive Director', 'Non-Executive Director', 'Director of Engineering'] }),
      ask({ key: 'responsibility_areas', label: 'Areas of responsibility', type: 'longtext', required: true, ask: 'What are your main areas of responsibility?' }),
      ask({ key: 'access_request', label: 'Director-level access request', type: 'longtext', required: true, ask: 'What would you like to access or explore on APEX, and why?', ideas: ['Governance and strategy learning', 'Explore the innovation showcase', 'Partnership discussions'] }),
    ],
    grants: ['learner'],
    verify: 'Verify identity and organisation through a trusted contact. APEX has no executive or director role: approval grants learner access only.',
  },
]);
export const ONBOARDING_ROLE_CODES = Object.freeze(ONBOARDING_ROLES.map((r) => r.code));

/**
 * How the assistant groups each role's questions into a few conversational cards (fewer steps): every
 * field of the role appears in exactly one card, in this order; `_org` is the claimed organisation.
 * Follow-ups (`when`) open inside the same card. Purely presentation: validation is per field.
 */
export const ONBOARDING_ROLE_STEPS = Object.freeze({
  INTERN: [
    { key: 'studies', title: 'Your studies', intro: 'Tell me a little about your studies.', fields: ['institution', 'degree', 'academic_year', 'skills'] },
    { key: 'internship', title: 'Your internship', intro: 'And a few details about the internship.', fields: ['internship_department', 'internship_duration', 'start_month', 'has_mentor', 'mentor_name'] },
  ],
  ALUMNI: [
    { key: 'past', title: 'Your time with us', intro: 'Tell me about your time with us.', fields: ['previous_designation', 'previous_team', 'association_period', 'completed_programme', 'completion_year'] },
    { key: 'now', title: 'Where you are now', intro: 'And where you are today.', fields: ['current_designation', 'current_organization', 'reconnect_interests'] },
  ],
  INDUSTRY_PARTNER: [
    { key: 'org', title: 'Your organisation', intro: 'Tell me about your organisation.', fields: ['_org', 'designation', 'industry_sector', 'company_website'] },
    { key: 'partnership', title: 'The partnership', intro: 'What kind of collaboration do you have in mind?', fields: ['partnership_nature', 'partnership_other', 'collaboration_interests', 'primary_contact', 'primary_contact_name'] },
  ],
  CEO: [
    { key: 'org', title: 'Your organisation', intro: 'Tell me about your organisation.', fields: ['_org', 'official_designation', 'organization_size'] },
    { key: 'goals', title: 'Responsibilities and goals', intro: 'What do you lead, and what would you like from APEX?', fields: ['responsibility_areas', 'access_request'] },
  ],
  VP: [
    { key: 'org', title: 'Your organisation', intro: 'Tell me about your organisation and division.', fields: ['_org', 'functional_division', 'official_designation'] },
    { key: 'goals', title: 'Responsibilities and goals', intro: 'What do you lead, and what would you like from APEX?', fields: ['responsibility_areas', 'access_request'] },
  ],
  DIRECTOR: [
    { key: 'org', title: 'Your organisation', intro: 'Tell me about your organisation and board or department.', fields: ['_org', 'board_or_department', 'official_designation'] },
    { key: 'goals', title: 'Responsibilities and goals', intro: 'What are you responsible for, and what would you like from APEX?', fields: ['responsibility_areas', 'access_request'] },
  ],
});
export const onboardingRole = (code) => ONBOARDING_ROLES.find((r) => r.code === code) || null;

/** True when a field's follow-up condition holds for these answers (fields without one always apply). */
export const fieldApplies = (field, answers) => !field.when || (answers || {})[field.when.key] === field.when.equals;

/**
 * Validates a role profile. Returns { value, errors, missing } like validateCategoryProfile. The value
 * carries schema_version 2 and the role. A follow-up whose condition does not hold is dropped.
 */
export function validateRoleProfile(roleCode, profile, { partial = true } = {}) {
  const role = onboardingRole(roleCode);
  if (!role) return { value: null, errors: { onboarding_role: `onboarding_role must be one of: ${ONBOARDING_ROLE_CODES.join(', ')}` }, missing: [] };
  const input = profile === undefined || profile === null ? {} : profile;
  if (typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { category_profile: 'category_profile must be an object' }, missing: [] };
  const errors = {};
  const known = new Set(role.fields.map((f) => f.key));
  for (const key of Object.keys(input)) {
    if (key === 'schema_version') {
      if (input.schema_version !== ROLE_PROFILE_SCHEMA_VERSION) errors.schema_version = `schema_version must be ${ROLE_PROFILE_SCHEMA_VERSION}`;
    } else if (key === 'onboarding_role') {
      if (input.onboarding_role !== roleCode) errors.onboarding_role = 'onboarding_role does not match';
    } else if (!known.has(key)) errors[key] = `${key} is not a field for ${role.label}`;
  }
  const value = { schema_version: ROLE_PROFILE_SCHEMA_VERSION, onboarding_role: role.code };
  const missing = [];
  for (const field of role.fields) {
    const r = checkField(field, input[field.key]);
    if (r.error) errors[field.key] = r.error;
    else if (!fieldApplies(field, input)) continue; // a follow-up that does not apply is not kept
    else if (r.value !== null) value[field.key] = r.value;
    else if (field.required) missing.push(field.key);
  }
  if (!partial) for (const key of missing) errors[key] = errors[key] || `${role.fields.find((f) => f.key === key).label} is required`;
  return { value, errors, missing };
}

/** Required fields still empty for a complete role submission (role fields plus organisation when required). */
export function missingForRoleSubmission({ onboarding_role: code, category_profile: profile, claimed_organization: org, preferences }) {
  const role = onboardingRole(code);
  if (!role) return ['onboarding_role'];
  const { missing } = validateRoleProfile(code, profile, { partial: true });
  if (role.organization === 'required' && !org) missing.unshift('claimed_organization');
  // At least one APEX platform must be chosen (when preferences are given at all: older callers pass none).
  if (preferences !== undefined && !(Array.isArray(preferences?.platforms) && preferences.platforms.length)) missing.push('platforms');
  return missing;
}

export const ONBOARDING_INTERESTS = Object.freeze([
  { code: 'AI_ML', label: 'Artificial intelligence and machine learning' },
  { code: 'DATA_ANALYTICS', label: 'Data and analytics' },
  { code: 'SOFTWARE_ENGINEERING', label: 'Software engineering' },
  { code: 'CLOUD_DEVOPS', label: 'Cloud and DevOps' },
  { code: 'CYBERSECURITY', label: 'Cybersecurity' },
  { code: 'PRODUCT_DESIGN', label: 'Product and design' },
  { code: 'BUSINESS_STRATEGY', label: 'Business and strategy' },
  { code: 'LEADERSHIP', label: 'Leadership and management' },
  { code: 'INNOVATION', label: 'Innovation and research' },
  { code: 'ENTREPRENEURSHIP', label: 'Entrepreneurship' },
  { code: 'OTHER', label: 'Something else' },
]);
export const ONBOARDING_INTEREST_CODES = Object.freeze(ONBOARDING_INTERESTS.map((i) => i.code));

/**
 * The APEX platforms an applicant can ask to use. The choice is a request: the approver confirms which
 * platforms the person sees on the APEX home. It is a display setting, not an authorization: opening
 * Showcase or SlidesVault still needs an account there, created and linked by an administrator (ADR 0003).
 * Labels are the outside-facing names (Solution Explorer, Presentation Library, Learning Hub); codes stay internal.
 */
export const APEX_PLATFORMS = Object.freeze([
  { code: 'showcase', label: 'Solution Explorer', description: 'See the solutions we have built and how they work together.' },
  { code: 'slidesvault', label: 'Presentation Library', description: 'Find and read our presentations, even when offline.' },
  { code: 'academia', label: 'Learning Hub', description: 'Take courses, pass tests and earn certificates.' },
]);
export const APEX_PLATFORM_CODES = Object.freeze(APEX_PLATFORMS.map((p) => p.code));

/** A clean, ordered list of known platform codes, or an error. */
export function validatePlatforms(list) {
  if (!Array.isArray(list)) return { error: 'platforms must be a list' };
  const unique = [...new Set(list)];
  const bad = unique.filter((c) => !APEX_PLATFORM_CODES.includes(c));
  if (bad.length) return { error: `Unknown platform: ${bad.map(String).join(', ').slice(0, 100)}` };
  return { value: APEX_PLATFORM_CODES.filter((c) => unique.includes(c)) };
}

// C0 control characters other than tab/newline/carriage return, DEL, and bidi overrides are refused.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
export const isValidEmail = (e) => typeof e === 'string' && e.length <= ONBOARDING_LIMITS.email && EMAIL_RE.test(e) && !CONTROL_RE.test(e);

/** A clean single-line or multi-line string, or an error message. */
export function cleanText(value, { label, max, multiline = false, required = false }) {
  if (value === undefined || value === null || value === '') return required ? { error: `${label} is required` } : { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const v = multiline ? value.replace(/\r\n?/g, '\n').trim() : value.trim();
  if (!v) return required ? { error: `${label} is required` } : { value: null };
  if (CONTROL_RE.test(v) || (!multiline && /[\n\t]/.test(v))) return { error: `${label} contains characters that are not allowed` };
  if (v.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: v };
}

function checkField(field, raw) {
  if (field.type === 'text' || field.type === 'longtext') {
    return cleanText(raw, { label: field.label, max: field.max, multiline: field.type === 'longtext' });
  }
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (field.type === 'multi') {
    if (!Array.isArray(raw)) return { error: `${field.label} must be a list` };
    const picked = [...new Set(raw)];
    if (picked.some((v) => !field.options.includes(v))) return { error: `${field.label} must use only: ${field.options.join(', ')}` };
    if (picked.length > field.max) return { error: `Choose at most ${field.max} for ${field.label}` };
    return picked.length ? { value: picked } : { value: null };
  }
  if (field.type === 'enum') return field.options.includes(raw) ? { value: raw } : { error: `${field.label} must be one of: ${field.options.join(', ')}` };
  if (field.type === 'month') {
    const ok = typeof raw === 'string' && /^(19[5-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/.test(raw);
    return ok ? { value: raw } : { error: `${field.label} must be a month like 2026-06` };
  }
  if (field.type === 'year') {
    const n = typeof raw === 'number' ? raw : Number.NaN;
    return Number.isInteger(n) && n >= field.min && n <= field.max ? { value: n } : { error: `${field.label} must be a year between ${field.min} and ${field.max}` };
  }
  if (field.type === 'url') {
    const t = cleanText(raw, { label: field.label, max: field.max });
    if (t.error || t.value === null) return t;
    let u;
    try { u = new URL(t.value); } catch { return { error: `${field.label} must be a web address starting with https:// or http://` }; }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return { error: `${field.label} must be a web address starting with https:// or http://` };
    return { value: t.value }; // the text as given: stored, never fetched
  }
  return { error: `${field.label} has an unknown type` };
}

/**
 * Validates a category profile. Returns { value, errors, missing }:
 *   value   — { schema_version, ...known fields with clean values } (nulls dropped)
 *   errors  — { key: message } for invalid or unknown keys
 *   missing — keys of required fields that are empty (only an error when `partial` is false)
 */
export function validateCategoryProfile(code, profile, { partial = true } = {}) {
  const cat = onboardingCategory(code);
  const errors = {};
  if (!cat) return { value: null, errors: { primary_category_code: `primary_category_code must be one of: ${ONBOARDING_CATEGORY_CODES.join(', ')}` }, missing: [] };
  const input = profile === undefined || profile === null ? {} : profile;
  if (typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { category_profile: 'category_profile must be an object' }, missing: [] };
  const known = new Set(cat.fields.map((f) => f.key));
  for (const key of Object.keys(input)) {
    if (key === 'schema_version') {
      if (input.schema_version !== PROFILE_SCHEMA_VERSION) errors.schema_version = `schema_version must be ${PROFILE_SCHEMA_VERSION}`;
    } else if (!known.has(key)) errors[key] = `${key} is not a field of ${cat.label}`;
  }
  const value = { schema_version: PROFILE_SCHEMA_VERSION };
  const missing = [];
  for (const field of cat.fields) {
    const r = checkField(field, input[field.key]);
    if (r.error) errors[field.key] = r.error;
    else if (r.value !== null) value[field.key] = r.value;
    else if (field.required) missing.push(field.key);
  }
  if (!partial) for (const key of missing) errors[key] = errors[key] || `${cat.fields.find((f) => f.key === key).label} is required`;
  return { value, errors, missing };
}

/** Validates interest codes (allow-list) and the free text that goes with OTHER. */
export function validateInterests(codes, other) {
  const errors = {};
  const list = codes === undefined || codes === null ? [] : codes;
  if (!Array.isArray(list)) return { errors: { interest_codes: 'interest_codes must be a list' } };
  const unique = [...new Set(list)];
  if (unique.length > ONBOARDING_LIMITS.maxInterests) errors.interest_codes = `Choose at most ${ONBOARDING_LIMITS.maxInterests} interests`;
  const bad = unique.filter((c) => !ONBOARDING_INTEREST_CODES.includes(c));
  if (bad.length) errors.interest_codes = `Unknown interest codes: ${bad.map(String).join(', ').slice(0, 200)}`;
  const o = cleanText(other, { label: 'Other interest', max: ONBOARDING_LIMITS.interestOther });
  if (o.error) errors.interest_other = o.error;
  if (o.value && !unique.includes('OTHER')) errors.interest_other = 'interest_other is only accepted with OTHER';
  return { errors, codes: unique, other: o.value ?? null };
}

// ISO 3166-1 alpha-2 (officially assigned codes). Used to validate a country preference; a country is
// a display preference only, never evidence of residence or affiliation.
export const ISO_COUNTRY_CODES = Object.freeze(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW
BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE
GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW
KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO
NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX
SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/));

/** Application locales (the interface is English only today) and the display-format enums. */
export const ONBOARDING_LOCALES = Object.freeze(['en-GB', 'en-US', 'en-IN']);
export const DATE_FORMATS = Object.freeze(['DMY', 'MDY', 'YMD']);
export const UNIT_SYSTEMS = Object.freeze(['metric', 'imperial']);
const PREFERENCE_KEYS = ['timezone', 'locale', 'country_code', 'date_format', 'unit_system', 'platforms'];

const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;

/** True for an IANA time zone this runtime knows (falls back to the syntax check where Intl lacks the list). */
export function isKnownTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64 || !TZ_RE.test(tz)) return false;
  try {
    if (typeof Intl.supportedValuesOf === 'function' && (tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz))) return true;
    new Intl.DateTimeFormat('en', { timeZone: tz }); // eslint-disable-line no-new
    return true;
  } catch {
    return false;
  }
}

/**
 * Preferences: time zone, application locale, ISO country, date format and unit system — each optional,
 * each checked against a real list or enum. Unknown keys are refused.
 */
export function validatePreferences(prefs) {
  const input = prefs === undefined || prefs === null ? {} : prefs;
  if (typeof input !== 'object' || Array.isArray(input)) return { errors: { preferences: 'preferences must be an object' }, value: {} };
  const errors = {};
  const value = {};
  for (const key of Object.keys(input)) if (!PREFERENCE_KEYS.includes(key)) errors[`preferences.${key}`] = `${key} is not a preference`;
  const given = (v) => v !== undefined && v !== null && v !== '';
  const { timezone, locale, country_code: country, date_format: dateFormat, unit_system: units } = input;
  if (given(timezone)) {
    if (!isKnownTimeZone(timezone)) errors['preferences.timezone'] = 'timezone must be an IANA time zone name';
    else value.timezone = timezone;
  }
  if (given(locale)) {
    if (!ONBOARDING_LOCALES.includes(locale)) errors['preferences.locale'] = `locale must be one of: ${ONBOARDING_LOCALES.join(', ')}`;
    else value.locale = locale;
  }
  if (given(country)) {
    const c = typeof country === 'string' ? country.toUpperCase() : '';
    if (!ISO_COUNTRY_CODES.includes(c)) errors['preferences.country_code'] = 'country_code must be an ISO 3166-1 country code';
    else value.country_code = c;
  }
  if (given(dateFormat)) {
    if (!DATE_FORMATS.includes(dateFormat)) errors['preferences.date_format'] = `date_format must be one of: ${DATE_FORMATS.join(', ')}`;
    else value.date_format = dateFormat;
  }
  if (given(units)) {
    if (!UNIT_SYSTEMS.includes(units)) errors['preferences.unit_system'] = `unit_system must be one of: ${UNIT_SYSTEMS.join(', ')}`;
    else value.unit_system = units;
  }
  if (given(input.platforms)) {
    const p = validatePlatforms(input.platforms);
    if (p.error) errors['preferences.platforms'] = p.error;
    else value.platforms = p.value;
  }
  return { errors, value };
}

/**
 * Roles an onboarding approval may grant (platform scope only in v1: external organisations are held,
 * so no organisation membership is created by approval). Everything else — platform_admin, org_admin,
 * app_admin, staff, assessor — is refused at approval whatever the approver holds; it can only be
 * granted afterwards through People & access, with its own checks and audit.
 */
export const ONBOARDING_GRANTABLE_ROLES = Object.freeze(['learner', 'student', 'alumni', 'intern', 'mentor']);

/** Required fields still empty for a complete submission (category fields plus organisation when required). */
export function missingForSubmission({ primary_category_code: code, category_profile: profile, claimed_organization: org }) {
  const cat = onboardingCategory(code);
  if (!cat) return ['primary_category_code'];
  const { missing } = validateCategoryProfile(code, profile, { partial: true });
  if (cat.organization === 'required' && !org) missing.unshift('claimed_organization');
  return missing;
}
