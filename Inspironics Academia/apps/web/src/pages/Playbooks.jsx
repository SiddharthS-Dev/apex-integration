import { useQuery } from '@tanstack/react-query';
import { BookMarked } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import PlaybookCard from '@/components/playbooks/PlaybookCard';
import { usePublishedCourses } from '@/components/dashboard/useLearnerData';

export default function Playbooks() {
  const { isAdmin } = useAuth();
  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks-learner'],
    queryFn: () => api.entities.Playbook.list('-created_date', 100),
  });
  const { data: courses = [], isLoading: loadingCourses } = usePublishedCourses();

  if (isLoading || loadingCourses) return <LoadingState label="Loading playbooks…" />;
  const visible = isAdmin ? playbooks : playbooks.filter((p) => p.status === 'published');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader
        icon={BookMarked}
        title="Playbooks"
        description="The engineering playbooks behind every course — learn straight from the source."
      />
      {visible.length === 0 ? (
        <EmptyState icon={BookMarked} title="No playbooks published yet" description="Published playbooks and their courses will appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <PlaybookCard
              key={p.id}
              playbook={p}
              showStatus={isAdmin}
              courses={courses.filter((c) => c.playbook_id === p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
