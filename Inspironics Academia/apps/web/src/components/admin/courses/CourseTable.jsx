import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import CourseTableRow from '@/components/admin/courses/CourseTableRow';

export default function CourseTable({ courses, playbookMap, onUpdate, busyId }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Playbook</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Difficulty</TableHead>
            <TableHead>Access</TableHead>
            <TableHead className="text-right">Modules / Lessons</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {courses.map((course) => (
            <CourseTableRow
              key={course.id}
              course={course}
              playbook={playbookMap[course.playbook_id]}
              onUpdate={onUpdate}
              busy={busyId === course.id}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
