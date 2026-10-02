import { History } from 'lucide-react';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SyncHistoryRow from './SyncHistoryRow';

const HEADS = ['Started', 'Trigger', 'Status', 'Duration'];
const COUNT_HEADS = ['Found', 'Added', 'Updated', 'Same', 'Archived', 'Failed'];

export default function SyncHistoryTable({ logs = [] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-4 flex items-center gap-2"><History className="w-4 h-4" /> Sync history</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {HEADS.map((h) => <TableHead key={h}>{h}</TableHead>)}
                {COUNT_HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}
                <TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => <SyncHistoryRow key={log.id} log={log} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
