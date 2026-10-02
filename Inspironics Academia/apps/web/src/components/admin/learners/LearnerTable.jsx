import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import LearnerRow from '@/components/admin/learners/LearnerRow';

export default function LearnerTable({ rows, onOpen }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Started</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Avg quiz</TableHead>
            <TableHead className="text-right">Certificates</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <LearnerRow key={row.user.id} row={row} onOpen={onOpen} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
