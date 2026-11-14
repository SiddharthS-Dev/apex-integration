import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { coreErrorText } from '@/lib/core';

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Searches Core users by name or email and lets the admin pick one. `value` is the picked user or null. */
export default function UserPicker({ label = 'Person', value, onChange, excludeIds = [] }) {
  const id = useId();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());
  const { data, isFetching, error } = useQuery({
    queryKey: ['core', 'users', term],
    queryFn: () => api.core.users(term),
    enabled: term.length > 0,
  });
  const results = (data || []).filter((u) => !excludeIds.includes(u.id));

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-input px-3 py-2 text-sm">
          <span className="min-w-0 truncate"><Check className="inline w-4 h-4 mr-1 text-emerald-600" aria-hidden="true" />{value.full_name ? `${value.full_name} · ` : ''}{value.email}</span>
          <button type="button" className="text-primary text-xs font-medium hover:underline" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="pl-8" autoComplete="off" aria-describedby={`${id}-status`} />
      </div>
      <p id={`${id}-status`} className="sr-only" aria-live="polite">
        {term ? (isFetching ? 'Searching' : `${results.length} result${results.length === 1 ? '' : 's'}`) : ''}
      </p>
      {error && <p className="text-xs text-destructive">{coreErrorText(error)}</p>}
      {term && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border" aria-label="Matching people">
          {isFetching && !data && <li className="p-2 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</li>}
          {data && results.length === 0 && <li className="p-2 text-xs text-muted-foreground">No matching people.</li>}
          {results.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onChange(u)}
                className={cn('w-full text-left px-3 py-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none')}
              >
                <span className="font-medium">{u.full_name || u.email}</span>
                {u.full_name && <span className="text-muted-foreground"> · {u.email}</span>}
                {u.disabled ? <span className="text-xs text-destructive"> (disabled)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
