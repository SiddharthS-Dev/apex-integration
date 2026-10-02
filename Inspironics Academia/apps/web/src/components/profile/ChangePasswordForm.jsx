import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import FormError, { errorMessage } from '@/components/auth/FormError';

const EMPTY = { current: '', next: '', confirm: '' };

// Guidance shown while typing. The server only enforces the 8-character minimum.
const RULES = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'number', label: 'Contains a number', test: (p) => /\d/.test(p) },
  { key: 'special', label: 'Contains a special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function strength(pw) {
  if (!pw) return null;
  let score = RULES.filter((r) => r.test(pw)).length;
  if (pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (pw.length < 8) score = Math.min(score, 1);
  if (score <= 1) return { label: 'Weak', pct: 33, bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' };
  if (score === 2) return { label: 'Fair', pct: 66, bar: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-300' };
  return { label: 'Strong', pct: 100, bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
}

function PasswordField({ id, label, value, onChange, autoComplete, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} className="pr-10" {...rest} />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ChangePasswordForm({ user }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const meter = strength(form.next);
  const mismatch = form.confirm && form.confirm !== form.next;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) return setError('New password must be at least 8 characters.');
    if (form.next !== form.confirm) return setError('New passwords do not match.');
    setError('');
    setBusy(true);
    try {
      await api.auth.changePassword({ userId: user.id, currentPassword: form.current, newPassword: form.next });
      toast.success('Password changed');
      setForm(EMPTY);
    } catch (err) {
      setError(errorMessage(err, 'Could not change password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> Change password</h3>
      <FormError message={error} />
      <PasswordField id="current-password" label="Current password" autoComplete="current-password" required value={form.current} onChange={set('current')} />
      <div className="space-y-2">
        <PasswordField id="new-password" label="New password" autoComplete="new-password" required minLength={8} value={form.next} onChange={set('next')} aria-describedby="pw-rules" />
        {meter && (
          <div className="flex items-center gap-3" aria-live="polite">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div className={cn('h-full rounded-full transition-all duration-300', meter.bar)} style={{ width: `${meter.pct}%` }} />
            </div>
            <span className={cn('text-xs font-medium w-12 text-right', meter.text)}>{meter.label}</span>
          </div>
        )}
        <ul id="pw-rules" className="space-y-1">
          {RULES.map((r) => {
            const ok = r.test(form.next);
            return (
              <li key={r.key} className={cn('flex items-center gap-1.5 text-xs transition-colors duration-200', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center', ok ? 'bg-emerald-500/15' : 'bg-muted')}>
                  {ok ? <Check className="w-3 h-3" strokeWidth={3} /> : <X className="w-3 h-3" />}
                </span>
                {r.label}
                <span className="sr-only">{ok ? '(met)' : '(not met)'}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="space-y-1.5">
        <PasswordField id="confirm-password" label="Confirm new password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} aria-invalid={mismatch || undefined} />
        {mismatch && <p className="text-xs text-rose-600 dark:text-rose-400">Passwords don&apos;t match yet.</p>}
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} Update password
      </Button>
    </form>
  );
}
