import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Small shared form pieces for AI Studio. Radix Select can't hold an empty value, so "server
// default" is the sentinel 'default' and maps back to ''.

export const DEFAULT = 'default';
export const fromSelect = (v) => (v === DEFAULT ? '' : v);

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Choice({ id, value, onChange, options, placeholder, disabled }) {
  return (
    <Select value={value || DEFAULT} onValueChange={(v) => onChange(fromSelect(v))} disabled={disabled}>
      <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value || DEFAULT} value={o.value || DEFAULT}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
    warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  };
  return <div className={`rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}
