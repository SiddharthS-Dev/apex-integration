import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, GraduationCap, LogOut, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import NavLinks from '@/components/shell/NavLinks';
import ThemeToggle from '@/components/shell/ThemeToggle';
import UserBadge from '@/components/shell/UserBadge';
import DemoBanner from '@/components/shell/DemoBanner';
import DropboxSyncButton from '@/components/shell/DropboxSyncButton';
import { APEX_MOUNT } from '@/lib/mount';

export default function AppShell({ children }) {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl no-print">
        <DemoBanner />
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3 2xl:gap-6">
          {/* Back to the Apex dashboard — a plain anchor to '/', outside the router. Standalone, '/' is this app. */}
          {APEX_MOUNT && (
            <a
              href="/"
              title="Back to the Apex dashboard"
              className="hidden sm:flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Apex</span>
            </a>
          )}
          <Link to="/dashboard" className="group flex items-center gap-2.5 shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/30 transition-transform group-hover:scale-105">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold tracking-tight text-[17px]">Inspironics Learn</span>
          </Link>
          <nav aria-label="Main" className="hidden lg:flex items-center self-stretch flex-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
            <NavLinks isAdmin={isAdmin} />
          </nav>
          <div className="flex items-center gap-1 sm:gap-2 ml-auto">
            {isAdmin && <DropboxSyncButton />}
            <ThemeToggle />
            <UserBadge user={user} onLogout={logout} />
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
              {open ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {open && (
          <nav aria-label="Main" className="lg:hidden border-t border-border px-4 py-3 grid gap-1 max-h-[calc(100vh-4rem)] overflow-y-auto">
            <NavLinks isAdmin={isAdmin} onNavigate={() => setOpen(false)} vertical />
            <button onClick={logout} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </nav>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
