/**
 * The business taxonomy — the one definition both sides of the app agree on.
 *
 * This lived in two places before the monorepo: the web app built its domain
 * palette from its own object literal, and the API's DocumentAnalysisService
 * carried a hardcoded array of the same five names. A classifier that emits a
 * domain the UI does not know about renders blank, so the two lists drifting
 * apart is a silent failure — which is exactly why it belongs here.
 *
 * Presentation concerns (gradients, icons, Tailwind classes) deliberately stay
 * in the web app: this package must import nothing, so the API can use it.
 */

/** Domain -> its sub-domains. Order is the order the UI lists them in. */
export const DOMAIN_TAXONOMY = Object.freeze({
  Engineering: ['Architecture', 'Backend', 'Frontend', 'DevOps', 'AI'],
  Products: ['FleetExplorer', 'Discipline Engine', 'Insight Flow', 'SlidesVault', 'ESG', 'CK'],
  Business: ['Operations', 'Sales', 'Marketing', 'Finance', 'Customer Success'],
  'Human Resources': ['Onboarding', 'Policies', 'Training', 'Performance', 'Recruitment'],
  'Research & Innovation': ['AI Research', 'IoT', 'Knowledge Base', 'Sustainability', 'Future Concepts'],
});

/** The canonical domain names, in display order. */
export const DOMAIN_NAMES = Object.freeze(Object.keys(DOMAIN_TAXONOMY));

/** Shown when a file has no domain, or one the taxonomy no longer contains. */
export const FALLBACK_DOMAIN_NAME = 'Uncategorized';

/** Sub-domains for a domain, or an empty list when it is not a known one. */
export function subDomainsFor(domain) {
  return DOMAIN_TAXONOMY[domain] ?? [];
}

/** True when the classifier returned something the UI can actually render. */
export function isKnownDomain(domain) {
  return Object.hasOwn(DOMAIN_TAXONOMY, domain);
}

/** The taxonomy as handed to the classifier prompt. */
export const TAXONOMY_PROMPT = DOMAIN_NAMES.map(
  (domain, index) => `${index + 1}. ${domain} -> [${DOMAIN_TAXONOMY[domain].join(', ')}]`
).join('\n');
