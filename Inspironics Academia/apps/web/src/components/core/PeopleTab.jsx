import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, UserRound } from 'lucide-react';
import { api } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { CoreQueryError } from '@/components/core/CoreNotice';
import { useDebounced } from '@/components/core/UserPicker';
import UserDetail from '@/components/core/UserDetail';

/** Search people (by name or email) on the left; the selected person's access on the right. */
export default function PeopleTab({ selectedId, onSelect }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());
  const users = useQuery({ queryKey: ['core', 'users', term], queryFn: () => api.core.users(term) });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start">
      <section aria-labelledby="people-search-label" className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <Label id="people-search-label" htmlFor="people-search">Find a person</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input id="people-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" className="pl-8" autoComplete="off" />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {users.isFetching ? 'Searching…' : users.data ? `${users.data.length} ${users.data.length === 1 ? 'person' : 'people'}${users.data.length === 50 ? ' (first 50, refine the search)' : ''}` : ''}
        </p>
        {users.isLoading && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
        {users.error && <CoreQueryError error={users.error} title="Could not search people" />}
        {users.data && (
          <ul className="divide-y divide-border -mx-1 max-h-[60vh] overflow-y-auto" aria-label="People">
            {users.data.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onSelect(u.id)}
                  aria-current={selectedId === u.id ? 'true' : undefined}
                  className={cn(
                    'w-full text-left px-2 py-2 rounded-lg text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                    selectedId === u.id && 'bg-primary/10',
                  )}
                >
                  <span className="block font-medium truncate">{u.full_name || u.email}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{u.email}</span>
                    {u.disabled ? <Badge variant="destructive">Disabled</Badge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="min-w-0">
        {selectedId
          ? <UserDetail userId={selectedId} />
          : <EmptyState icon={UserRound} title="Choose a person" description="Pick someone on the left to see their roles, memberships and linked accounts." />}
      </div>
    </div>
  );
}
