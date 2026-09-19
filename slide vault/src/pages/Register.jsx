import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Mail, Lock, User as UserIcon, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { isLocalMode } from '@/api/base44Client';
import { Button, Input, Label } from '@/components/ui';
import { AuthShell, FormError, GoogleButton } from '@/pages/Login';

export default function Register() {
  const navigate = useNavigate();
  const { register, verifyOtp, loginWithGoogle } = useAuth();

  const [step, setStep] = useState('details');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const submitDetails = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy('register');
    try {
      await register({ email: email.trim(), password, full_name: fullName.trim() });
      setStep('otp');
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setBusy('');
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setError('');
    setBusy('otp');
    try {
      await verifyOtp({ email: email.trim(), otp: otp.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'That code could not be verified.');
    } finally {
      setBusy('');
    }
  };

  const google = async () => {
    setBusy('google');
    try {
      await loginWithGoogle();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Google sign up is not available.');
    } finally {
      setBusy('');
    }
  };

  if (step === 'otp') {
    return (
      <AuthShell
        title="Verify your email"
        subtitle={`We sent a 6-digit code to ${email}`}
        footer={
          <button type="button" onClick={() => setStep('details')} className="text-primary hover:underline">
            Use a different email
          </button>
        }
      >
        <form onSubmit={submitOtp} className="space-y-4">
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="otp">Verification code</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="otp"
                inputMode="numeric"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="000000"
                className="pl-9 font-mono tracking-[0.4em]"
              />
            </div>
            {isLocalMode && (
              <p className="text-[11px] text-muted-foreground">Local backend: the demo code is 000000.</p>
            )}
          </div>
          <Button type="submit" variant="gradient" className="w-full" disabled={busy === 'otp'}>
            {busy === 'otp' && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify and continue
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join the Inspironics presentation knowledge hub"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submitDetails} className="space-y-4">
        <FormError message={error} />

        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <div className="relative">
            <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="name"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ada Lovelace"
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <Button type="submit" variant="gradient" className="w-full" disabled={busy === 'register'}>
          {busy === 'register' && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <GoogleButton onClick={google} disabled={busy === 'google'} label="Sign up with Google" />
      </form>
    </AuthShell>
  );
}
