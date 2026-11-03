import { useQuery } from '@tanstack/react-query';
import { BookOpen, Briefcase, Building2, Compass, GraduationCap, ShieldCheck, Inbox } from 'lucide-react';
import { AUDIENCES, DEFAULT_CATEGORIES, SKILL_LEVELS, UNCLASSIFIED } from '@academy/shared';
import { api } from '@/api/client';

// Playbook categories on the web side: the category list, each category's look, and the counts its
// card shows. Which categories a user sees is decided by the API (by audience); the web only labels
// and groups what it receives.

export { UNCLASSIFIED };

/** PlaybookCategory rows sorted for display; falls back to the built-ins while loading. */
export function useCategories() {
  const query = useQuery({
    queryKey: ['playbook-categories'],
    queryFn: () => api.entities.PlaybookCategory.list('order', 200),
    staleTime: 60_000,
  });
  const list = (query.data?.length ? query.data : DEFAULT_CATEGORIES)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.label).localeCompare(String(b.label)));
  return { ...query, categories: list };
}

// Each colour: the solid identity mark, a soft surface, readable text on light and dark, and a ring.
export const COLORS = {
  teal: { dot: 'bg-teal-500', soft: 'bg-teal-500/10', text: 'text-teal-700 dark:text-teal-300', ring: 'ring-teal-500/40', border: 'border-teal-500/50', gradient: 'from-teal-500 to-emerald-500' },
  indigo: { dot: 'bg-indigo-500', soft: 'bg-indigo-500/10', text: 'text-indigo-700 dark:text-indigo-300', ring: 'ring-indigo-500/40', border: 'border-indigo-500/50', gradient: 'from-indigo-500 to-blue-600' },
  purple: { dot: 'bg-purple-600', soft: 'bg-purple-500/10', text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-500/40', border: 'border-purple-500/50', gradient: 'from-purple-600 to-indigo-950' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-500/40', border: 'border-amber-500/50', gradient: 'from-amber-500 to-orange-600' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-500/10', text: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-500/40', border: 'border-rose-500/50', gradient: 'from-rose-500 to-pink-600' },
  sky: { dot: 'bg-sky-500', soft: 'bg-sky-500/10', text: 'text-sky-700 dark:text-sky-300', ring: 'ring-sky-500/40', border: 'border-sky-500/50', gradient: 'from-sky-500 to-cyan-600' },
  slate: { dot: 'bg-slate-400', soft: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-300', ring: 'ring-slate-400/40', border: 'border-slate-400/50', gradient: 'from-slate-400 to-slate-600' },
};
export const COLOR_KEYS = ['teal', 'indigo', 'purple', 'amber', 'rose', 'sky'];

export const ICONS = { graduation: GraduationCap, building: Building2, compass: Compass, book: BookOpen, briefcase: Briefcase, shield: ShieldCheck };
export const ICON_KEYS = Object.keys(ICONS);

export const colorOf = (category) => COLORS[category?.color] || COLORS.slate;
export const iconOf = (category) => (category?.key === UNCLASSIFIED ? Inbox : ICONS[category?.icon] || BookOpen);

/** The pseudo-category for documents an admin has not classified yet. */
export const UNCLASSIFIED_CATEGORY = {
  key: UNCLASSIFIED,
  label: 'Unclassified',
  audience_label: 'Awaiting review',
  description: 'New documents no one has assigned yet. Only administrators see them until they are classified.',
  color: 'slate',
  audiences: [],
};

/** The category a playbook (or course) belongs to; missing → unclassified. */
export const categoryKey = (record) => (record?.category && String(record.category).trim()) || UNCLASSIFIED;

export function findCategory(categories, key) {
  if (key === UNCLASSIFIED) return UNCLASSIFIED_CATEGORY;
  return categories.find((c) => c.key === key) || { key, label: key, color: 'slate', audiences: [] };
}

export const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES.map((a) => [a.key, a.label]));
export const SKILL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
export { AUDIENCES, SKILL_LEVELS };

const tally = (values) => {
  const m = new Map();
  for (const v of values) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
};

/**
 * What a category card shows, from the records the caller can see: playbooks, extracted chapters
 * (sum of chapter_count), courses (non-archived), and its most common technologies and departments.
 */
export function categoryStats(playbooks = [], courses = []) {
  const ids = new Set(playbooks.map((p) => p.id));
  return {
    playbooks: playbooks.length,
    chapters: playbooks.reduce((n, p) => n + (Number(p.chapter_count) || 0), 0),
    courses: courses.filter((c) => ids.has(c.playbook_id) && c.status !== 'archived').length,
    tech: tally(playbooks.flatMap((p) => p.tech_tags || [])).slice(0, 4),
    departments: tally(playbooks.map((p) => p.department)).slice(0, 3),
  };
}

/** Distinct values for the filter menus. */
export function filterOptions(playbooks = []) {
  return {
    departments: tally(playbooks.map((p) => p.department)).map((t) => t.name),
    tech: tally(playbooks.flatMap((p) => p.tech_tags || [])).map((t) => t.name),
  };
}

export const SORTS = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'added', label: 'Recently added' },
  { key: 'title', label: 'Title A–Z' },
];

/** Search + department/technology/skill filters + sort, applied to playbooks. */
export function filterPlaybooks(playbooks, { q = '', department = 'all', tech = 'all', skill = 'all', sort = 'updated' } = {}) {
  const term = q.trim().toLowerCase();
  const hay = (p) => [p.title, p.file_name, p.dropbox_path, p.department, ...(p.tags || []), ...(p.tech_tags || [])].join(' ').toLowerCase();
  return playbooks
    .filter((p) => !term || hay(p).includes(term))
    .filter((p) => department === 'all' || p.department === department)
    .filter((p) => tech === 'all' || (p.tech_tags || []).includes(tech))
    .filter((p) => skill === 'all' || p.skill_level === skill)
    .sort((a, b) => {
      if (sort === 'title') return String(a.title).localeCompare(String(b.title));
      const key = sort === 'added' ? 'created_date' : 'updated_date';
      return String(b[key] || '').localeCompare(String(a[key] || ''));
    });
}
