import { Code2, Package, Briefcase, Users, FlaskConical, Layers } from 'lucide-react';
import { DOMAIN_TAXONOMY, DOMAIN_NAMES, FALLBACK_DOMAIN_NAME } from '@slidesvault/shared';

/**
 * The palette for each business domain — gradient (cards, hero blocks, chart
 * bars), solid colour, text colour and ring colour, so a domain looks the same
 * everywhere it is rendered.
 *
 * Only presentation lives here. The domain names and their sub-domains come
 * from @slidesvault/shared, because the API classifies against that same list
 * and a domain the UI does not know about renders blank.
 */
const DOMAIN_STYLE = {
  Engineering: {
    gradient: 'from-blue-500 to-cyan-500',
    solid: 'bg-blue-500',
    hex: '#3b82f6',
    text: 'text-blue-400',
    ring: 'ring-blue-500/30',
    border: 'border-blue-500/30',
    icon: Code2,
  },
  Products: {
    gradient: 'from-violet-500 to-purple-500',
    solid: 'bg-violet-500',
    hex: '#8b5cf6',
    text: 'text-violet-400',
    ring: 'ring-violet-500/30',
    border: 'border-violet-500/30',
    icon: Package,
  },
  Business: {
    gradient: 'from-amber-500 to-orange-500',
    solid: 'bg-amber-500',
    hex: '#f59e0b',
    text: 'text-amber-400',
    ring: 'ring-amber-500/30',
    border: 'border-amber-500/30',
    icon: Briefcase,
  },
  'Human Resources': {
    gradient: 'from-rose-500 to-pink-500',
    solid: 'bg-rose-500',
    hex: '#f43f5e',
    text: 'text-rose-400',
    ring: 'ring-rose-500/30',
    border: 'border-rose-500/30',
    icon: Users,
  },
  'Research & Innovation': {
    gradient: 'from-emerald-500 to-teal-500',
    solid: 'bg-emerald-500',
    hex: '#10b981',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/30',
    border: 'border-emerald-500/30',
    icon: FlaskConical,
  },
};

/** Name + sub-domains from the shared taxonomy, joined to the local palette. */
export const DOMAINS = Object.fromEntries(
  DOMAIN_NAMES.map((name) => [
    name,
    { name, subDomains: DOMAIN_TAXONOMY[name], ...DOMAIN_STYLE[name] },
  ])
);

export { DOMAIN_NAMES };

export const FALLBACK_DOMAIN = {
  name: FALLBACK_DOMAIN_NAME,
  gradient: 'from-slate-500 to-slate-600',
  solid: 'bg-slate-500',
  hex: '#64748b',
  text: 'text-slate-400',
  ring: 'ring-slate-500/30',
  border: 'border-slate-500/30',
  icon: Layers,
  subDomains: [],
};

export function getDomain(name) {
  return DOMAINS[name] || FALLBACK_DOMAIN;
}

export function domainGradient(name) {
  return getDomain(name).gradient;
}

export function domainHex(name) {
  return getDomain(name).hex;
}

export function subDomainsFor(name) {
  return getDomain(name).subDomains;
}

/** The taxonomy string handed to the classifier prompt in syncDropbox. */
export const TAXONOMY_PROMPT = DOMAIN_NAMES.map(
  (d, i) => `${i + 1}. ${d} -> [${DOMAINS[d].subDomains.join(', ')}]`
).join('\n');

export const FILE_TYPES = ['pdf', 'pptx', 'html', 'docx', 'xlsx', 'mp4'];

export const FILE_TYPE_STYLE = {
  pdf: 'bg-red-500/15 text-red-400 ring-red-500/25',
  pptx: 'bg-orange-500/15 text-orange-400 ring-orange-500/25',
  html: 'bg-sky-500/15 text-sky-400 ring-sky-500/25',
  docx: 'bg-blue-500/15 text-blue-400 ring-blue-500/25',
  xlsx: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
  mp4: 'bg-fuchsia-500/15 text-fuchsia-400 ring-fuchsia-500/25',
};

export const HERO_GRADIENT = 'bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600';
