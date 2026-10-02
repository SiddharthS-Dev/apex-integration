import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

const parentOf = (p) => p.split('/').slice(0, -1).join('/');

export default function FolderBrowser({ initialPath = '', onSelect, saving }) {
  const [path, setPath] = useState(initialPath);
  const { data: folders = [], isLoading, error } = useQuery({ queryKey: ['dropbox-folders', path], queryFn: () => api.dropbox.listFolders(path) });
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" disabled={!path} onClick={() => setPath(parentOf(path))} aria-label="Parent folder"><ArrowUp /></Button>
        <code className="flex-1 truncate font-mono text-xs">{path || '/ (entire Dropbox)'}</code>
        <Button size="sm" disabled={saving} onClick={() => onSelect(path)}>Use this folder</Button>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {isLoading && <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading folders…</p>}
        {error && <p className="p-3 text-sm text-rose-600 dark:text-rose-400">{error.message}</p>}
        {!isLoading && !error && folders.length === 0 && <p className="p-3 text-sm text-muted-foreground">No subfolders here.</p>}
        {folders.map((f) => (
          <button key={f.path} type="button" onClick={() => setPath(f.path)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent">
            <Folder className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="flex-1 truncate">{f.name}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
