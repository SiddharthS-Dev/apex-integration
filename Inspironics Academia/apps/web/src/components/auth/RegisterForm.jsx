import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import Field from '@/components/auth/Field';
import FormError, { errorMessage } from '@/components/auth/FormError';
import { appPath } from '@/lib/mount';

// Single step: the API creates the account and sets the session cookie in one call.
export default function RegisterForm() {
  const [form, setForm] = useState({ email: '', full_name: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');
    setError('');
    setBusy(true);
    try {
      await api.auth.register({ email: form.email, password: form.password, full_name: form.full_name.trim() });
      window.location.href = appPath('dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not create your account.'));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormError message={error} />
      <Field id="email" label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
      <Field id="full_name" label="Full name" autoComplete="name" required value={form.full_name} onChange={set('full_name')} />
      <Field
        id="password" label="Password" type="password" autoComplete="new-password" required minLength={8}
        hint="At least 8 characters." value={form.password} onChange={set('password')}
      />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} Create account
      </Button>
    </form>
  );
}
