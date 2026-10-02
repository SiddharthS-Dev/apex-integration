import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TableCell, TableRow } from '@/components/ui/table';
import StatusBadge from '@/components/admin/StatusBadge';
import CourseRowActions from '@/components/admin/courses/CourseRowActions';
import { ACCESS_COLORS, DIFFICULTY_COLORS, PILL, formatDate } from '@/components/admin/adminFormat';

export default function CourseTableRow({ course, playbook, onUpdate, busy }) {
  const difficulty = course.difficulty || 'beginner';
  const access = course.access_level || 'free';
  return (
    <TableRow>
      <TableCell className="max-w-[260px]">
        <Link to={`/admin/courses/${course.id}/edit`} className="font-medium hover:text-primary truncate block">
          {course.title}
        </Link>
      </TableCell>
      <TableCell className="max-w-[200px] truncate text-muted-foreground">{playbook?.title || '—'}</TableCell>
      <TableCell>v{course.version || '1'}</TableCell>
      <TableCell><StatusBadge status={course.status || 'draft'} /></TableCell>
      <TableCell><span className={cn(PILL, DIFFICULTY_COLORS[difficulty])}>{difficulty}</span></TableCell>
      <TableCell><span className={cn(PILL, ACCESS_COLORS[access])}>{access}</span></TableCell>
      <TableCell className="text-right whitespace-nowrap">{course.module_count || 0} / {course.lesson_count || 0}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(course.updated_date)}</TableCell>
      <TableCell className="text-right">
        <CourseRowActions course={course} onUpdate={onUpdate} disabled={busy} />
      </TableCell>
    </TableRow>
  );
}
