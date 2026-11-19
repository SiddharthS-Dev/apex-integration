import { allowedCategories, onboardingCategory } from '@academy/shared';
import { list } from '../../repo/entities.js';
import { activeAssignments, nowIso } from '../identity.js';

// Category-aware orientation after approval (prompt §10; slice O4). Truthful by construction: it lists
// only destinations that exist in Academia today, says plainly when nothing is open to the account yet,
// and names the modules that do not exist (internships, mentoring, industry challenges, partnerships,
// executive dashboards) as "not available yet — our team will contact you", never as opportunities.
// Completion is tracked separately from approval (orientation_completed_at) and grants nothing.
// Works whatever the onboarding flags say, so approved accounts keep it when the public flow is off.

// Paths inside the Academia web app (its router adds the /academia mount under the gateway).

const STEP = {
  profile: { id: 'profile', title: 'Complete your profile', description: 'Add a photo and check your name.', path: '/profile' },
  courses: { id: 'courses', title: 'Explore the course catalogue', description: 'Browse the Learning Hub courses open to your account.', path: '/courses' },
  learning: { id: 'learning', title: 'Start a course', description: 'Work through lessons, quizzes and a final test; finished courses earn a certificate.', path: '/my-learning' },
  review: { id: 'review', title: 'Try daily review', description: 'Short flashcard reviews of key points, scheduled for you.', path: '/review' },
};

const NOT_YET = {
  INTERNSHIP_OFFERS: 'Internship opportunities are not handled on the platform yet. Our team will contact you about internships.',
  MENTORING: 'Mentoring is not available on the platform yet. Our team will contact you if you expressed interest.',
  ALUMNI_NETWORK: 'An alumni network is not available on the platform yet.',
  INDUSTRY_CHALLENGES: 'Submitting industry challenges is not available on the platform yet. Our team will contact you about collaboration.',
  PARTNERSHIPS: 'Partnership, sponsorship and talent enquiries are handled by our team directly, not on the platform yet.',
  EXECUTIVE_DASHBOARDS: 'Executive dashboards are not available yet.',
  APPLIED_PROJECTS: 'Guided applied projects are not available on the platform yet.',
};

const PLAN = {
  STUDENT_LEARNER: { steps: ['profile', 'courses', 'learning', 'review'], later: ['APPLIED_PROJECTS'] },
  INTERNSHIP_CANDIDATE: { steps: ['profile', 'courses', 'learning'], later: ['INTERNSHIP_OFFERS', 'MENTORING'] },
  ALUMNI_MEMBER: { steps: ['profile', 'courses'], later: ['ALUMNI_NETWORK', 'MENTORING'] },
  INDUSTRY_PROFESSIONAL: { steps: ['profile', 'courses'], later: ['INDUSTRY_CHALLENGES', 'PARTNERSHIPS'] },
  EXECUTIVE_LEADER: { steps: ['profile', 'courses'], later: ['EXECUTIVE_DASHBOARDS', 'PARTNERSHIPS'] },
};

async function approvedRequest(db, userId) {
  const [r] = await db.query(
    "SELECT id, approved_category_code, primary_category_code, orientation_completed_at FROM registration_requests WHERE approved_user_id = ? AND status = 'APPROVED' ORDER BY decided_at DESC LIMIT 1",
    [userId],
  );
  return r || null;
}

/** GET /orientation — null for accounts that did not come through onboarding. */
export async function orientationFor(db, user) {
  const r = await approvedRequest(db, user.id);
  if (!r) return { orientation: null };
  const code = r.approved_category_code || r.primary_category_code;
  const plan = PLAN[code] || PLAN.STUDENT_LEARNER;
  const roles = await activeAssignments(db, user.id);
  const categories = await list('PlaybookCategory', { limit: 1000 });
  const open = allowedCategories(user, categories);
  const coursesOpen = open === null || open.length > 0;
  const steps = plan.steps.map((id) => {
    const s = { ...STEP[id], available: true };
    if ((id === 'courses' || id === 'learning' || id === 'review') && !coursesOpen) {
      return { ...s, available: false, description: 'No courses are open to your account yet. Our team opens the right ones after approval; they will appear here.' };
    }
    return s;
  });
  return {
    orientation: {
      category_code: code,
      category_label: onboardingCategory(code)?.label || code,
      roles: roles.map((a) => a.role),
      steps,
      not_available_yet: plan.later.map((k) => ({ code: k, text: NOT_YET[k] })),
      completed_at: r.orientation_completed_at,
      notice: 'Your access was approved by a person. The assistant did not enrol you, assign a mentor or approve any partnership.',
    },
  };
}

/** POST /orientation/complete — records that the person finished (or dismissed) the orientation. */
export async function completeOrientation(db, user) {
  const r = await approvedRequest(db, user.id);
  if (!r) return { ok: false };
  if (!r.orientation_completed_at) {
    await db.run('UPDATE registration_requests SET orientation_completed_at = ? WHERE id = ? AND orientation_completed_at IS NULL', [nowIso(), r.id]);
  }
  return { ok: true };
}
