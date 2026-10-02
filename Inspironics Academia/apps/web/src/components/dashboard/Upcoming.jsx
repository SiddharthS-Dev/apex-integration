import { Link } from 'react-router-dom';
import { Brain, CalendarDays, ChevronRight, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DashEmpty, HeaderLink, IconTile, Panel, SectionHeader } from '@/components/dashboard/DashParts';

const KIND = {
  final: { icon: ClipboardCheck, tone: 'violet' },
  review: { icon: Brain, tone: 'cyan' },
};

export default function Upcoming({ items }) {
  return (
    <Panel>
      <SectionHeader icon={CalendarDays} title="Upcoming" action={<HeaderLink to="/tests">View all</HeaderLink>} />
      {items.length === 0 ? (
        <DashEmpty
          icon={CalendarDays}
          title="You're all caught up"
          description="Final tests you're ready for and flashcard reviews will appear here."
          className="py-6"
        />
      ) : (
        <ul className="-mx-2 divide-y divide-[hsl(var(--dash-line))]">
          {items.slice(0, 5).map((item) => {
            const { icon, tone } = KIND[item.kind];
            return (
              <li key={item.key}>
                <Link to={item.to} className="group flex items-center gap-3 px-2 py-3 rounded-xl transition-colors hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <IconTile icon={icon} tone={tone} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug line-clamp-2">{item.title}</div>
                    <div className={cn('text-xs mt-0.5', item.due || item.kind === 'final' ? 'text-orange-600 dark:text-orange-300' : 'text-muted-foreground')}>
                      {item.when}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
