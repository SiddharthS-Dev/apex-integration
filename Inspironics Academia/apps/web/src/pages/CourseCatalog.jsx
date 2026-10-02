import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Library, SearchX } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import CatalogFilters from '@/components/catalog/CatalogFilters';
import CourseGrid from '@/components/catalog/CourseGrid';

export default function CourseCatalog() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('all');

  const coursesQ = useQuery({
    queryKey: ['catalog-courses'],
    queryFn: () => api.entities.Course.list('-updated_date', 200),
  });
  const progressQ = useQuery({
    queryKey: ['progress', user?.id, 'all'],
    queryFn: () => api.entities.CourseProgress.filter({ user_id: user.id }, '-updated_date', 200),
    enabled: !!user,
  });

  const published = useMemo(() => (coursesQ.data || []).filter((c) => c.status === 'published'), [coursesQ.data]);
  const progressByCourse = useMemo(
    () => Object.fromEntries((progressQ.data || []).map((p) => [p.course_id, p])),
    [progressQ.data],
  );
  const courses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return published.filter(
      (c) =>
        (difficulty === 'all' || (c.difficulty || 'beginner') === difficulty) &&
        (!q || `${c.title} ${c.description || ''}`.toLowerCase().includes(q)),
    );
  }, [published, search, difficulty]);

  const loading = coursesQ.isLoading;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader icon={Library} title="Course Catalog" description="Structured learning paths built from our engineering playbooks." />
      <CatalogFilters search={search} onSearch={setSearch} difficulty={difficulty} onDifficulty={setDifficulty} />
      {!loading && published.length === 0 ? (
        <EmptyState icon={Library} title="No courses yet" description="Published courses will appear here." />
      ) : !loading && courses.length === 0 ? (
        <EmptyState icon={SearchX} title="No matching courses" description="Try a different search or difficulty level." />
      ) : (
        <CourseGrid courses={courses} progressByCourse={progressByCourse} loading={loading} />
      )}
    </div>
  );
}
