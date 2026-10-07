import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { syncDropbox } from '@/api/functions';
import { cn } from '@/lib/utils';

/*
 * The header's "Sync Dropbox" button, for administrators.
 *
 * Runs the same sync as Admin → "Run sync now" (the call returns when the run
 * is done), shows what changed, then refetches everything on screen so the
 * library reflects it without a page refresh.
 */
function summarize(data) {
  if (data?.status === 'skipped') return { tone: 'warn', text: data.reason || 'A sync is already running.' };
  const errors = data?.errors ?? [];
  const parts = [
    data?.new ? `${data.new} new` : '',
    data?.updated ? `${data.updated} updated` : '',
    data?.deleted ? `${data.deleted} archived` : '',
  ].filter(Boolean);
  const changes = parts.length ? parts.join(' · ') : 'no changes';
  if (errors.length) return { tone: 'warn', text: `Synced · ${changes} · ${errors.length} failed` };
  return { tone: 'ok', text: `Synced · ${changes}` };
}

export default function DropboxSyncButton({ className }) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const clear = useRef(null);
  useEffect(() => () => clearTimeout(clear.current), []);

  const run = async () => {
    setSyncing(true);
    setResult(null);
    clearTimeout(clear.current);
    try {
      const { data } = await syncDropbox({ trigger: 'manual' });
      setResult(summarize(data));
      await queryClient.invalidateQueries();
    } catch (e) {
      setResult({ tone: 'bad', text: e?.message || 'Could not sync Dropbox' });
    } finally {
      setSyncing(false);
      clear.current = setTimeout(() => setResult(null), 6000);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={run}
        disabled={syncing}
        title="Pull the latest presentations from Dropbox now"
        className="flex h-9 items-center gap-2 rounded-full glass px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-progress"
      >
        <RefreshCw className={cn('h-3.5 w-3.5 text-violet-500', syncing && 'animate-spin')} />
        <span className="whitespace-nowrap">{syncing ? 'Syncing…' : 'Sync Dropbox'}</span>
      </button>
      {result && (
        <p
          role="status"
          className={cn(
            'absolute right-0 top-full z-40 mt-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs shadow-lg',
            result.tone === 'ok' && 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
            result.tone === 'warn' && 'border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
            result.tone === 'bad' && 'border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
          )}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
