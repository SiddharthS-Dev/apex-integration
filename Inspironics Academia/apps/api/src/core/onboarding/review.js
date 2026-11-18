import { ONBOARDING_CATEGORY_CODES, fieldApplies, onboardingCategory, onboardingRole } from '@academy/shared';
import { log } from '../../lib/logger.js';
import { callModel, modelLabel, plainReply, scrub, SYSTEM_POLICY } from './ai.js';
import { onboardingConfig } from './config.js';

// Administrator review advice (prompt §6C). The rules engine always runs first and its result is
// stored at submission with source 'rules'. When onboarding AI is on, a model may refine it after
// commit; each field is validated on its own against the allowed values, and a field that fails keeps
// its rules value. The mandatory rules observations are always kept. `source` is set here, never taken
// from the model. Advice is advisory: nothing here assigns a role, an organisation or a resource.

export const REVIEW_SCHEMA_VERSION = 1;

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'icloud.com',
  'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'rediffmail.com', 'mail.com', 'yandex.com',
]);

const parse = (text, fallback) => {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};

const CATEGORY_NOTES = {
  STUDENT_LEARNER: 'Institution, programme and year of study are self-reported and not verified.',
  INTERNSHIP_CANDIDATE: 'Internship interest is not an internship offer. The intern role is only for an accepted offer (outside this request).',
  ALUMNI_MEMBER: 'The alumni relationship is self-reported. Grant the alumni role only with verified evidence (DEC-005); it does not authorise mentoring.',
  INDUSTRY_PROFESSIONAL: 'Industry interest does not create a partnership. Approval creates no organisation membership (external organisations are held).',
  EXECUTIVE_LEADER: 'A leadership title grants no administrator access. Approval cannot grant administrator roles.',
};

/** The deterministic recommendation. Always available; never expands access. */
export function rulesRecommendation(row) {
  const profile = parse(row.category_profile, {});
  const role = onboardingRole(profile.onboarding_role);
  const cat = role ? { label: role.label, fields: role.fields.filter((f) => fieldApplies(f, profile)) } : onboardingCategory(row.primary_category_code);
  const domain = String(row.email || '').split('@')[1] || '';
  const observations = [];
  observations.push(PERSONAL_DOMAINS.has(domain)
    ? { code: 'EMAIL_PERSONAL', text: `Personal email address (${domain}). Neutral: it neither confirms nor rules out an affiliation.` }
    : { code: 'EMAIL_DOMAIN', text: `Email domain ${domain}: the address is verified, but the domain is not evidence of employment or membership.` });
  if (row.claimed_organization) observations.push({ code: 'ORGANISATION_UNVERIFIED', text: `Claimed organisation "${String(row.claimed_organization).slice(0, 120)}" is not verified.` });
  const policy = role?.verify || CATEGORY_NOTES[row.primary_category_code];
  if (policy) observations.push({ code: 'CATEGORY_POLICY', text: policy });
  const fields = cat?.fields || [];
  if (fields.some((f) => f.type === 'url' && profile[f.key])) observations.push({ code: 'LINKS_UNVERIFIED', text: 'Links are stored as text and were not visited.' });
  const emptyOptional = fields.filter((f) => !f.required && (profile[f.key] === undefined || profile[f.key] === null || profile[f.key] === '')).map((f) => f.label);
  if (emptyOptional.length) observations.push({ code: 'OPTIONAL_MISSING', text: `Not given (optional): ${emptyOptional.join(', ')}.` });

  const objectiveField = fields.find((f) => f.type === 'longtext' && f.required);
  const objective = objectiveField ? String(profile[objectiveField.key] || '').replace(/\s+/g, ' ').slice(0, 200) : '';
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    summary: `${cat?.label || row.primary_category_code} request.${objective ? ` Objective: ${objective}` : ''}`,
    suggested_category_code: row.primary_category_code,
    suggested_role_code: 'learner',
    proposed_roles: role ? [...role.grants] : (cat?.default_roles || []).map((r) => r.role),
    onboarding_role: role?.code || null,
    suggested_organization_id: null,
    suggested_resource_ids: [],
    onboarding_path_code: row.primary_category_code,
    observations,
  };
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: 900 },
    suggested_category_code: { type: 'string', maxLength: 40 },
    suggested_role_code: { type: 'string', maxLength: 40 },
    suggested_organization_id: { type: 'string', maxLength: 80 },
    suggested_resource_ids: { type: 'array', items: { type: 'string', maxLength: 80 } },
    onboarding_path_code: { type: 'string', maxLength: 40 },
    observations: { type: 'array', items: { type: 'string', maxLength: 300 } },
  },
  required: ['summary', 'suggested_category_code', 'suggested_role_code', 'onboarding_path_code', 'observations'],
};

/**
 * Merges a model answer into the rules result, field by field. Organisations and resources come only
 * from a curated, verified catalogue — empty in v1 — so whatever the model says they stay empty.
 */
export function acceptReview(raw, rules) {
  const out = { ...rules, observations: [...rules.observations] };
  let used = false;
  if (!raw || typeof raw !== 'object') return { value: out, used };
  const summary = plainReply(raw.summary, 600);
  if (summary) { out.summary = summary; used = true; }
  if (ONBOARDING_CATEGORY_CODES.includes(raw.suggested_category_code)) {
    used = true;
    if (raw.suggested_category_code !== rules.suggested_category_code) {
      // The self-selected category stays the suggestion; the model's view is shown as an observation.
      out.observations.push({ code: 'AI_CATEGORY_NOTE', text: `The assistant thinks ${onboardingCategory(raw.suggested_category_code).label} may fit better. The applicant chose ${onboardingCategory(rules.suggested_category_code)?.label}.` });
    }
  }
  if (typeof raw.suggested_role_code === 'string' && rules.proposed_roles.includes(raw.suggested_role_code)) { out.suggested_role_code = raw.suggested_role_code; used = true; }
  if (ONBOARDING_CATEGORY_CODES.includes(raw.onboarding_path_code)) { out.onboarding_path_code = raw.onboarding_path_code; used = true; }
  if (Array.isArray(raw.observations)) {
    for (const o of raw.observations.slice(0, 5)) {
      const t = plainReply(o, 240);
      if (t) { out.observations.push({ code: 'AI_NOTE', text: t }); used = true; }
    }
  }
  out.suggested_organization_id = null;
  out.suggested_resource_ids = [];
  return { value: out, used };
}

/** The model input: sanitised, bounded, no name, no full email, no links, no secrets. */
export function reviewPrompt(row, rules) {
  const profile = parse(row.category_profile, {});
  const role = onboardingRole(profile.onboarding_role);
  const cat = role ? { fields: role.fields.filter((f) => fieldApplies(f, profile)) } : onboardingCategory(row.primary_category_code);
  const safeProfile = {};
  for (const f of cat?.fields || []) {
    if (f.type === 'url' || profile[f.key] === undefined) continue;
    safeProfile[f.key] = typeof profile[f.key] === 'string' ? scrub(profile[f.key], f.type === 'longtext' ? 600 : 150) : profile[f.key];
  }
  return [
    'Summarise this access request for an administrator in at most three sentences, and list missing information or unverified claims.',
    'Do not score the person, do not infer age, gender, ethnicity, religion, health or nationality, and do not recommend approval or rejection.',
    `Suggest a role only from: ${JSON.stringify(rules.proposed_roles)}. Category and path codes: ${JSON.stringify(ONBOARDING_CATEGORY_CODES)}.`,
    'Use an empty string for suggested_organization_id and an empty list for suggested_resource_ids.',
    `<applicant_data>\n${JSON.stringify({
      category: row.primary_category_code,
      onboarding_role: role?.code || null,
      claimed_organization: row.claimed_organization ? scrub(row.claimed_organization, 120) : null,
      email_domain: String(row.email || '').split('@')[1] || '',
      profile: safeProfile,
      interest_codes: parse(row.interest_codes, []),
      clarification_answer: row.info_response ? scrub(row.info_response, 600) : null,
    })}\n</applicant_data>`,
  ].join('\n');
}

const pending = new Set();
/** Tests await the background reviews. */
export const settleReviews = () => Promise.allSettled([...pending]);

/** After a submission (or a clarification) commits: ask the model, if enabled, and store merged advice. */
export function scheduleReview(db, id) {
  if (!onboardingConfig().aiEnabled) return;
  const p = (async () => {
    const [row] = await db.query("SELECT * FROM registration_requests WHERE id = ? AND status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')", [id]);
    if (!row) return;
    const rules = rulesRecommendation(row);
    let merged = { value: rules, used: false };
    try {
      merged = acceptReview(await callModel({ system: SYSTEM_POLICY, prompt: reviewPrompt(row, rules), schema: REVIEW_SCHEMA, maxTokens: 700 }), rules);
    } catch (err) {
      log.warn('onboarding.ai_fallback', { fn: 'review', reason: String(err.message).slice(0, 200) });
    }
    await db.run(
      `UPDATE registration_requests SET ai_recommendation = ?, ai_recommendation_source = ?, ai_model = ?, ai_schema_version = ?
        WHERE id = ? AND status IN ('PENDING_APPROVAL', 'INFO_REQUESTED')`,
      [JSON.stringify(merged.value), merged.used ? 'ai' : 'rules', merged.used ? String(modelLabel() || '').slice(0, 100) : null, REVIEW_SCHEMA_VERSION, id],
    );
  })().catch((err) => log.error('onboarding.review_failed', { id, error: err.message }));
  pending.add(p);
  p.finally(() => pending.delete(p));
}
