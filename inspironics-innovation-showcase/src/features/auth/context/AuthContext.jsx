import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { storageKeys } from '#shared/config'
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

    sync()
    setReady(true)

    const timer = setInterval(sync, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && sync()
    const onStorage = (e) => {
      if (e.key === null || e.key === storageKeys.authSession) sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', sync)
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const logout = useCallback(() => {
    api.logout()
    setSession(null)
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
