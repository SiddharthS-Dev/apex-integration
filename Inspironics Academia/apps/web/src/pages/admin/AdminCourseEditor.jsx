import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Pencil, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import StatusBadge from '@/components/admin/StatusBadge';
import CourseMetaForm from '@/components/admin/editor/CourseMetaForm';
import ModuleBoard from '@/components/admin/editor/ModuleBoard';
import useEditorActions from '@/components/admin/editor/useEditorActions';
import { editorKey, loadEditor } from '@/components/admin/editor/editorApi';

function HeaderActions({ course }) {
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link to="/admin/courses"><ArrowLeft /> All courses</Link>
      </Button>
      {course?.playbook_id && (
        <Button asChild size="sm">
          <Link to={`/admin/studio/${course.playbook_id}`}><Wand2 /> Open studio</Link>
        </Button>
      )}
    </>
  );
}

export default function AdminCourseEditor() {
  const { courseId } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: editorKey(courseId), queryFn: () => loadEditor(courseId) });
  const actions = useEditorActions(courseId);

  if (isLoading) return <LoadingState label="Loading course…" />;
  if (error || !data?.course) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={BookOpen} title="Course not found" description={error?.message} action={<HeaderActions />} />
      </div>
    );
  }

  const { course, modules, lessons } = data;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title={course.title} icon={Pencil} actions={<HeaderActions course={course} />}>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
          <StatusBadge status={course.status || 'draft'} />
          <span>v{course.version || '1'}</span>
          <span>· {modules.length} modules · {lessons.length} lessons</span>
        </div>
      </PageHeader>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:sticky lg:top-20">
          <CourseMetaForm course={course} saving={actions.saveCourse.isPending} onSave={(patch) => actions.saveCourse.mutate(patch)} />
        </div>
        <div className="lg:col-span-2">
          <ModuleBoard modules={modules} lessons={lessons} actions={actions} />
        </div>
      </div>
    </div>
  );
}
