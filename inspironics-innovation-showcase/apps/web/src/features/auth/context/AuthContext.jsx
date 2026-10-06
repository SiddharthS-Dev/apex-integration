import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { baseUrl, env, storageKeys } from '#shared/config'
import { api } from '../api/authService.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    const s = api.getSession()
    return s && s.expiresAt > Date.now() ? s : null
  })
  const [ready, setReady] = useState(false)

  /*
   * Expiry used to be checked only at mount, so a session that lapsed while
   * the tab sat open stayed usable indefinitely. Re-check on a timer, whenever
   * the tab comes back to the foreground, and whenever another tab changes the
   * stored session — which also makes signing out (or in) propagate across
   * tabs instead of leaving them disagreeing.
   */
  useEffect(() => {
    const sync = () => {
      const stored = api.getSession()
      const live = stored && stored.expiresAt > Date.now() ? stored : null
      if (!live && stored) api.logout()
      setSession((current) => {
        if (!live) return current === null ? current : null
        if (current && current.issuedAt === live.issuedAt) return current
        return live
      })
    }

    /*
     * With the API backend the stored session is only a mirror of the httpOnly
     * cookie, so the server has the last word: re-ask it at start-up and on
     * refocus. Rendering waits for the first answer, so a revoked session
     * never flashes the showcase before bouncing to sign-in.
     */
    const confirm = async () => {
      if (api.refresh) await api.refresh()
      sync()
    }

    sync()
    if (api.refresh) confirm().finally(() => setReady(true))
    else setReady(true)

    const timer = setInterval(sync, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && confirm()
    const onStorage = (e) => {
      if (e.key === null || e.key === storageKeys.authSession || e.key === storageKeys.apiSession) sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', confirm)
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', confirm)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  /*
   * The Sign out button. Standalone it ends this app's session and the caller
   * navigates. Under the Apex gateway (mounted at a base other than '/') it
   * ends the whole Apex session: this app's cookie first, then the gateway's
   * own (POST /auth/logout, same-origin so the browser sends Origin), then the
   * Apex sign-in. Resolves true when it has navigated away itself. The session
   * is not cleared in React state on that path, or ProtectedRoute would race
   * it to the reauth hand-off.
   */
  const logout = useCallback(async () => {
    if (baseUrl !== '/' && env.backend === 'api') {
      await api.logout()
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
      window.location.replace('/login')
      return true
    }
    api.logout()
    setSession(null)
    return false
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isGuest: !!session?.isGuest,
      ready,
      setSession,
      logout,
    }),
    [session, ready, logout]
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Gates the showcase behind a session, remembering where the visitor was headed. */
export function ProtectedRoute({ children }) {
  const { session, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <div className="h-10 w-10 animate-spinSlow rounded-full border-2 border-white/10 border-t-cyan-glow" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

/** ProtectedRoute plus an administrator check. The server enforces the same rule on every admin endpoint. */
export function AdminRoute({ children }) {
  const { session } = useAuth()
  return <ProtectedRoute>{session?.user?.role === 'admin' ? children : <Navigate to="/" replace />}</ProtectedRoute>
}
