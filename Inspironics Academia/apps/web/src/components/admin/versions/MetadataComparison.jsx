import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const formatSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '—';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
};

const FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'organization', label: 'Organization' },
  { key: 'chapter_count', label: 'Chapters' },
  { key: 'file_name', label: 'File name' },
  { key: 'file_size', label: 'File size', format: formatSize },
];

export default function MetadataComparison({ oldVersion, newVersion }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-3">Metadata</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Field</TableHead>
            <TableHead>{oldVersion?.version_label}</TableHead>
            <TableHead>{newVersion?.version_label}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {FIELDS.map((f) => {
            const fmt = f.format || ((v) => (v === undefined || v === null || v === '' ? '—' : String(v)));
            const a = fmt(oldVersion?.[f.key]);
            const b = fmt(newVersion?.[f.key]);
            const changed = a !== b;
            return (
              <TableRow key={f.key} className={cn(changed && 'bg-amber-50 dark:bg-amber-950/30')}>
                <TableCell className="font-medium text-muted-foreground">{f.label}</TableCell>
                <TableCell className={cn(changed && 'text-rose-700 dark:text-rose-400')}>{a}</TableCell>
                <TableCell className={cn(changed && 'text-emerald-700 dark:text-emerald-400 font-medium')}>{b}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
