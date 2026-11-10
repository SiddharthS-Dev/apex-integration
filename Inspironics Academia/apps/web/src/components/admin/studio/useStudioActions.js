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

  // What a bulk action is about to spend, shown for confirmation before it starts.
  const estimate = (kind, { autoAudio = false } = {}) => {
    const lessons = ordered();
    if (kind === 'package') {
      const n = lessons.filter((l) => l.status === 'pending' || l.status === 'rejected').length;
      return { count: n, lines: [
        `${n} lesson${n === 1 ? '' : 's'} without content`,
        `≈ ${n} AI request${n === 1 ? '' : 's'} (one per lesson: script, quiz and flashcards)`,
        autoAudio ? `plus ≈ ${n} storyboard requests and the voice-over of every lesson (AUTO_GENERATE_AUDIO is on)` : 'No voice-over or video: generate media separately, per lesson or with Regenerate Media',
      ] };
    }
    if (kind === 'media') {
      const withScript = lessons.filter((l) => l.teaching_script);
      const chars = withScript.reduce((sum, l) => sum + Math.min(5000, String(l.teaching_script).length), 0);
      return { count: withScript.length, lines: [
        `${withScript.length} lesson${withScript.length === 1 ? '' : 's'} with a script`,
        `≈ ${withScript.length} AI requests (slide storyboards)`,
        `up to ≈ ${chars.toLocaleString()} characters of voice-over (narration already recorded with the same text and voice is reused at no cost)`,
      ] };
    }
    const modules = data?.modules?.length || 0;
    return { count: modules + 1, lines: [
      `${modules} module test${modules === 1 ? '' : 's'} and a final assessment`,
      `≈ ${modules + 3} AI requests (questions are written 20 at a time)`,
    ] };
  };

  return { job, busy: !!job, generatePackage, regenerateMedia, generateAllTests, approveEverything, publish, buildStructure, estimate };
}
