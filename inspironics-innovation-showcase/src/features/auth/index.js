/**
 * Public surface of the auth feature.
 *
 * Everything outside this folder talks to auth through here: the service, the
 * React context, the two shared auth widgets and the route table. The
 * localStorage repository behind the service is deliberately not exported —
 * swapping it for an HTTP one must not be visible from the outside.
 */
export { EMAIL_RE, api as authApi, passwordIssues } from './api/authService.js'
export { AuthProvider, ProtectedRoute, useAuth } from './context/AuthContext.jsx'
export { default as AuthShell } from './components/AuthShell.jsx'
export { default as GoogleButton } from './components/GoogleButton.jsx'
export { authRoutes } from './routes.jsx'
