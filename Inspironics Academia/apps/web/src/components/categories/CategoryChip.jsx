import { cn } from '@/lib/utils';
import { SKILL_LABEL, colorOf, iconOf } from '@/lib/categories';

/** A small coloured label naming a playbook's or course's category. */
export function CategoryChip({ category, className }) {
  if (!category) return null;
  const c = colorOf(category);
  const Icon = iconOf(category);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', c.soft, c.text, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{category.label}</span>
    </span>
  );
}

/** Department, skill level and technologies of a playbook, as quiet badges. */
export function ClassificationBadges({ playbook, max = 3, className }) {
  const tech = playbook.tech_tags || [];
  const parts = [
    playbook.department && { key: 'dept', text: playbook.department },
    playbook.skill_level && { key: 'skill', text: SKILL_LABEL[playbook.skill_level] || playbook.skill_level },
    ...tech.slice(0, max).map((t) => ({ key: `t-${t}`, text: t })),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {parts.map((p) => <span key={p.key} className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.text}</span>)}
      {tech.length > max && <span className="px-1 text-[10px] text-muted-foreground">+{tech.length - max}</span>}
    </div>
  );
}
