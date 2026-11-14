import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** Labelled select. `options` is [{ value, label, disabled? }]. */
export function SelectField({ label, value, onChange, options, placeholder = 'Choose…', hint, disabled }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} aria-describedby={hint ? `${id}-hint` : undefined}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Labelled multi-line text (reasons, notes). */
export function TextField({ label, value, onChange, required, placeholder, hint, rows = 3, maxLength = 1000 }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}{required ? <span aria-hidden="true" className="text-destructive"> *</span> : <span className="text-muted-foreground font-normal"> (optional)</span>}</Label>
      <Textarea
        id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={maxLength}
        required={required} aria-required={required || undefined} placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
