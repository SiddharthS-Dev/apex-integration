import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpen, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CourseFilters from '@/components/admin/courses/CourseFilters';
import CourseTable from '@/components/admin/courses/CourseTable';

async function loadCourses() {
  const [courses, playbooks] = await Promise.all([
    api.entities.Course.list('-updated_date', 500),
    api.entities.Playbook.list('-created_date', 200),
  ]);
  return { courses, playbookMap: Object.fromEntries(playbooks.map((p) => [p.id, p])) };
}

export default function AdminCourseList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const { data, isLoading } = useQuery({ queryKey: ['admin-courses'], queryFn: loadCourses });

  const update = useMutation({
    mutationFn: ({ course, patch }) => api.entities.Course.update(course.id, patch),
    onSuccess: (_r, { message }) => {
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['admin-courses'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
    onError: (err) => toast.error(err?.message || 'Update failed'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.courses || []).filter((c) => {
      if (status !== 'all' && (c.status || 'draft') !== status) return false;
      if (!q) return true;
      const pb = data.playbookMap[c.playbook_id]?.title || '';
      return `${c.title} ${c.description || ''} ${pb}`.toLowerCase().includes(q);
    });
  }, [data, search, status]);

  const actions = (
    <Button asChild size="sm" variant="outline">
      <Link to="/admin/playbooks"><Upload /> Import playbook</Link>
    </Button>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Courses" description="Manage all generated courses and their publication status" icon={BookOpen} actions={actions} />
      <CourseFilters search={search} onSearch={setSearch} status={status} onStatus={setStatus} />
      {isLoading ? (
        <LoadingState label="Loading courses…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={BookOpen} title="No courses found" description="Try another filter, or import a playbook to generate a course." />
      ) : (
        <CourseTable
          courses={filtered}
          playbookMap={data.playbookMap}
          busyId={update.isPending ? update.variables?.course.id : null}
          onUpdate={(course, patch, message) => update.mutate({ course, patch, message })}
        />
      )}
    </div>
  );
}
