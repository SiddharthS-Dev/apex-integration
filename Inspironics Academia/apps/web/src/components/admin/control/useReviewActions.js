import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { approveAll, updateMany } from '@/lib/pipeline';

// Approve actions shared by the deep-dive queue and the pending-review sidebar. Approving a lesson
// also approves its questions and flashcards, the same as the Content Studio does.
export default function useReviewActions(data) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });

  const quickApprove = async (item) => {
    setBusy((b) => [...b, item.id]);
    try {
      if (item.entity === 'Lesson') {
        await api.entities.Lesson.update(item.id, { status: 'approved' });
        await updateMany('Question', data.questions.filter((q) => q.lesson_id === item.id && q.status !== 'approved'), { status: 'approved' });
        await updateMany('Flashcard', data.flashcards.filter((f) => f.lesson_id === item.id && f.status !== 'approved'), { status: 'approved' });
      } else {
        await api.entities[item.entity].update(item.id, { status: 'approved' });
      }
      toast.success(`${item.entity} approved`, { description: item.title.slice(0, 80) });
      await refresh();
    } catch (err) {
      toast.error(`Could not approve: ${err?.message || 'unknown error'}`);
    } finally {
      setBusy((b) => b.filter((x) => x !== item.id));
    }
  };

  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkApprove = async (selected) => {
    setBulkBusy(true);
    try {
      const pick = (key, list) => (selected.includes(key) ? list : []);
      const counts = await approveAll({
        lessons: pick('lessons', data.lessons),
        questions: pick('questions', data.questions),
        flashcards: pick('flashcards', data.flashcards),
        assessments: pick('assessments', data.assessments),
      });
      const parts = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
      toast.success(parts.length ? `Approved ${parts.join(', ')}` : 'Nothing was waiting for review');
      await refresh();
    } catch (err) {
      toast.error(`Bulk approve failed: ${err?.message || 'unknown error'}`);
    } finally {
      setBulkBusy(false);
    }
  };

  return { quickApprove, busy, bulkApprove, bulkBusy };
}
