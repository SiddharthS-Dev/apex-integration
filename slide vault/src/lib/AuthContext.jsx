import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getClient } from '@/api/base44Client';
import { recordLogin } from '@/lib/analytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const loginWithGoogle = useCallback(async () => {
    const client = await getClient();
    const me = await client.auth.loginWithGoogle?.();
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
      isAdmin: user?.role === 'admin',
      refresh,
      login,
      loginWithGoogle,
      register,
      verifyOtp,
      logout,
    }),
    [user, loading, error, refresh, login, loginWithGoogle, register, verifyOtp, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}

export default AuthContext;
