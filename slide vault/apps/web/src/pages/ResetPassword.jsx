import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { getClient, isLocalMode } from '@/api/base44Client';
import { Button, Input, Label } from '@/components/ui';
import { AuthShell, FormError } from '@/pages/Login';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
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
    setBusy(true);
    try {
      const client = await getClient();
      await client.auth.resetPassword({ token, password });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message || 'This reset link is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Set a password you have not used before"
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error || (!token ? 'This link is missing its reset token.' : '')} />

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
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
          <Label htmlFor="confirm">Confirm new password</Label>
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

        <Button type="submit" variant="gradient" className="w-full" disabled={busy || !token}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </Button>

        {isLocalMode && (
          <p className="text-[11px] text-muted-foreground">
            Local backend: request a link from “Forgot password” first — it uses the token{' '}
            <code className="rounded bg-secondary px-1">demo-reset-token</code>.
          </p>
        )}
      </form>
    </AuthShell>
  );
}
