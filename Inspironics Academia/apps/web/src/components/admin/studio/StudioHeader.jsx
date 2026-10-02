import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/StatusBadge';

export default function StudioHeader({ playbook, course, actions }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
      <div className="flex items-start gap-3 min-w-0">
        <Button size="sm" variant="ghost" asChild className="mt-1 shrink-0">
          <Link to="/admin/playbooks" aria-label="Back to playbooks"><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Content Studio</div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{course?.title || playbook?.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <span className="truncate max-w-[20rem]">{playbook?.title}</span>
            {course && <StatusBadge status={course.status} />}
            {course?.version && <span>v{course.version}</span>}
            {course && <span>· {course.module_count || 0} modules · {course.lesson_count || 0} lessons</span>}
          </div>
        </div>
      </div>
      {actions}
    </div>
  );
}
