import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Loader2, Mail, MailCheck } from 'lucide-react';
import { getClient, isApiMode } from '@/api/backendClient';
import { Button, Input, Label } from '@/components/ui';
import { AuthShell, FormError } from '@/pages/Login';

/**
 * What a person who has forgotten their password is told when the app runs on
 * the SlidesVault API.
 *
 * The API sends no email, so there is no reset link to promise. An
 * administrator sets a temporary password from the Admin console (which signs
 * the person out everywhere) and hands it over directly.
 */
export function AdminResetNotice() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Ask a SlidesVault administrator to reset your password"
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
          <KeyRound className="h-5 w-5" />
        </span>
        <p className="text-sm text-muted-foreground">
          This SlidesVault does not send password-reset emails. An administrator can set a temporary
          password for your account from the Admin console and give it to you directly. Sign in with it,
          and you will be signed out of any other devices.
        </p>
      </div>
    </AuthShell>
  );
}

export default function ForgotPassword() {
  if (isApiMode) return <AdminResetNotice />;
  return <DemoForgotPassword />;
}

/** The local demo backend simulates an emailed reset link (token: demo-reset-token). */
function DemoForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const client = await getClient();
      await client.auth.resetPasswordRequest({ email: email.trim() });
    } catch (err) {
      // Never reveal whether an address exists — always show the same result.
      console.warn('[auth] reset request failed', err);
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Reset link created"
        subtitle="Demo mode: no email is sent."
        footer={
          <Link to="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <MailCheck className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            If an account exists for that address, open{' '}
            <Link to="/reset-password?token=demo-reset-token" className="text-primary hover:underline">
              the demo reset page
            </Link>{' '}
            to choose a new password.
          </p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Demo mode: this simulates a reset link"
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
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
        <Button type="submit" variant="gradient" className="w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
