import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import AuthLayout from '@/components/auth/AuthLayout';
import Field from '@/components/auth/Field';
import FormError, { errorMessage } from '@/components/auth/FormError';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.auth.resetPasswordRequest(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not request a reset link.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      description={sent ? undefined : 'Enter your email and we will issue a reset link.'}
      footer={<Link to="/login" className="inline-flex items-center gap-1 text-primary hover:underline"><ArrowLeft className="w-3.5 h-3.5" /> Back to sign in</Link>}
    >
      {sent ? (
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 flex items-center justify-center">
            <MailCheck className="w-6 h-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            If an account exists, a reset link has been issued. Ask your administrator for the link.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />
          <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Request reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
