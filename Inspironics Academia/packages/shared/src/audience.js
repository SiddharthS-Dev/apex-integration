// Audiences and playbook categories: who a playbook is for, and who may see it.
//
// Every user has an audience (users.audience): intern, employee or leadership. Every playbook has one
// primary category (Playbook.category), and each category lists the audiences allowed to see it
// (PlaybookCategory.audiences). The API filters playbooks, courses and everything inside a course by
// that rule; administrators see every category, plus 'unclassified' (documents awaiting review).
// Shared by the API and the demo driver.

export const AUDIENCES = Object.freeze([
  { key: 'intern', label: 'Intern / Trainee' },
  { key: 'employee', label: 'Employee' },
  { key: 'leadership', label: 'Leadership / Executive' },
]);
export const AUDIENCE_KEYS = AUDIENCES.map((a) => a.key);
export const DEFAULT_AUDIENCE = 'employee';

export const UNCLASSIFIED = 'unclassified';
export const SKILL_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);

/** Where a new Dropbox document lands unless an admin assigns another category. */
export const SYNC_DEFAULT_CATEGORY = 'corporate';

/** The three standard categories, created on first start. Admins can edit them and add more. */
export const DEFAULT_CATEGORIES = Object.freeze([
  {
    key: 'learning',
    label: 'Learning & Development',
    audience_label: 'Interns & Trainees',
    description: 'Learn: programming fundamentals, tools, onboarding guides and learning roadmaps for interns, trainees and new joiners.',
    audiences: ['intern', 'employee', 'leadership'],
    color: 'teal',
    icon: 'graduation',
    order: 0,
    built_in: true,
  },
  {
    key: 'corporate',
    label: 'Corporate Knowledge Base',
    audience_label: 'Employees & Teams',
    description: 'Execute: engineering playbooks, standards, architecture, SOPs, CI/CD, security and operational workflows.',
    audiences: ['employee', 'leadership'],
    color: 'indigo',
    icon: 'building',
    order: 1,
    built_in: true,
  },
  {
    key: 'strategic',
    label: 'Strategic Intelligence',
    audience_label: 'Leadership & Executives',
    description: 'Lead: strategy, governance, portfolio management, risk, financial planning and transformation.',
    audiences: ['leadership'],
    color: 'purple',
    icon: 'compass',
    order: 2,
    built_in: true,
  },
]);

export const audienceOf = (user) => (AUDIENCE_KEYS.includes(user?.audience) ? user.audience : DEFAULT_AUDIENCE);

/**
 * The category keys `user` may see, or null for "everything" (administrators).
 * `categories` are PlaybookCategory rows; a category with no audiences listed is visible to nobody
 * but admins.
 */
export function allowedCategories(user, categories = []) {
  if (user?.role === 'admin') return null;
  const audience = audienceOf(user);
  return categories.filter((c) => (c.audiences || []).includes(audience)).map((c) => c.key);
}

/** True when `user` may see a record of category `category` (a playbook or course). */
export function canSeeCategory(user, category, categories = []) {
  const allowed = allowedCategories(user, categories);
  return allowed === null || allowed.includes(category);
}
