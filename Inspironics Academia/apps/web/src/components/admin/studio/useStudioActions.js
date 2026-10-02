import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { approveAll, generateLessons, generateMedia, generateTests, publishCourse, runPlaybookPipeline } from '@/lib/pipeline';
import { flattenLessons } from '@/lib/progress';

const summarize = (label, r) => {
  if (r.unavailable) return toast.error(`${label} unavailable: ${r.error}`);
  return r.failed
    ? toast.warning(`${label}: ${r.succeeded} succeeded, ${r.failed} failed`)
    : toast.success(`${label}: ${r.succeeded} completed`);
};

// Long-running studio actions with shared progress state: job = { key, label, unit, done, total }.
export default function useStudioActions(data) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['studio'] });

  const track = async (key, label, unit, runner) => {
    setJob({ key, label, unit, done: 0, total: 0 });
    try {
      return await runner(({ done, total }) => {
        setJob({ key, label, unit, done, total });
        refresh();
      });
    } catch (err) {
      toast.error(`${label} failed: ${err?.message || 'Unknown error'}`);
      return null;
    } finally {
      setJob(null);
      refresh();
    }
  };

  const ordered = () => flattenLessons(data?.modules, data?.lessons);

  const generatePackage = async () => {
    const targets = ordered().filter((l) => l.status === 'pending' || l.status === 'rejected');
    if (!targets.length) return toast.info('All lessons already have content');
    const r = await track('package', 'Generating learning package', 'lessons', (p) => generateLessons(targets, p));
    if (r) summarize('Learning package', r);
  };

  const regenerateMedia = async () => {
    const targets = ordered().filter((l) => l.teaching_script);
    if (!targets.length) return toast.info('Generate lesson content before media');
    const r = await track('media', 'Generating media', 'lessons', (p) => generateMedia(targets, p));
    if (r) summarize('Media', r);
  };

  const generateAllTests = async () => {
    const r = await track('tests', 'Generating tests', 'tests', (p) => generateTests(data.course, data.modules, p));
    if (r) summarize('Tests', r);
  };

  const approveEverything = async () => {
    const r = await track('approve', 'Approving content', 'items', () => approveAll(data));
    if (r) toast.success(`Approved ${r.lessons} lessons, ${r.questions} questions, ${r.flashcards} flashcards, ${r.assessments} tests`);
  };

  const publish = async () => {
    const r = await track('publish', 'Publishing course', 'items', () => publishCourse(data));
    if (!r) return;
    toast.success(`“${data.course.title}” is now published`);
    queryClient.invalidateQueries();
    navigate('/courses');
  };

  const buildStructure = async () => {
    const r = await track('structure', 'Building course structure', 'steps', () =>
      runPlaybookPipeline(data.playbook.id, { skipExtract: (data.chapters?.length || 0) > 0 }));
    if (r?.ok) toast.success('Course structure built');
    else if (r?.skipped) toast.info('An active course already exists');
    else if (r) toast.error(`Failed: ${r.error}`);
  };

  return { job, busy: !!job, generatePackage, regenerateMedia, generateAllTests, approveEverything, publish, buildStructure };
}
