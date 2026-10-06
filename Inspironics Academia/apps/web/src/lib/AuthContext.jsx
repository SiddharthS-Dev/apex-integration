import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { APEX_MOUNT, appPath } from '@/lib/mount';

// Only a 401 means the session is gone. Anything else — the API restarting under --watch, the gateway's
// 503 while it boots, a 429 or a 500 — is a hiccup: keep whoever is signed in, and if nobody is known yet,
// try again a few times before treating it as signed out (which, under Apex, hands off to its sign-in).
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const userRef = useRef(null);
  userRef.current = user;

  const refreshUser = useCallback(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const me = await api.auth.me();
        setUser(me);
        setIsLoadingAuth(false);
        return me;
      } catch (e) {
        const signedOut = e?.status === 401;
        if (signedOut || userRef.current || attempt >= RETRY_DELAYS_MS.length) {
          if (signedOut || !userRef.current) setUser(null);
          setIsLoadingAuth(false);
          return signedOut ? null : userRef.current;
        }
        await new Promise((resolve) => { setTimeout(resolve, RETRY_DELAYS_MS[attempt]); });
      }
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  // Standalone, signing out is this app's alone. Under Apex there is one session across every platform,
  // so end this app's, then Apex's (which signs out the others), and land on the Apex sign-in.
  const logout = useCallback(async () => {
    setUser(null);
    if (!APEX_MOUNT) return api.auth.logout(appPath('login'));
    try {
      await api.auth.logout();
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch { /* signing out continues regardless */ }
    window.location.href = '/login';
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isLoadingAuth,
    refreshUser,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
