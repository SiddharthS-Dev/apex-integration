import { formatDistanceToNow } from 'date-fns';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttemptTypeBadge, PassBadge } from '@/components/dashboard/AttemptBadges';
import { HeaderLink, Panel, SectionHeader } from '@/components/dashboard/DashParts';

export default function RecentActivity({ attempts, courses }) {
  const recent = attempts.slice(0, 5);
  const courseTitle = (id) => courses.find((c) => c.id === id)?.title || 'Course';

  return (
    <Panel>
      <SectionHeader icon={History} tone="blue" title="Recent Activity" action={recent.length > 0 && <HeaderLink to="/tests">History</HeaderLink>} />
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quiz or test attempts yet.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--dash-line))]">
          {recent.map((a) => (
            <li key={a.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <AttemptTypeBadge type={a.type} />
                  <PassBadge passed={a.passed} />
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {courseTitle(a.course_id)} · {a.created_date ? formatDistanceToNow(new Date(a.created_date), { addSuffix: true }) : ''}
                </div>
              </div>
              <div className={cn('text-base font-semibold tabular-nums', a.passed ? 'text-emerald-600 dark:text-emerald-300' : 'text-foreground')}>
                {Math.round(a.percentage || 0)}%
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
