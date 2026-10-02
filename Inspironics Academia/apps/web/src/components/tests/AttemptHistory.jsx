import { format } from 'date-fns';
import { History } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import { AttemptTypeBadge, PassBadge } from '@/components/dashboard/AttemptBadges';

export default function AttemptHistory({ attempts, courses }) {
  const courseTitle = (id) => courses.find((c) => c.id === id)?.title || '—';
  if (attempts.length === 0) {
    return <EmptyState icon={History} title="No attempts yet" description="Your quiz and test attempts will be listed here." />;
  }
  return (
    <div className="rounded-2xl border border-border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Course</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Result</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {a.created_date ? format(new Date(a.created_date), 'MMM d, yyyy HH:mm') : '—'}
              </TableCell>
              <TableCell className="max-w-[240px] truncate">{courseTitle(a.course_id)}</TableCell>
              <TableCell><AttemptTypeBadge type={a.type} /></TableCell>
              <TableCell className="text-right tabular-nums">{a.score ?? 0}/{a.total ?? 0}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{Math.round(a.percentage || 0)}%</TableCell>
              <TableCell className="text-right"><PassBadge passed={a.passed} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
