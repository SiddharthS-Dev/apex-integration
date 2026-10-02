import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import QuestionFilters from '@/components/admin/questions/QuestionFilters';
import QuestionCard from '@/components/admin/questions/QuestionCard';
import QuestionEditDialog from '@/components/admin/questions/QuestionEditDialog';
import BulkApproveButton from '@/components/admin/questions/BulkApproveButton';
import useQuestionActions from '@/components/admin/questions/useQuestionActions';
import { QUESTIONS_KEY, loadQuestionData } from '@/components/admin/questions/questionData';

const PAGE = 30;

function matches(q, ctx, f) {
  if (f.status !== 'all' && (q.status || 'pending_review') !== f.status) return false;
  if (f.difficulty !== 'all' && (q.difficulty || 'basic') !== f.difficulty) return false;
  if (f.course !== 'all' && ctx?.course?.id !== f.course) return false;
  const s = f.search.trim().toLowerCase();
  return !s || `${q.question_text} ${(q.options || []).join(' ')}`.toLowerCase().includes(s);
}

export default function AdminQuestions() {
  const [filters, setFilters] = useState({ status: 'pending_review', difficulty: 'all', course: 'all', search: '' });
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: QUESTIONS_KEY, queryFn: loadQuestionData });
  const { setStatus, save, approveAll } = useQuestionActions({ onEdited: () => setEditing(null) });

  const visible = useMemo(
    () => (data?.questions || []).filter((q) => matches(q, data.context[q.id], filters)),
    [data, filters],
  );
  const approvable = visible.filter((q) => q.status !== 'approved');
  const changeFilters = (f) => { setFilters(f); setLimit(PAGE); };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader
        title="Question review"
        description="Review AI-generated quiz and test questions before learners see them"
        icon={FileQuestion}
        actions={<BulkApproveButton count={approvable.length} pending={approveAll.isPending} onConfirm={() => approveAll.mutate(approvable)} />}
      />
      {data && <QuestionFilters filters={filters} onChange={changeFilters} courses={data.courses} />}
      {isLoading && <LoadingState label="Loading questions…" />}
      {data && visible.length === 0 && (
        <EmptyState icon={FileQuestion} title="No questions match" description="Adjust the filters or generate lesson content to create questions." />
      )}
      {data && visible.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{visible.length} question{visible.length === 1 ? '' : 's'}</p>
          {visible.slice(0, limit).map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              context={data.context[q.id]}
              busy={setStatus.isPending && setStatus.variables?.question.id === q.id}
              onStatus={(question, status) => setStatus.mutate({ question, status })}
              onEdit={setEditing}
            />
          ))}
          {visible.length > limit && (
            <div className="flex justify-center">
              <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>
            </div>
          )}
        </div>
      )}
      <QuestionEditDialog question={editing} onClose={() => setEditing(null)} saving={save.isPending} onSave={(question, patch) => save.mutate({ question, patch })} />
    </div>
  );
}
