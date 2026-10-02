import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { APEX_MOUNT } from '@/lib/mount';

// The app's own sign-in pages: returning to one after the Apex sign-in would only hand off again.
const AUTH_PAGES = new Set(['/login', '/register']);

// Under the Apex gateway there is one sign-in, and it is Apex's: signing in there opens every platform
// at once, with the one shared account. So reaching this app's own login (or register, or a protected
// page) signed out under Apex means its session is gone — signed out, or lapsed — and the browser is
// handed to the Apex sign-in. reauth=1 has Apex sign out everything first, so its form issues every
// session afresh instead of bouncing straight back here.
export default function ApexHandoff() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { pathname, search } = useLocation();
  const away = !isLoadingAuth && !isAuthenticated;

  useEffect(() => {
    if (!away) return;
    const back = AUTH_PAGES.has(pathname) ? '' : `${pathname.replace(/^\/+/, '')}${search}`;
    window.location.replace(`/login?reauth=1&next=${encodeURIComponent(`${APEX_MOUNT}${back}`)}`);
  }, [away, pathname, search]);

  // Already signed in (someone opened /academia/login by hand): nothing to hand off.
  if (!isLoadingAuth && isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Taking you to the Apex sign-in…</p>
      </div>
    </div>
  );
}
