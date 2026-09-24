import { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Compass, LayoutDashboard, BookOpen, Download, FileText, Settings, Cloud, Search, Sun, Moon, ArrowLeft,
} from 'lucide-react';
import UserProfileChip from '@/components/UserProfileChip';
import AiCopilot from '@/components/AiCopilot';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/useTheme';
import { cn } from '@/lib/utils';

const BASE_NAV = [
  { to: '/', label: 'Home', icon: Compass, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/offline', label: 'Downloads', icon: Download },
  { to: '/user-manual', label: 'Manual', icon: FileText },
];

const ADMIN_NAV = [
  { to: '/admin', label: 'Admin', icon: Settings },
  { to: '/dropbox-settings', label: 'Dropbox', icon: Cloud },
];

/*
 * Where the Apex dashboard lives, or null when this app runs on its own.
 *
 * Under Apex the router's basename is '/vault/', so the dashboard is reached
 * with a plain anchor to '/' — deliberately outside the router. Standalone,
 * '/' is this app's own home, so there is nothing to link back to.
 */
const APEX_HOME = import.meta.env.BASE_URL === '/' ? null : '/';

function NavItem({ item, active, compact = false }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={cn(
        'relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'text-white' : 'text-muted-foreground hover:text-foreground',
        compact && 'text-xs'
      )}
    >
      {active && (
        <motion.span
          layoutId={compact ? 'nav-active-mobile' : 'nav-active'}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 shadow-lg shadow-violet-600/25"
        />
      )}
      <Icon className={cn('relative shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      <span className="relative">{item.label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { pathname } = useLocation();

  const nav = useMemo(
    () => (user?.role === 'admin' ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV),
    [user?.role]
  );

  const isActive = (item) => (item.end ? pathname === item.to : pathname.startsWith(item.to));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 glass-strong">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6">
          {APEX_HOME && (
            <a
              href={APEX_HOME}
              title="Back to the Apex dashboard"
              className="hidden h-9 shrink-0 items-center gap-1.5 rounded-full glass px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Apex</span>
            </a>
          )}

          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Inspironics" className="h-full w-full object-contain" />
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold tracking-tight">Inspironics SlidesVault</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Presentation Knowledge Hub
              </span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="mx-auto hidden items-center gap-0.5 rounded-full glass p-1 lg:flex">
            {nav.map((item) => (
              <NavItem key={item.to} item={item} active={isActive(item)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
            <Link
              to="/library"
              className="hidden h-9 items-center gap-2 rounded-full glass px-3 text-xs text-muted-foreground transition-colors hover:text-foreground md:flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search…</span>
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <UserProfileChip />
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-3 py-2 no-scrollbar lg:hidden">
          {nav.map((item) => (
            <NavItem key={item.to} item={item} active={isActive(item)} compact />
          ))}
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto flex max-w-[1500px] flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} Inspironics · SlidesVault</p>
          <p>Streaming-only viewing · Downloads stay inside the app sandbox</p>
        </div>
      </footer>

      <AiCopilot />
    </div>
  );
}
