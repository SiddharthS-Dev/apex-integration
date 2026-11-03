import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, SearchX } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import PlaybookCard from '@/components/playbooks/PlaybookCard';
import CategoryTiles from '@/components/categories/CategoryTiles';
import PlaybookFilters, { DEFAULT_FILTERS } from '@/components/categories/PlaybookFilters';
import { usePublishedCourses } from '@/components/dashboard/useLearnerData';
import {
  AUDIENCE_LABEL, UNCLASSIFIED, categoryKey, categoryStats, filterOptions, filterPlaybooks, findCategory, useCategories,
} from '@/lib/categories';

// The playbooks behind every course, organised by who they are for. The API only returns playbooks in
// categories the learner's audience may see, so the tiles here are exactly their categories.
const PURPOSE = {
  intern: 'Learning & Development is where you learn: fundamentals, tools and roadmaps.',
  employee: 'Use company knowledge to execute your work, and keep learning.',
  leadership: 'Lead with strategy and governance — and see the knowledge your teams work from.',
};

export default function Playbooks() {
  const { user, isAdmin } = useAuth();
  const { categories } = useCategories();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks-learner'],
    queryFn: () => api.entities.Playbook.list('-created_date', 2000),
  });
  const { data: courses = [], isLoading: loadingCourses } = usePublishedCourses();

  if (isLoading || loadingCourses) return <LoadingState label="Loading playbooks…" />;
  const visible = isAdmin ? playbooks : playbooks.filter((p) => p.status === 'published');

  // Tiles: the categories this user has content in (admins: every category, plus Unclassified if any).
  const keys = new Set(visible.map(categoryKey));
  const tiles = categories
    .filter((c) => isAdmin || keys.has(c.key))
    .map((c) => ({ category: c, stats: categoryStats(visible.filter((p) => categoryKey(p) === c.key), courses) }));
  if (isAdmin && keys.has(UNCLASSIFIED)) {
    const cat = findCategory(categories, UNCLASSIFIED);
    tiles.push({ category: cat, stats: categoryStats(visible.filter((p) => categoryKey(p) === UNCLASSIFIED), courses) });
  }
  const selected = params.get('category') || 'all';
  const choose = (k) => setParams(k === 'all' ? {} : { category: k }, { replace: true });
  const inScope = selected === 'all' ? visible : visible.filter((p) => categoryKey(p) === selected);
  const shown = filterPlaybooks(inScope, filters);
  const audience = user?.audience || 'employee';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <PageHeader
        icon={BookMarked}
        title="Playbooks"
        description={isAdmin
          ? 'Every playbook, by audience: interns come here to learn, employees to execute, leadership to lead.'
          : `${AUDIENCE_LABEL[audience] || 'Employee'} · ${PURPOSE[audience] || PURPOSE.employee}`}
      />
      {visible.length === 0 ? (
        <EmptyState icon={BookMarked} title="No playbooks published yet" description="Published playbooks and their courses will appear here." />
      ) : (
        <>
          {tiles.length > 0 && (
            <CategoryTiles
              tiles={tiles}
              selected={selected}
              onSelect={(k) => choose(selected === k ? 'all' : k)}
              allTile={selected === 'all' ? null : `Show all ${visible.length} playbooks`}
            />
          )}
          <PlaybookFilters value={filters} onChange={setFilters} options={filterOptions(visible)} idPrefix="lib" />
          {shown.length === 0 ? (
            <EmptyState icon={SearchX} title="No matching playbooks" description="Try another category, filter or search." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <PlaybookCard
                  key={p.id}
                  playbook={p}
                  showStatus={isAdmin}
                  category={findCategory(categories, categoryKey(p))}
                  courses={courses.filter((c) => c.playbook_id === p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
