import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import AuthLayout from '@/components/auth/AuthLayout';
import Field from '@/components/auth/Field';
import FormError, { errorMessage } from '@/components/auth/FormError';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(token ? '' : 'This reset link is missing its token. Request a new one.');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setError('');
    setBusy(true);
    try {
      await api.auth.resetPassword({ resetToken: token, newPassword: password });
      setDone(true);
      setTimeout(() => { window.location.href = appPath('login'); }, 1500);
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password. The link may have expired.'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      footer={<Link to="/forgot-password" className="text-primary hover:underline">Request a new link</Link>}
    >
      {done ? (
        <div className="flex flex-col items-center text-center gap-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-muted-foreground">Password updated. Redirecting you to sign in…</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />
          <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={8}
            hint="At least 8 characters." value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" className="w-full" disabled={busy || !token}>
            {busy && <Loader2 className="animate-spin" />} Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
