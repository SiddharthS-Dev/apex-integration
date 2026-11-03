import { BookOpen, GraduationCap, Layers, Library } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UNCLASSIFIED, colorOf, iconOf } from '@/lib/categories';

// The category tabs at the top of a playbook dashboard: one tile per category with who it is for, a
// short description, and its counts (playbooks, extracted chapters, courses) plus the technologies
// it covers most. Selecting a tile shows only that category's playbooks. Numbers wear text colours;
// the category's colour marks identity only (the band and the icon).

function Count({ icon: Icon, value, label }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-base font-semibold tabular-nums text-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {value.toLocaleString()}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Tile({ category, stats, selected, onSelect }) {
  const c = colorOf(category);
  const Icon = iconOf(category);
  const unclassified = category.key === UNCLASSIFIED;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(category.key)}
      className={cn(
        'group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        selected ? cn('ring-2', c.ring, c.border) : 'border-border hover:border-primary/30',
        unclassified && !selected && 'border-dashed',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', c.gradient)} />
      <div className="flex items-start gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm bg-gradient-to-br', c.gradient)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className={cn('text-[11px] font-semibold uppercase tracking-wider', c.text)}>{category.audience_label || 'Category'}</div>
          <h3 className="truncate font-semibold leading-snug">{category.label}</h3>
        </div>
      </div>
      {category.description && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{category.description}</p>}
      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3">
        <Count icon={Library} value={stats.playbooks} label={unclassified ? 'to review' : 'playbooks'} />
        <Count icon={Layers} value={stats.chapters} label="chapters" />
        <Count icon={GraduationCap} value={stats.courses} label="courses" />
      </div>
      {stats.tech?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Most covered technologies">
          <BookOpen className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          {stats.tech.map((t) => (
            <span key={t.name} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t.name}</span>
          ))}
        </div>
      )}
    </button>
  );
}

/**
 * tiles: [{ category, stats }]; selected: category key or 'all'. `allTile` adds an "All" tab first.
 */
export default function CategoryTiles({ tiles, selected, onSelect, allTile = null }) {
  return (
    <div role="tablist" aria-label="Playbook categories" className="space-y-3">
      <div className={cn('grid gap-3 sm:grid-cols-2', tiles.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>
        {tiles.map((t) => (
          <Tile key={t.category.key} category={t.category} stats={t.stats} selected={selected === t.category.key} onSelect={onSelect} />
        ))}
      </div>
      {allTile && (
        <button
          type="button"
          role="tab"
          aria-selected={selected === 'all'}
          onClick={() => onSelect('all')}
          className={cn(
            'text-sm font-medium underline-offset-4 hover:underline',
            selected === 'all' ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {allTile}
        </button>
      )}
    </div>
  );
}
