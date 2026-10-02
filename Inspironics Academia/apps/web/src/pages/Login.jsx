import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import AuthLayout from '@/components/auth/AuthLayout';
import GoogleButton from '@/components/auth/GoogleButton';
import Field from '@/components/auth/Field';
import FormError, { errorMessage } from '@/components/auth/FormError';
import DemoLoginHint from '@/components/auth/DemoLoginHint';
import { appPath } from '@/lib/mount';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.auth.loginViaEmailPassword(email, password);
      window.location.href = appPath('dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Invalid email or password.'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to continue your learning path."
      footer={<>New here? <Link to="/register" className="text-primary font-medium hover:underline">Create an account</Link></>}
    >
      <DemoLoginHint onPick={(demoEmail) => { setEmail(demoEmail); setPassword('demo'); }} />
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          id="password" label="Password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)}
          aside={<Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
      <GoogleButton />
    </AuthLayout>
  );
}
