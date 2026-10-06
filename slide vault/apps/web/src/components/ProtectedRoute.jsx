import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle, Loader2, WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">Loading your vault…</p>
      </div>
    </div>
  );
}

/** The session could not be checked, or the app has no working backend. */
export function AuthUnavailable({ backendError, onRetry }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-400">
          {backendError ? <AlertTriangle className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
        </span>
        <h1 className="text-lg font-semibold">
          {backendError ? 'SlidesVault is not configured correctly' : 'Cannot reach SlidesVault'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {backendError || 'The server did not answer. Your session has not been signed out — this page retries on its own.'}
        </p>
        {!backendError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg bg-secondary px-3 py-1.5 text-sm hover:text-foreground"
          >
            Try again now
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProtectedRoute() {
  const { isAuthenticated, loading, unreachable, backendError, refresh } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoading />;
  // Only a definite "signed out" goes to the sign-in page. Under the gateway
  // that page hands off to the Apex sign-in, so a network blip must not.
  if (backendError || (!isAuthenticated && unreachable)) {
    return <AuthUnavailable backendError={backendError} onRetry={refresh} />;
  }
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

/** Inverse guard: keeps signed-in users out of the auth screens. */
export function PublicOnlyRoute({ children }) {
  const { isAuthenticated, loading, backendError } = useAuth();
  if (loading) return <AuthLoading />;
  if (backendError) return <AuthUnavailable backendError={backendError} />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}
