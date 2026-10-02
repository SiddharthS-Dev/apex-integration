import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import StatusBadge from '@/components/admin/StatusBadge';
import SegmentBar from '@/components/admin/dashboard/SegmentBar';

export default function PlaybookStatusRow({ row }) {
  const { playbook, course, counts, total, coverage } = row;
  return (
    <TableRow>
      <TableCell className="font-medium max-w-[220px] truncate">{playbook.title}</TableCell>
      <TableCell>{course ? <StatusBadge status={course.status} /> : <span className="text-xs text-muted-foreground">No course</span>}</TableCell>
      <TableCell className="text-right">{total}</TableCell>
      <TableCell className="text-right">{counts.pending || 0}</TableCell>
      <TableCell className="text-right">{counts.generating || 0}</TableCell>
      <TableCell className="text-right">{counts.pending_review || 0}</TableCell>
      <TableCell className="text-right">{counts.approved || 0}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <SegmentBar counts={counts} total={total} className="h-2" />
          <span className="text-xs font-medium w-9 text-right">{coverage}%</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link to={`/admin/studio/${playbook.id}`}>
            Review <ArrowRight />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
