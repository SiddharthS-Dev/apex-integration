import { Code2, Package, Briefcase, Users, FlaskConical, Layers } from 'lucide-react';

/**
 * The five business domains. Every domain carries a gradient (cards, hero blocks,
 * chart bars), a solid colour, a text colour and a ring colour so the palette stays
 * identical everywhere the domain is rendered.
 */
export const DOMAINS = {
  Engineering: {
    name: 'Engineering',
    gradient: 'from-blue-500 to-cyan-500',
    solid: 'bg-blue-500',
    hex: '#3b82f6',
    text: 'text-blue-400',
    ring: 'ring-blue-500/30',
    border: 'border-blue-500/30',
    icon: Code2,
    subDomains: ['Architecture', 'Backend', 'Frontend', 'DevOps', 'AI'],
  },
  Products: {
    name: 'Products',
    gradient: 'from-violet-500 to-purple-500',
    solid: 'bg-violet-500',
    hex: '#8b5cf6',
    text: 'text-violet-400',
    ring: 'ring-violet-500/30',
    border: 'border-violet-500/30',
    icon: Package,
    subDomains: ['FleetExplorer', 'Discipline Engine', 'Insight Flow', 'SlidesVault', 'ESG', 'CK'],
  },
  Business: {
    name: 'Business',
    gradient: 'from-amber-500 to-orange-500',
    solid: 'bg-amber-500',
    hex: '#f59e0b',
    text: 'text-amber-400',
    ring: 'ring-amber-500/30',
    border: 'border-amber-500/30',
    icon: Briefcase,
    subDomains: ['Operations', 'Sales', 'Marketing', 'Finance', 'Customer Success'],
  },
  'Human Resources': {
    name: 'Human Resources',
    gradient: 'from-rose-500 to-pink-500',
    solid: 'bg-rose-500',
    hex: '#f43f5e',
    text: 'text-rose-400',
    ring: 'ring-rose-500/30',
    border: 'border-rose-500/30',
    icon: Users,
    subDomains: ['Onboarding', 'Policies', 'Training', 'Performance', 'Recruitment'],
  },
  'Research & Innovation': {
    name: 'Research & Innovation',
    gradient: 'from-emerald-500 to-teal-500',
    solid: 'bg-emerald-500',
    hex: '#10b981',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/30',
    border: 'border-emerald-500/30',
    icon: FlaskConical,
    subDomains: ['AI Research', 'IoT', 'Knowledge Base', 'Sustainability', 'Future Concepts'],
  },
};

export const DOMAIN_NAMES = Object.keys(DOMAINS);

export const FALLBACK_DOMAIN = {
  name: 'Uncategorized',
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
