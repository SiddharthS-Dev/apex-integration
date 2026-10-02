import { FileText } from 'lucide-react';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import PlaybookStatusRow from '@/components/admin/dashboard/PlaybookStatusRow';
import { buildPlaybookRows } from '@/components/admin/dashboard/lessonStatus';

// Per-playbook lesson generation progress, lowest coverage first.
export default function PlaybookGenerationStatus({ playbooks, courses, modules, lessons }) {
  const rows = buildPlaybookRows({ playbooks, courses, modules, lessons });
  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <h2 className="font-semibold">Playbook generation status</h2>
      <p className="text-sm text-muted-foreground mb-4">Lesson generation and review progress per playbook</p>
      {rows.length === 0 ? (
        <EmptyState icon={FileText} title="No playbooks yet" description="Upload a playbook to start generating courses." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Playbook</TableHead>
                <TableHead>Course</TableHead>
                <TableHead className="text-right">Lessons</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Generating</TableHead>
                <TableHead className="text-right">Review</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="min-w-[160px]">Coverage</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <PlaybookStatusRow key={row.playbook.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
