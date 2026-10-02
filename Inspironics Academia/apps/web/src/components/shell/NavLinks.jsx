import { NavLink } from 'react-router-dom';
import { Award, BookOpen, Bookmark, ClipboardList, GraduationCap, LayoutDashboard, Library, Shield, User } from 'lucide-react';
import { cn } from '@/lib/utils';

function navItems(isAdmin) {
  const items = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/courses', label: 'Courses', icon: Library },
    { to: isAdmin ? '/admin/playbooks' : '/playbooks', label: 'Playbooks', icon: BookOpen },
    { to: '/my-learning', label: 'My Learning', icon: GraduationCap },
    { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
    { to: '/tests', label: 'Tests', icon: ClipboardList },
    { to: '/certificates', label: 'Certificates', icon: Award },
    { to: '/profile', label: 'Profile', icon: User },
  ];
  if (isAdmin) items.push({ to: '/admin', label: 'Admin', icon: Shield, end: true });
  return items;
}

export default function NavLinks({ isAdmin, onNavigate, vertical = false }) {
  return navItems(isAdmin).map(({ to, label, icon: Icon, end }) => (
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
          <span className={cn('relative', !vertical && 'hidden xl:inline')}>{label}</span>
          {!vertical && isActive && (
            <span aria-hidden="true" className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_0_10px_hsl(252_90%_66%/0.8)]" />
          )}
        </>
      )}
    </NavLink>
  ));
}
