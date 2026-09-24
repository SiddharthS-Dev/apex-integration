import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getClient } from '@/api/base44Client';
import { recordLogin } from '@/lib/analytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which sign-in methods the backend actually offers. Assumed off until the
  // backend says otherwise, so a method that cannot work is never advertised.
  const [capabilities, setCapabilities] = useState({ password: true, google: false });

  const refresh = useCallback(async () => {
    try {
      const client = await getClient();
      const me = await client.auth.me();
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getClient();
        const caps = await client.auth.capabilities?.();
        if (!cancelled && caps) setCapabilities({ password: true, google: false, ...caps });
      } catch {
        // Leave the defaults: password only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (credentials) => {
      setError(null);
      const client = await getClient();
      const me = await client.auth.login(credentials);
      setUser(me);
      recordLogin();
      return me;
    },
    []
  );

  const loginWithGoogle = useCallback(async (nextPath) => {
    const client = await getClient();
    // On a redirect-based backend this never returns — the browser leaves.
    const me = await client.auth.loginWithGoogle?.(nextPath);
    if (me) {
      setUser(me);
      recordLogin();
    }
    return me;
  }, []);

  const register = useCallback(async (payload) => {
    const client = await getClient();
    return client.auth.register(payload);
  }, []);

  const verifyOtp = useCallback(async (payload) => {
    const client = await getClient();
    const me = await client.auth.verifyOtp(payload);
    setUser(me);
    recordLogin();
    return me;
  }, []);

  const logout = useCallback(async () => {
    const client = await getClient();
    await client.auth.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      setError,
      isAuthenticated: Boolean(user),
      capabilities,
      googleEnabled: capabilities.google === true,
      isAdmin: user?.role === 'admin',
      refresh,
      login,
      loginWithGoogle,
      register,
      verifyOtp,
      logout,
    }),
    [user, loading, error, capabilities, refresh, login, loginWithGoogle, register, verifyOtp, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}

export default AuthContext;
