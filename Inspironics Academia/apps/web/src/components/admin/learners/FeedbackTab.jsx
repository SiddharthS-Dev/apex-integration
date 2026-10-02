import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquare } from 'lucide-react';
import { api } from '@/api/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import FeedbackItem from '@/components/admin/learners/FeedbackItem';
import { FEEDBACK_KEY, loadFeedbackData } from '@/components/admin/learners/learnerData';

export default function FeedbackTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useQuery({ queryKey: FEEDBACK_KEY, queryFn: loadFeedbackData });
  const update = useMutation({
    mutationFn: ({ feedback, status }) => api.entities.LessonFeedback.update(feedback.id, { status }),
    onSuccess: () => { toast.success('Feedback updated'); queryClient.invalidateQueries({ queryKey: FEEDBACK_KEY }); },
    onError: (err) => toast.error(err?.message || 'Update failed'),
  });

  if (isLoading) return <LoadingState label="Loading feedback…" />;
  const items = (data?.feedback || []).filter((f) => filter === 'all' || (f.status || 'open') === filter);
  const avg = data?.feedback.length ? (data.feedback.reduce((s, f) => s + (f.rating || 0), 0) / data.feedback.length).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{data?.feedback.length || 0} feedback entries · average rating {avg}</p>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['all', 'open', 'reviewed', 'resolved'].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No feedback" description="Learner lesson feedback will appear here." />
      ) : (
        items.map((f) => {
          const lesson = data.lessonMap[f.lesson_id];
          return (
            <FeedbackItem
              key={f.id}
              feedback={f}
              lesson={lesson}
              user={data.userMap[f.user_id]}
              course={data.courseMap[f.course_id]}
              busy={update.isPending && update.variables?.feedback.id === f.id}
              onStatus={(feedback, status) => update.mutate({ feedback, status })}
            />
          );
        })
      )}
    </div>
  );
}
