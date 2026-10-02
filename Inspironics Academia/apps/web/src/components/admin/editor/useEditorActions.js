import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { editorKey, nextOrder, persistOrder, syncCounts } from '@/components/admin/editor/editorApi';

// All write operations for the course editor, bundled as one `actions` object.
export default function useEditorActions(courseId) {
  const queryClient = useQueryClient();
  const E = api.entities;
  const [generatingId, setGeneratingId] = useState(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: editorKey(courseId) });
    queryClient.invalidateQueries({ queryKey: ['admin-courses'] });
    queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };
  const useRun = (fn, success) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => { if (success) toast.success(success); refresh(); },
      onError: (err) => { toast.error(err?.message || 'Something went wrong'); refresh(); },
    });

  const saveCourse = useRun((patch) => E.Course.update(courseId, patch), 'Course saved');
  const saveModule = useRun(({ id, patch }) => E.Module.update(id, patch), 'Module saved');
  const saveLesson = useRun(({ id, patch }) => E.Lesson.update(id, patch), 'Lesson saved');
  const addModule = useRun(async ({ title, modules }) => {
    await E.Module.create({ course_id: courseId, title, order: nextOrder(modules), lesson_count: 0 });
    await syncCounts(courseId);
  }, 'Module added');
  const deleteModule = useRun(async ({ module, lessons }) => {
    await Promise.all(lessons.map((l) => E.Lesson.delete(l.id)));
    await E.Module.delete(module.id);
    await syncCounts(courseId);
  }, 'Module deleted');
  const addLesson = useRun(async ({ moduleId, title, lessons }) => {
    await E.Lesson.create({ module_id: moduleId, title, order: nextOrder(lessons), status: 'pending' });
    await syncCounts(courseId);
  }, 'Lesson added');
  const deleteLesson = useRun(async (lesson) => {
    await E.Lesson.delete(lesson.id);
    await syncCounts(courseId);
  }, 'Lesson deleted');
  const reorderItems = useRun(({ entity, items, previous }) => persistOrder(entity, items, previous));

  const generate = useMutation({
    mutationFn: async (lesson) => {
      setGeneratingId(lesson.id);
      const { data } = await api.functions.invoke('generateLessonContent', { lesson_id: lesson.id });
      return data;
    },
    onSuccess: () => toast.success('Lesson content generated — ready for review'),
    onError: (err) => toast.error(err?.message || 'Generation failed'),
    onSettled: () => { setGeneratingId(null); refresh(); },
  });

  // Optimistically apply a new ordering, then persist.
  const applyOrder = (field, entity, items, previous) => {
    queryClient.setQueryData(editorKey(courseId), (old) => {
      if (!old) return old;
      if (field === 'modules') return { ...old, modules: items };
      const byId = Object.fromEntries(items.map((i) => [i.id, i]));
      return { ...old, lessons: old.lessons.map((l) => byId[l.id] || l).sort((a, b) => a.order - b.order) };
    });
    reorderItems.mutate({ entity, items, previous });
  };

  return {
    saveCourse, saveModule, saveLesson, addModule, deleteModule, addLesson, deleteLesson, generate, generatingId,
    reorderModules: (items, previous) => applyOrder('modules', 'Module', items, previous),
    reorderLessons: (items, previous) => applyOrder('lessons', 'Lesson', items, previous),
  };
}
