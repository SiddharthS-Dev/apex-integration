import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import LearnerTable from '@/components/admin/learners/LearnerTable';
import LearnerDetailDialog from '@/components/admin/learners/LearnerDetailDialog';
import { LEARNERS_KEY, loadLearnerData } from '@/components/admin/learners/learnerData';

export default function LearnersTab() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: LEARNERS_KEY, queryFn: loadLearnerData });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter((r) => !q || `${r.user.full_name || ''} ${r.user.email || ''}`.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" className="pl-9" />
      </div>
      {isLoading ? (
        <LoadingState label="Loading learners…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description="Invite users to get started." />
      ) : (
        <LearnerTable rows={rows} onOpen={setSelected} />
      )}
      <LearnerDetailDialog row={selected} courseMap={data?.courseMap || {}} onClose={() => setSelected(null)} />
    </div>
  );
}
