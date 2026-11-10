import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, ExternalLink, Loader2, Mic, RefreshCw, Sparkles, Square, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STUDIO_KEY, fmtDate, fmtUsd, jobActive, useUsage } from '@/lib/studio';
import { Choice, Field, Notice } from './StudioFields';

// Generates a course's lesson content (script, summary, key points, quiz, flashcards) with the
// configured AI provider, then optionally its narration and MP4. A one-lesson sample comes first;
// anything larger asks for confirmation with a cost estimate. Existing content is never overwritten
// by a batch — "Regenerate" on a lesson does that, after its own confirmation.

const TONE = {
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  processing: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  failed: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  pending: 'bg-muted text-muted-foreground',
};
const State = ({ value }) => <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[value] || TONE.pending}`}>{value}</span>;

function estimateText(e) {
  if (!e) return '';
  if (e.basis === 'measured') return `about ${fmtUsd(e.total_usd)} (${fmtUsd(e.per_lesson_usd)} per lesson, measured from ${e.sample_lessons} lesson${e.sample_lessons === 1 ? '' : 's'} generated so far)`;
  if (e.low_usd != null) return `roughly ${fmtUsd(e.low_usd)}–${fmtUsd(e.high_usd)} (list prices checked ${e.prices_checked}; generate a sample lesson for a measured figure)`;
  return 'unknown (no price is known for the configured model)';
}

function ProviderStatus({ config, usage }) {
  const ai = config?.ai || {};
  const voice = config?.voice || {};
  const budget = usage?.limits?.aiMonthlyBudgetUsd;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Content (AI)</p>
        <p className="mt-1 font-semibold">{ai.provider === 'gemini' ? 'Google Gemini' : ai.provider || '—'} · {ai.model || '—'}</p>
        <p className={ai.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
          {ai.enabled ? 'Connected — API key configured' : ai.unavailable_reason || 'Not configured'}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narration</p>
        <p className="mt-1 font-semibold">{voice.enabled ? `${voice.default_provider === 'gemini' ? 'Gemini speech' : voice.default_provider}${voice.model ? ` · ${voice.model}` : ''}${voice.voice ? ` · ${voice.voice}` : ''}` : 'Browser voice'}</p>
        <p className="text-muted-foreground">{voice.enabled ? 'Recorded voice-over, cached per text' : 'No voice provider: players read the script aloud; MP4s need recorded narration'}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Budget this month</p>
        <p className="mt-1 font-semibold">{fmtUsd(usage?.estimated_spend_usd)} spent{budget != null ? ` of ${fmtUsd(budget)}` : ''}</p>
        <p className="text-muted-foreground">{budget == null ? 'No monthly budget set (Usage & budget tab)' : `${fmtUsd(usage?.budget_remaining_usd)} left — generation stops at the limit`}. Estimates, not the provider's invoice.</p>
      </div>
    </div>
  );
}

export default function CourseGeneration({ config }) {
  const qc = useQueryClient();
  const { data: usage } = useUsage();
  const courses = useQuery({ queryKey: [...STUDIO_KEY, 'courses'], queryFn: () => api.studio.courses() });
  const [courseId, setCourseId] = useState('');
  useEffect(() => { if (!courseId && courses.data?.length) setCourseId(courses.data[0].id); }, [courseId, courses.data]);
  const progress = useQuery({
    queryKey: [...STUDIO_KEY, 'course-progress', courseId],
    queryFn: () => api.studio.courseProgress(courseId),
    enabled: !!courseId,
    refetchInterval: (q) => (jobActive(q.state.data?.job) ? 3000 : false),
  });
  const [media, setMedia] = useState(false);
  const [render, setRender] = useState(false);
  const [confirm, setConfirm] = useState(null); // { body, selected, estimate }
  const [regen, setRegen] = useState(null); // lesson
  const [busy, setBusy] = useState('');
  const p = progress.data;
  const job = p?.job;
  const running = jobActive(job);
  const aiOn = !!config?.ai?.enabled;
  const voiceOn = !!config?.voice?.enabled;
  const refresh = () => qc.invalidateQueries({ queryKey: STUDIO_KEY });

  const start = async (body, label) => {
    setBusy(label);
    try {
      const r = await api.studio.generateCourse(courseId, { media: media && voiceOn, render: render && voiceOn, ...body });
      if (r.started === false) toast.info(r.reason);
      else toast.success(`Started: ${r.selected} lesson${r.selected === 1 ? '' : 's'}`);
      refresh();
    } catch (e) {
      if (e?.status === 409 && e.details?.confirm_required) setConfirm({ body: { ...body, confirm: true }, selected: e.details.selected, estimate: e.details.estimate });
      else toast.error(e?.message || 'Could not start generation');
    } finally {
      setBusy('');
    }
  };

  const lessonAction = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      toast.success('Done');
    } catch (e) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy('');
      refresh();
    }
  };

  if (courses.isLoading) return <p className="text-sm text-muted-foreground">Loading courses…</p>;
  if (!courses.data?.length) return <Notice>No courses yet. Build one from a playbook in the Content Studio first.</Notice>;
  const t = p?.totals;
  const done = t ? t.content.completed : 0;
  const anyContent = done > 0;

  return (
    <div className="space-y-6">
      <ProviderStatus config={config} usage={usage} />
      {!aiOn && <Notice tone="warn">{config?.ai?.unavailable_reason || 'AI is not configured.'} Add the key to the API server's .env and restart the API.</Notice>}

      <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <Field label="Course" htmlFor="cg-course">
            <Choice id="cg-course" value={courseId} onChange={setCourseId} options={courses.data.map((c) => ({ value: c.id, label: `${c.title} — ${c.module_count ?? '?'} modules, ${c.lesson_count ?? '?'} lessons` }))} />
          </Field>
          {t && (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(done / Math.max(1, t.lessons)) * 100}%` }} /></div>
              <p className="text-sm text-muted-foreground">
                Content {done} / {t.lessons} · {t.content.pending} pending · {t.content.failed} failed{t.content.processing ? ` · ${t.content.processing} in progress` : ''}
                {' '}· Narration {t.narration.completed} · Videos {t.video.completed}
              </p>
            </>
          )}
          {running && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
              <Loader2 className="h-4 w-4 animate-spin" /> {job.message} ({job.progress}%)
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => lessonAction('cancel', () => api.studio.cancelJob(job.id))}><Square /> Stop after this lesson</Button>
            </div>
          )}
          {job && !running && job.result && (
            <p className="text-sm text-muted-foreground">
              Last run ({fmtDate(job.finished_at)}): {job.result.completed} generated, {job.result.failed} failed{job.result.stopped ? ` — stopped: ${job.result.stopped}` : ''}{job.result.media ? ` — narration ${job.result.media}` : ''}.
            </p>
          )}
          {job && job.status === 'failed' && <Notice tone="error">{job.error}</Notice>}
        </div>
        <div className="flex flex-col gap-2 lg:w-72">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Also record narration{voiceOn ? '' : ' (no voice provider)'}</span><Switch checked={media && voiceOn} disabled={!voiceOn} onCheckedChange={setMedia} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Also render the MP4</span><Switch checked={render && media && voiceOn} disabled={!voiceOn || !media} onCheckedChange={setRender} /></label>
          <Button onClick={() => start({ limit: 1 }, 'sample')} disabled={!aiOn || running || !!busy || (t && t.content.pending === 0)}>
            {busy === 'sample' ? <Loader2 className="animate-spin" /> : <Sparkles />} {anyContent ? 'Generate the next lesson' : 'Generate a sample lesson'}
          </Button>
          <Button variant="outline" onClick={() => start({}, 'all')} disabled={!aiOn || running || !!busy || !anyContent || (t && t.content.pending === 0)} title={anyContent ? '' : 'Generate and review a sample lesson first'}>
            {busy === 'all' ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate remaining lessons…
          </Button>
          {t?.content.failed > 0 && <Button variant="outline" onClick={() => start({ retry_failed: true }, 'failed')} disabled={!aiOn || running || !!busy}><RefreshCw /> Retry {t.content.failed} failed</Button>}
          {!anyContent && <p className="text-xs text-muted-foreground">Start with one lesson, check it in the Content Studio, then generate the rest.</p>}
        </div>
      </div>

      {p && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Lesson</TableHead><TableHead>Content</TableHead><TableHead>Narration</TableHead><TableHead>Video</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {p.lessons.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="min-w-64">
                    <p className="font-medium">{l.title}</p>
                    <p className="text-xs text-muted-foreground">{l.module_title}{l.content_generated_at ? ` · generated ${fmtDate(l.content_generated_at)}` : ''}</p>
                    {(l.content_error || l.media_error) && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{l.content_error || l.media_error}</p>}
                  </TableCell>
                  <TableCell><State value={l.content} /></TableCell>
                  <TableCell><State value={l.narration} /></TableCell>
                  <TableCell>{l.rendered_video_url ? <a className="text-primary underline" href={l.rendered_video_url} target="_blank" rel="noreferrer">MP4</a> : <State value={l.video} />}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {l.content !== 'completed' && (
                      <Button size="sm" variant="ghost" disabled={!aiOn || running || !!busy} onClick={() => start({ lesson_ids: [l.id], retry_failed: true }, `gen-${l.id}`)}>
                        {busy === `gen-${l.id}` ? <Loader2 className="animate-spin" /> : <Sparkles />} {l.content === 'failed' ? 'Retry' : 'Generate'}
                      </Button>
                    )}
                    {l.content === 'completed' && (
                      <>
                        <Button size="sm" variant="ghost" disabled={!aiOn || running || !!busy} onClick={() => setRegen(l)}><RefreshCw /> Regenerate</Button>
                        <Button size="sm" variant="ghost" disabled={!voiceOn || !!busy} onClick={() => lessonAction(`media-${l.id}`, () => api.functions.invoke('generateLessonMedia', { lesson_id: l.id }))}>
                          {busy === `media-${l.id}` ? <Loader2 className="animate-spin" /> : <Mic />} Narrate
                        </Button>
                        <Button size="sm" variant="ghost" disabled={l.narration !== 'completed' || !!busy} onClick={() => lessonAction(`render-${l.id}`, () => api.functions.invoke('renderLessonVideo', { lesson_id: l.id }))}><Clapperboard /> Render</Button>
                      </>
                    )}
                    {p.course.playbook_id && (
                      <Button asChild size="sm" variant="ghost"><Link to={`/admin/studio/${p.course.playbook_id}`} title="Review in the Content Studio"><ExternalLink /></Link></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate {confirm?.selected} lessons?</AlertDialogTitle>
            <AlertDialogDescription>
              Estimated cost: {estimateText(confirm?.estimate)}. Lessons that already have content are skipped. The batch runs in the background, resumes where it stopped, and halts if the monthly budget is reached.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const body = confirm.body; setConfirm(null); start(body, 'all'); }}><Wand2 /> Generate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!regen} onOpenChange={(o) => !o && setRegen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the content of “{regen?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The script, summary, key points, quiz questions and flashcards are generated again and replace the current ones (one AI request). Narration and video are not changed until you narrate and render again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current content</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const l = regen; setRegen(null); lessonAction(`regen-${l.id}`, () => api.functions.invoke('generateLessonContent', { lesson_id: l.id, fresh: true })); }}><RefreshCw /> Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
