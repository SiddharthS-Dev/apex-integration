/**
 * Classification by the library's own vocabulary, for when the AI is off or
 * returns no domain.
 *
 * Every sub-domain has a list of terms. A deck is scored on where they appear:
 * a Dropbox folder named after a domain or sub-domain is the strongest signal
 * (people file decks deliberately), the title next, the slide text last, with
 * repeats in the text capped so one long deck cannot swamp the rest. The best
 * domain wins only with a clear lead; otherwise the deck stays unclassified
 * rather than being filed somewhere wrong.
 */

import { DOMAIN_TAXONOMY } from '@slidesvault/shared';

/** Terms per domain and sub-domain. Lower-case; matched on word boundaries. */
export const VOCABULARY = Object.freeze({
  Engineering: {
    Architecture: ['architecture', 'system design', 'reference architecture', 'microservice', 'microservices', 'design pattern', 'integration pattern', 'scalability', 'technical design'],
    Backend: ['backend', 'back-end', 'api', 'apis', 'database', 'server', 'endpoint', 'schema', 'data model', 'rest', 'graphql'],
    Frontend: ['frontend', 'front-end', 'user interface', 'react', 'web app', 'css', 'design system', 'ui component'],
    DevOps: ['devops', 'ci/cd', 'deployment', 'kubernetes', 'docker', 'infrastructure', 'observability', 'monitoring', 'incident', 'sre', 'cloud migration', 'release pipeline'],
    AI: ['machine learning', 'ml pipeline', 'model training', 'llm', 'prompt engineering', 'neural network', 'ai engineering', 'inference'],
  },
  Products: {
    FleetExplorer: ['fleetexplorer', 'fleet explorer'],
    'Discipline Engine': ['discipline engine'],
    'Insight Flow': ['insight flow', 'insightflow'],
    SlidesVault: ['slidesvault', 'slides vault'],
    ESG: ['esg', 'esg reporting', 'environmental social governance'],
    CK: ['ck platform', 'ck product'],
  },
  Business: {
    Operations: ['operations', 'operating model', 'kpi', 'kpis', 'process improvement', 'governance', 'board review', 'board meeting', 'okr', 'okrs'],
    Sales: ['sales', 'go-to-market', 'gtm', 'proposal', 'deal', 'csp', 'cloud solution provider', 'partner program', 'reseller', 'growth strategy', 'customer acquisition'],
    Marketing: ['marketing', 'brand', 'campaign', 'positioning', 'messaging', 'market analysis', 'competitor', 'competitive landscape'],
    Finance: ['finance', 'financial', 'revenue', 'valuation', 'investor', 'investors', 'funding', 'budget', 'pricing', 'data room', 'capital', 'equity', 'dilution', 'cap table', 'p&l', 'cash flow'],
    'Customer Success': ['customer success', 'retention', 'churn', 'customer onboarding', 'renewal', 'customer support', 'nps'],
  },
  'Human Resources': {
    Onboarding: ['onboarding', 'new joiner', 'new hire', 'induction', 'first 30 days'],
    Policies: ['policy', 'policies', 'code of conduct', 'leave policy', 'handbook', 'compliance training'],
    Training: ['training', 'workshop', 'upskilling', 'learning path', 'bootcamp'],
    Performance: ['performance review', 'appraisal', 'promotion', 'career ladder', 'feedback', 'goals review'],
    Recruitment: ['recruitment', 'hiring', 'interview', 'talent', 'job description', 'candidate'],
  },
  'Research & Innovation': {
    'AI Research': ['ai research', 'research', 'experiment', 'agentic', 'generative ai', 'genai', 'benchmark', 'proof of concept', 'poc'],
    IoT: ['iot', 'internet of things', 'sensor', 'sensors', 'edge device', 'telemetry', 'digital twin'],
    'Knowledge Base': ['knowledge base', 'knowledge graph', 'ontology', 'taxonomy', 'knowledge management'],
    Sustainability: ['sustainability', 'sustainable', 'carbon', 'net zero', 'climate', 'energy efficiency', 'emissions'],
    'Future Concepts': ['innovation', 'future', 'vision', 'concept', 'ideation', 'mindset', 'founder', 'startup', 'disruption', 'moonshot', 'transformation'],
  },
});

// Only the regex syntax characters: under the `u` flag, escaping anything else (-, /, &) is an error.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
const MATCHERS = Object.entries(VOCABULARY).map(([domain, subs]) => ({
  domain,
  subs: Object.entries(subs).map(([sub, terms]) => ({
    sub,
    terms: terms.map((t) => ({ term: t, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, 'giu') })),
  })),
}));

const WEIGHT = { folder: 8, title: 3, text: 1 };
const TEXT_CAP = 4; // a term counts at most this many times in the slide text
const MIN_SCORE = 3;
const MIN_LEAD = 1.25; // the winner must beat the runner-up by this factor

const APP_FOLDER = /^slides ?vault$/i;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[_]+/g, ' ');
const count = (re, text) => (text ? (text.match(re) || []).length : 0);

/**
 * @param {{text?: string, title?: string, path?: string}} input
 * @returns {{primary_domain: string, sub_domain: string, tags: string[], confidence: number, scores: Record<string, number>}}
 */
export function classifyByKeywords({ text = '', title = '', path = '' } = {}) {
  // A folder named after the app ("SlidesVault") is where the library lives, not what a deck is about.
  const folders = norm(path).split('/').slice(0, -1).filter((f) => !APP_FOLDER.test(f.trim())).join(' / ');
  const t = norm(title);
  const body = norm(text).slice(0, 60_000);

  const scores = {};
  const subScores = {};
  const hits = {};
  for (const { domain, subs } of MATCHERS) {
    // A folder named after the domain itself ("…/Business/…") counts for the whole domain.
    let domainScore = new RegExp(`(?<![\\p{L}])${escape(domain.toLowerCase())}(?![\\p{L}])`, 'u').test(folders) ? WEIGHT.folder * 2 : 0;
    for (const { sub, terms } of subs) {
      let s = new RegExp(`(?<![\\p{L}])${escape(sub.toLowerCase())}(?![\\p{L}])`, 'u').test(folders) ? WEIGHT.folder : 0;
      for (const { term, re } of terms) {
        const found = count(re, folders) * WEIGHT.folder + count(re, t) * WEIGHT.title + Math.min(TEXT_CAP, count(re, body)) * WEIGHT.text;
        if (found) {
          s += found;
          hits[domain] = [...(hits[domain] || []), term];
        }
      }
      subScores[`${domain}/${sub}`] = s;
      domainScore += s;
    }
    scores[domain] = domainScore;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (bestScore < MIN_SCORE || bestScore < runnerUp * MIN_LEAD) {
    return { primary_domain: '', sub_domain: '', tags: [], confidence: 0, scores };
  }

  const sub = Object.keys(DOMAIN_TAXONOMY[best] ? VOCABULARY[best] : {})
    .map((name) => [name, subScores[`${best}/${name}`] || 0])
    .sort((a, b) => b[1] - a[1])[0];
  const total = ranked.reduce((n, [, v]) => n + v, 0) || 1;
  return {
    primary_domain: best,
    sub_domain: sub && sub[1] > 0 ? sub[0] : '',
    tags: [...new Set(hits[best] || [])].slice(0, 6),
    // Keyword matches are a weaker signal than the AI's reading: keep confidence modest.
    confidence: Math.round(Math.min(0.75, 0.3 + 0.45 * (bestScore / total)) * 100) / 100,
    scores,
  };
}
