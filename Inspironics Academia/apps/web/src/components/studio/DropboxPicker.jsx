import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText, Folder, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { fmtBytes, fmtDate, useDropboxAccounts } from '@/lib/studio';
import { Choice, Field, Notice } from './StudioFields';

// Browses a connected Dropbox folder by folder. Only metadata is listed (name, type, size, date,
// revision, whether APEX already tracks it); nothing is downloaded until a document is processed.
// The selection is the file's Dropbox id (stable across renames and moves), never its name.
export default function DropboxPicker({ value, onChange }) {
  const accounts = useDropboxAccounts();
  const [account, setAccount] = useState('');
  const [path, setPath] = useState('');
  useEffect(() => { if (!account && accounts.data?.length) setAccount(accounts.data[0].account); }, [account, accounts.data]);
  const listing = useQuery({
    queryKey: ['studio-ai', 'dropbox-browse', account, path],
    queryFn: () => api.studio.browseDropbox(account, path),
    enabled: !!account,
  });

  if (accounts.isLoading) return <p className="text-sm text-muted-foreground">Loading Dropbox connections…</p>;
  if (!accounts.data?.length) return <Notice tone="warn">No Dropbox account is connected. Connect one under Admin → Dropbox first.</Notice>;

  const crumbs = path.split('/').filter(Boolean);
  const go = (p) => { setPath(p); onChange(null); };
  const pick = (f) => onChange(f.processable ? { account, ...f } : null);

  return (
    <div className="grid gap-3">
      {accounts.data.length > 1 && (
        <Field label="Dropbox connection" htmlFor="dbx-account">
          <Choice id="dbx-account" value={account} onChange={(a) => { setAccount(a); go(''); }} options={accounts.data.map((a) => ({ value: a.account, label: `${a.label}${a.account_name ? ` · ${a.account_name}` : ''}` }))} />
        </Field>
      )}
      <nav aria-label="Dropbox folder" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => go('')}>Dropbox</button>
        {crumbs.map((c, i) => (
          <span key={`${c}-${i}`} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => go(`/${crumbs.slice(0, i + 1).join('/')}`)}>{c}</button>
          </span>
        ))}
      </nav>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
        {listing.isLoading && <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Listing…</p>}
        {listing.error && <p className="p-3 text-sm text-rose-600">{listing.error.message}</p>}
        {listing.data && (
          <ul className="divide-y divide-border text-sm">
            {listing.data.folders.map((f) => (
              <li key={f.path}>
                <button type="button" onClick={() => go(f.path)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60">
                  <Folder className="h-4 w-4 shrink-0 text-sky-600" /> <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
            {listing.data.files.map((f) => {
              const selected = value?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!f.processable}
                    onClick={() => pick(f)}
                    aria-pressed={selected}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left ${selected ? 'bg-primary/10' : 'hover:bg-muted/60'} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {(f.ext || '?').toUpperCase()} · {fmtBytes(f.size)} · modified {fmtDate(f.server_modified)}
                        {!f.processable && ' · not supported'}
                      </span>
                    </span>
                    {f.tracked && <Badge variant="secondary" className="shrink-0">{f.tracked.type === 'playbook' ? `Playbook · ${f.tracked.status}` : `Meeting · ${f.tracked.status}`}</Badge>}
                  </button>
                </li>
              );
            })}
            {!listing.data.folders.length && !listing.data.files.length && <li className="p-3 text-muted-foreground">This folder is empty.</li>}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Supported: PDF, Word (.docx), PowerPoint (.pptx), text, Markdown and CSV. The file is read from Dropbox only when you continue, and the same revision is not processed twice.</p>
    </div>
  );
}
