import { cn } from '@/lib/utils';
import { TableCell, TableRow } from '@/components/ui/table';
import { PILL, formatDate } from '@/components/admin/adminFormat';

const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  user: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

function initials(user) {
  const name = user.full_name || user.email || '?';
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

export default function LearnerRow({ row, onOpen }) {
  const { user } = row;
  const role = user.role || 'user';
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(row)}>
      <TableCell>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
            {initials(user)}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{user.full_name || '—'}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell><span className={cn(PILL, ROLE_COLORS[role] || ROLE_COLORS.user)}>{role}</span></TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(user.created_date)}</TableCell>
      <TableCell className="text-right">{row.started}</TableCell>
      <TableCell className="text-right">{row.completed}</TableCell>
      <TableCell className="text-right">{row.avgQuiz === null ? '—' : `${row.avgQuiz}%`}</TableCell>
      <TableCell className="text-right">{row.certificates.length}</TableCell>
    </TableRow>
  );
}
