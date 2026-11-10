import { NavLink } from 'react-router-dom';
import { Award, BookOpen, Bookmark, BrainCircuit, ClipboardList, GraduationCap, LayoutDashboard, Library, Presentation, Shield, User, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReviewQueue } from '@/lib/retention';

function navItems(isAdmin) {
  const items = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/courses', label: 'Courses', icon: Library },
    { to: isAdmin ? '/admin/playbooks' : '/playbooks', label: 'Playbooks', icon: BookOpen },
    { to: '/my-learning', label: 'My Learning', icon: GraduationCap },
    { to: '/review', label: 'Review', icon: BrainCircuit, badge: 'review' },
    { to: '/meetings', label: 'Meetings', icon: Presentation },
    { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark, compact: true },
    { to: '/tests', label: 'Tests', icon: ClipboardList, compact: true },
    { to: '/certificates', label: 'Certificates', icon: Award, compact: true },
    { to: '/profile', label: 'Profile', icon: User, compact: true },
  ];
  if (isAdmin) items.push({ to: '/admin/ai-studio', label: 'AI Studio', icon: Wand2, compact: true }, { to: '/admin', label: 'Admin', icon: Shield, end: true });
  return items;
}

export default function NavLinks({ isAdmin, onNavigate, vertical = false }) {
  const { data: queue } = useReviewQueue();
  const counts = { review: queue ? queue.due.length + queue.new.length : 0 };
  // In the top bar, `compact` items show only their icon (title = tooltip) until the widest screens,
  // so every item, Admin included, fits on a 1366px laptop.
  return navItems(isAdmin).map(({ to, label, icon: Icon, end, badge, compact }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-1.5 2xl:gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-200',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
          vertical ? 'px-3 py-2.5' : 'h-16 px-2.5 xl:px-2 2xl:px-3',
          isActive
            ? 'text-primary dark:text-violet-300'
            : 'text-muted-foreground hover:text-foreground',
          vertical && (isActive ? 'bg-primary/10' : 'hover:bg-muted'),
        )
      }
    >
      {({ isActive }) => (
        <>
          {!vertical && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-1 inset-y-3 rounded-lg transition-colors duration-200',
                isActive ? 'bg-primary/10 dark:bg-violet-500/15' : 'group-hover:bg-muted/70',
              )}
            />
          )}
          <Icon className="relative w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
          <span className={cn('relative', !vertical && (compact ? 'hidden 2xl:inline' : 'hidden xl:inline'))}>{label}</span>
          {badge && counts[badge] > 0 && (
            <span
              aria-label={`${counts[badge]} due`}
              className={cn(
                'relative min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-orange-500 text-white text-[10px] font-semibold leading-[1.125rem] text-center tabular-nums',
                !vertical && 'absolute xl:relative top-3 right-0.5 xl:top-auto xl:right-auto',
              )}
            >
              {counts[badge] > 99 ? '99+' : counts[badge]}
            </span>
          )}
          {!vertical && isActive && (
            <span aria-hidden="true" className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_0_10px_hsl(252_90%_66%/0.8)]" />
          )}
        </>
      )}
    </NavLink>
  ));
}
