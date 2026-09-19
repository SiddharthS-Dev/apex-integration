import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { isLocalMode } from '@/api/base44Client';
import { DEMO_CREDENTIALS } from '@/api/localClient';
import { Button, Input, Label } from '@/components/ui';

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Inspironics" className="h-full w-full object-contain" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="rounded-2xl glass p-6">{children}</div>

        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </motion.div>
    </div>
  );
}

export function FormError({ message }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

export function GoogleButton({ onClick, disabled, label = 'Continue with Google' }) {
  return (
    <Button variant="outline" className="w-full" onClick={onClick} disabled={disabled}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        />
        <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z"
        />
      </svg>
      {label}
    </Button>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const target = location.state?.from?.pathname || '/';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy('login');
    try {
      await login({ email: email.trim(), password });
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy('');
    }
  };

  const google = async () => {
    setError('');
    setBusy('google');
    try {
      await loginWithGoogle();
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message || 'Google sign in is not available.');
    } finally {
      setBusy('');
    }
  };

  const fillDemo = (kind) => {
    setEmail(DEMO_CREDENTIALS[kind].email);
    setPassword(DEMO_CREDENTIALS[kind].password);
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to Inspironics SlidesVault"
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@inspironics.net"
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pl-9"
            />
          </div>
        </div>

        <Button type="submit" variant="gradient" className="w-full" disabled={busy === 'login'}>
          {busy === 'login' && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <GoogleButton onClick={google} disabled={busy === 'google'} />

        {isLocalMode && (
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Running on the local backend</p>
            <p className="mt-1">
              No Base44 app is configured, so a seeded catalog and demo accounts are in use.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => fillDemo('admin')} className="rounded bg-secondary px-2 py-1 hover:text-foreground">
                Use admin account
              </button>
              <button type="button" onClick={() => fillDemo('user')} className="rounded bg-secondary px-2 py-1 hover:text-foreground">
                Use member account
              </button>
            </div>
          </div>
        )}
      </form>
    </AuthShell>
  );
}
