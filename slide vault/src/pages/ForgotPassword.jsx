import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail, MailCheck } from 'lucide-react';
import { getClient } from '@/api/base44Client';
import { Button, Input, Label } from '@/components/ui';
import { AuthShell, FormError } from '@/pages/Login';

export default function ForgotPassword() {
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
        title="Check your inbox"
        subtitle="If an account exists for that address, a reset link is on its way."
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
            The link expires in 30 minutes. Check your spam folder if it does not arrive.
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
      subtitle="We will email you a link to set a new one"
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
