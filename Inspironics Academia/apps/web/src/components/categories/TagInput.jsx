import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

// A list of short tags typed one at a time: Enter or comma adds, × removes, Backspace on an empty
// box removes the last. `suggestions` feed a datalist.
export default function TagInput({ id, value = [], onChange, placeholder, suggestions = [] }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    const next = [...value];
    for (const t of tags) if (!next.some((v) => v.toLowerCase() === t.toLowerCase())) next.push(t);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((v) => v !== t))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        id={id}
        list={suggestions.length ? `${id}-list` : undefined}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="h-7 min-w-[8rem] flex-1 border-0 p-0 shadow-none focus-visible:ring-0"
      />
      {suggestions.length > 0 && <datalist id={`${id}-list`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}
