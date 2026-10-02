import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { QUESTIONS_KEY } from '@/components/admin/questions/questionData';

export default function useQuestionActions({ onEdited } = {}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
    queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };
  const onError = (err) => toast.error(err?.message || 'Update failed');

  const setStatus = useMutation({
    mutationFn: ({ question, status }) => api.entities.Question.update(question.id, { status }),
    onSuccess: (_r, { status }) => { toast.success(status === 'approved' ? 'Question approved' : 'Question rejected'); refresh(); },
    onError,
  });
  const save = useMutation({
    mutationFn: ({ question, patch }) => api.entities.Question.update(question.id, patch),
    onSuccess: () => { toast.success('Question updated'); onEdited?.(); refresh(); },
    onError,
  });
  const approveAll = useMutation({
    mutationFn: (questions) => Promise.all(questions.map((q) => api.entities.Question.update(q.id, { status: 'approved' }))),
    onSuccess: (res) => { toast.success(`Approved ${res.length} question${res.length === 1 ? '' : 's'}`); refresh(); },
    onError: (err) => { onError(err); refresh(); },
  });
  return { setStatus, save, approveAll };
}
