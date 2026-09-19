import { Suspense, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, ProtectedRoute } from '#features/auth'
import Loader from '#shared/ui/Loader'
import ErrorBoundary from '#shared/ui/ErrorBoundary'
import { installGlobalErrorReporting } from '#shared/lib/reporter.js'
import { useDocumentTitle } from '#shared/lib/useDocumentTitle.js'
import { routes } from './routes.jsx'

/**
 * Wraps one route: its title, and the auth gate if it needs one.
 * @param {import('#shared/lib/routeSpec.js').RouteSpec} route
 */
function RouteView({ Component, title, protected: isProtected }) {
  useDocumentTitle(title)
  return isProtected ? (
    <ProtectedRoute>
      <Component />
    </ProtectedRoute>
  ) : (
    <Component />
  )
}

/**
 * Composition root.
 *
 * This is the one place allowed to know about every feature at once: it wires
 * the providers, error reporting, the error boundary, the suspense fallback and
 * the route table together, and does nothing else.
 */
export default function App() {
  // async throws and rejected promises never reach an error boundary
  useEffect(installGlobalErrorReporting, [])

  return (
    <ErrorBoundary label="showcase">
      {/*
        reducedMotion="user" makes Framer Motion honour the OS setting for every
        animation in the tree. The CSS media query in index.css only reaches CSS
        animation; the scroll reveals and card flips are JS-driven and were
        animating regardless of what the visitor had asked for.
      */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <div className="grid-backdrop" aria-hidden="true" />
          <Suspense fallback={<Loader label="Preparing the showcase" />}>
            <Routes>
              {routes.map((route) => (
                <Route key={route.path} path={route.path} element={<RouteView {...route} />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </MotionConfig>
    </ErrorBoundary>
  )
}
