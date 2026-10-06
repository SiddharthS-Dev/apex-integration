import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { backendMode, getClient } from '@/api/base44Client';
import { recordLogin } from '@/lib/analytics';
import { deleteLegacyOfflineData, deleteOfflineData, setOfflineOwner } from '@/lib/offline-db';
import { registerServiceWorker } from '@/lib/serviceWorker';

const AuthContext = createContext(null);

/**
 * The last signed-in user, so the app can start with no network — the
 * offline library is the point of the app, and it is useless if a cold start
 * on a train cannot get past the session check. Display fields only: nothing
 * here grants anything, since every request is still authorised server-side.
 */
const LAST_USER_KEY = 'sv-last-user';
/** Whose offline database exists in this browser — outlives a lapsed session. */
const OFFLINE_OWNER_KEY = 'sv-offline-owner';
const RETRY_MS = 15_000;

/** Set when the Apex gateway mounts this app (BASE_URL '/vault/'), null standalone. */
const APEX_MOUNT =
  import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/' ? import.meta.env.BASE_URL : null;

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

function readLastUser() {
  try {
    const value = JSON.parse(storage.get(LAST_USER_KEY) || 'null');
    return value?.id ? value : null;
  } catch {
    return null;
  }
}

function writeLastUser(user) {
  if (!user?.id) {
    storage.set(LAST_USER_KEY, null);
    return;
  }
  const { id, email, full_name, role } = user;
  storage.set(LAST_USER_KEY, JSON.stringify({ id, email, full_name, role }));
}

/**
 * Binds the offline library to whoever is signed in. A different person
 * signing in on this browser removes the previous person's downloads.
 */
function adoptOfflineOwner(user) {
  if (!user?.id) return;
  const previous = storage.get(OFFLINE_OWNER_KEY);
  if (previous && previous !== String(user.id)) deleteOfflineData(previous);
  deleteLegacyOfflineData();
  storage.set(OFFLINE_OWNER_KEY, String(user.id));
  setOfflineOwner(user.id);
  writeLastUser(user);
  // After a confirmed sign-in: under Apex the worker script is behind the
  // gateway session, and the offline shell is only useful to a signed-in user.
  registerServiceWorker();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which sign-in methods the backend actually offers. Assumed off until the
  // backend says otherwise, so a method that cannot work is never advertised.
  const [capabilities, setCapabilities] = useState({ password: true, google: false });

  // Set when the session could not be checked at all and there is no user to
  // fall back on — "unknown", which is not the same as "signed out".
  const [unreachable, setUnreachable] = useState(false);
  // A deployment problem (no backend configured, SDK failed to load): shown,
  // never papered over with a demo backend.
  const [backendError, setBackendError] = useState(null);

  const userRef = useRef(null);
  const retryTimer = useRef(null);

  const applyUser = useCallback((next) => {
    userRef.current = next;
    setUser(next);
  }, []);

  /**
   * Asks the backend who is signed in.
   *
   * Only an explicit "not signed in" (HTTP 401, which me() reports as null)
   * ends the session here. Anything else — no network, a 5xx, the API
   * restarting behind the gateway — says nothing about the session, so the
   * current user is kept and the check is retried later. Treating those as a
   * sign-out used to bounce everyone to the sign-in page whenever the API
   * blinked.
   */
  const refresh = useCallback(async () => {
    clearTimeout(retryTimer.current);
    try {
      const client = await getClient();
      const me = await client.auth.me();
      if (me) adoptOfflineOwner(me);
      else {
        // Signed out (or the session lapsed). The offline copies stay, scoped
        // to their owner, until that person signs out or someone else signs in.
        setOfflineOwner(null);
        writeLastUser(null);
      }
      applyUser(me ?? null);
      setUnreachable(false);
      return me ?? null;
    } catch (err) {
      if (err?.status === 401) {
        setOfflineOwner(null);
        writeLastUser(null);
        applyUser(null);
        setUnreachable(false);
        return null;
      }
      if (err?.code === 'BACKEND_UNAVAILABLE') {
        setBackendError(err.message);
        return null;
      }
      console.warn('[auth] session check failed; keeping the current session', err);
      // A cold start with no network: carry on as the last known user so the
      // offline library still opens.
      const fallback = userRef.current ?? readLastUser();
      if (fallback) {
        setOfflineOwner(fallback.id);
        applyUser(fallback);
      }
      setUnreachable(!fallback);
      retryTimer.current = setTimeout(() => refresh(), RETRY_MS);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    refresh();
    const onOnline = () => refresh();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      clearTimeout(retryTimer.current);
    };
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
      adoptOfflineOwner(me);
      applyUser(me);
      recordLogin();
      return me;
    },
    [applyUser]
  );

  const loginWithGoogle = useCallback(async (nextPath) => {
    const client = await getClient();
    // On a redirect-based backend this never returns — the browser leaves.
    const me = await client.auth.loginWithGoogle?.(nextPath);
    if (me) {
      adoptOfflineOwner(me);
      applyUser(me);
      recordLogin();
    }
    return me;
  }, [applyUser]);

  const register = useCallback(async (payload) => {
    const client = await getClient();
    return client.auth.register(payload);
  }, []);

  const verifyOtp = useCallback(async (payload) => {
    const client = await getClient();
    const me = await client.auth.verifyOtp(payload);
    adoptOfflineOwner(me);
    applyUser(me);
    recordLogin();
    return me;
  }, [applyUser]);

  const logout = useCallback(async () => {
    const client = await getClient();
    // Signing out is "this browser should forget me": the downloads and the
    // reading history go too, before the backend round trip that may leave
    // the page.
    const signedOut = userRef.current?.id ?? storage.get(OFFLINE_OWNER_KEY);
    setOfflineOwner(null);
    writeLastUser(null);
    storage.set(OFFLINE_OWNER_KEY, null);
    if (signedOut) await deleteOfflineData(signedOut);
    applyUser(null);

    if (!APEX_MOUNT) {
      await client.auth.logout();
      return;
    }

    // Under the Apex gateway "Sign out" ends the whole Apex session, not just
    // this app's: our own session first, then the gateway's (a same-origin
    // POST — the gateway checks Origin/Referer), then the Apex sign-in page.
    // Each step is attempted even if the one before it failed, so a sick API
    // cannot leave the gateway session signed in.
    try {
      await client.auth.logout();
    } catch (err) {
      console.warn('[auth] SlidesVault sign-out failed; ending the Apex session anyway', err);
    }
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.warn('[auth] Apex sign-out request failed', err);
    }
    window.location.replace('/login');
    // The page is being replaced; never settle, so the caller does not
    // navigate inside the app during the hand-off.
    await new Promise(() => {});
  }, [applyUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      setError,
      isAuthenticated: Boolean(user),
      unreachable,
      backendError,
      capabilities,
      googleEnabled: capabilities.google === true,
      // The API server says whether its AI is configured; the demo backend
      // simulates the Copilot and Base44 hosts the model, so both have one.
      aiEnabled: backendMode === 'api' ? capabilities.ai === true : backendMode !== 'none',
      isAdmin: user?.role === 'admin',
      refresh,
      login,
      loginWithGoogle,
      register,
      verifyOtp,
      logout,
    }),
    [user, loading, error, unreachable, backendError, capabilities, refresh, login, loginWithGoogle, register, verifyOtp, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}

export default AuthContext;
