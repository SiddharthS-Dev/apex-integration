import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import CourseRow from '@/components/mylearning/CourseRow';

export default function CourseRowList({ rows, outlines, emptyTitle, emptyDescription }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={emptyTitle}
        description={emptyDescription}
        action={<Button asChild size="sm"><Link to="/courses">Browse courses</Link></Button>}
      />
    );
  }
  return (
    <div className="space-y-3">
      {rows.map(({ course, progress }) => (
        <CourseRow key={course.id} course={course} progress={progress} outline={outlines[course.id]} />
      ))}
    </div>
  );
}
