import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, Clapperboard, Download, FileUp, ImagePlus, Loader2, Plus, RefreshCw, Save, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import ConfirmDeleteButton from '@/components/admin/editor/ConfirmDeleteButton';
import { apiUrl } from '@/lib/mount';
import { fmtSeconds, jobActive, useLatestJob, useProject, useProjects, useRefreshStudio } from '@/lib/studio';
import DropboxPicker from './DropboxPicker';
import JobStatus from './JobStatus';
import { Choice, Field, Notice } from './StudioFields';

const LAYOUTS = ['points', 'steps', 'checklist', 'rule', 'definition', 'timeline'].map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }));
const SOURCES = [
  { value: 'lesson', label: 'A lesson' }, { value: 'meeting', label: 'A meeting briefing' },
  { value: 'dropbox', label: 'A Dropbox file (PDF, Word, PowerPoint, text)' },
  { value: 'document', label: 'Upload a document (PDF, Word, text)' }, { value: 'text', label: 'Paste text' }, { value: 'blank', label: 'Blank video' },
];

function NewProjectDialog({ open, onOpenChange, onCreated }) {
  const [source, setSource] = useState('lesson');
  const [sourceId, setSourceId] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [dbxFile, setDbxFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const lessons = useQuery({ queryKey: ['studio-ai', 'pick', 'lessons'], queryFn: () => api.entities.Lesson.list('-updated_date', 300), enabled: open && source === 'lesson' });
  const meetings = useQuery({ queryKey: ['studio-ai', 'pick', 'meetings'], queryFn: () => api.entities.Meeting.list('-meeting_date', 200), enabled: open && source === 'meeting' });
  const options = source === 'lesson'
    ? (lessons.data || []).filter((l) => l.teaching_script || l.video_scenes).map((l) => ({ value: l.id, label: l.title }))
    : (meetings.data || []).filter((m) => m.briefing_scenes).map((m) => ({ value: m.id, label: `${m.title}${m.meeting_date ? ` · ${m.meeting_date}` : ''}` }));

  const create = async () => {
    setBusy(true);
    try {
      const p = source === 'document'
        ? await api.studio.createFromDocument(file)
        : source === 'dropbox'
          ? await api.studio.createFromDropbox({ account: dbxFile.account, file_id: dbxFile.id })
          : await api.studio.createProject({ source_type: source, source_id: sourceId || undefined, text: source === 'text' ? text : undefined, title: title || undefined });
      toast.success(p.reused
        ? `“${p.title}” was already made from this revision of the file — opened it instead of processing it again`
        : `Created “${p.title}” with ${p.scenes.length} scene${p.scenes.length === 1 ? '' : 's'}`);
      onCreated(p);
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not create the video');
    } finally {
      setBusy(false);
    }
  };
  const ready = source === 'document' ? !!file : source === 'dropbox' ? !!dbxFile : source === 'text' ? text.trim().length > 40 : source === 'blank' ? true : !!sourceId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>New video</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label="Start from" htmlFor="np-source"><Choice id="np-source" value={source} onChange={(v) => { setSource(v); setSourceId(''); }} options={SOURCES} /></Field>
          {(source === 'lesson' || source === 'meeting') && (
            <Field label={source === 'lesson' ? 'Lesson (with generated content)' : 'Meeting (with a video briefing)'} htmlFor="np-id">
              <Choice id="np-id" value={sourceId} onChange={setSourceId} options={[{ value: '', label: (lessons.isLoading || meetings.isLoading) ? 'Loading…' : 'Choose…' }, ...options]} />
            </Field>
          )}
          {source === 'document' && (
            <Field label="Document" htmlFor="np-file" hint="The AI turns it into scenes with narration (when AI is configured).">
              <Input id="np-file" type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Field>
          )}
          {source === 'dropbox' && <DropboxPicker value={dbxFile} onChange={setDbxFile} />}
          {source === 'text' && <Field label="Text" htmlFor="np-text"><Textarea id="np-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the material the video should explain…" /></Field>}
          {!['document', 'dropbox'].includes(source) && <Field label="Title (optional)" htmlFor="np-title"><Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={!ready || busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SceneEditor({ project, scene, index, count, onChange, onMove, onRemove, onImage, onRerender, previewVersion, rendering }) {
  const set = (k) => (e) => onChange({ ...scene, [k]: e?.target ? e.target.value : e });
  return (
    <article className="grid gap-4 rounded-2xl border border-border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
          <Input value={scene.title} onChange={set('title')} placeholder="Scene title" className="font-medium" />
          <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp /></Button>
          <Button size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown /></Button>
          <Button size="icon" variant="ghost" disabled={count === 1} onClick={onRemove} aria-label="Remove scene"><Trash2 /></Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label="Layout" htmlFor={`l-${scene.id}`}><Choice id={`l-${scene.id}`} value={scene.layout} onChange={set('layout')} options={LAYOUTS} /></Field>
          {scene.layout === 'rule'
            ? <Field label="Key sentence" htmlFor={`q-${scene.id}`}><Input id={`q-${scene.id}`} value={scene.quote || ''} onChange={set('quote')} /></Field>
            : scene.layout === 'definition'
              ? <div className="grid grid-cols-2 gap-2"><Field label="Term" htmlFor={`t-${scene.id}`}><Input id={`t-${scene.id}`} value={scene.term || ''} onChange={set('term')} /></Field><Field label="Definition" htmlFor={`d-${scene.id}`}><Input id={`d-${scene.id}`} value={scene.definition || ''} onChange={set('definition')} /></Field></div>
              : <Field label="On-screen points (one per line)" htmlFor={`p-${scene.id}`}><Textarea id={`p-${scene.id}`} rows={3} value={(scene.points || []).join('\n')} onChange={(e) => onChange({ ...scene, points: e.target.value.split('\n') })} /></Field>}
        </div>
        <Field label="Narration (what the teacher says)" htmlFor={`n-${scene.id}`} hint={`${(scene.narration || '').length} characters`}>
          <Textarea id={`n-${scene.id}`} rows={4} value={scene.narration || ''} onChange={set('narration')} />
        </Field>
      </div>
      <div className="space-y-2">
        <img src={api.studio.scenePreviewUrl(project.id, scene.id, previewVersion)} alt={`Preview of scene ${index + 1}`} className="aspect-video w-full rounded-xl border border-border bg-slate-950 object-cover" loading="lazy" />
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <label className="cursor-pointer"><ImagePlus /> {scene.image_key ? 'Replace image' : 'Slide image'}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} /></label>
          </Button>
          {scene.image_key && <Button size="sm" variant="ghost" onClick={() => onImage(null)}><X /> Remove image</Button>}
          {project.video_url && <Button size="sm" variant="ghost" disabled={rendering} onClick={onRerender}><RefreshCw /> Re-render this scene</Button>}
        </div>
      </div>
    </article>
  );
}

function ProjectEditor({ id, onDeleted, config }) {
  const refresh = useRefreshStudio();
  const { data: project, refetch } = useProject(id);
  const { data: job, refetch: refetchJob } = useLatestJob('project', id);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(String(Date.now()));
  useEffect(() => { if (project) setDraft(project); }, [project?.id, project?.updated_date]);
  useEffect(() => { if (job && !jobActive(job)) refetch(); }, [job?.status]);
  const dirty = useMemo(() => !!draft && !!project && JSON.stringify(draft) !== JSON.stringify(project), [draft, project]);
  if (!draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const scenes = draft.scenes || [];
  const setScenes = (next) => setDraft((d) => ({ ...d, scenes: next }));
  const save = async () => {
    setSaving(true);
    try {
      await api.studio.updateProject(id, { title: draft.title, eyebrow: draft.eyebrow, language: draft.language, voice_provider: draft.voice_provider, presenter: draft.presenter, burn_captions: draft.burn_captions, scenes });
      await refetch();
      setVersion(String(Date.now()));
      toast.success('Saved');
      return true;
    } catch (e) {
      toast.error(e?.message || 'Could not save');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const render = async (sceneId) => {
    if (dirty && !(await save())) return;
    try {
      await (sceneId ? api.studio.rerenderScene(id, sceneId) : api.studio.render(id));
      toast.success(sceneId ? 'Re-rendering that scene' : 'Rendering started');
    } catch (e) {
      toast.error(e?.message || 'Could not start rendering');
    } finally {
      refetchJob();
      refresh();
    }
  };
  const image = async (scene, file) => {
    if (dirty && !(await save())) return;
    try {
      await (file ? api.studio.uploadSceneImage(id, scene.id, file) : api.studio.removeSceneImage(id, scene.id));
      await refetch();
      setVersion(String(Date.now()));
    } catch (e) {
      toast.error(e?.message || 'Could not update the image');
    }
  };
  const rendering = jobActive(job);
  const chars = scenes.reduce((n, s) => n + (s.narration || '').length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Title" htmlFor="pe-title"><Input id="pe-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="min-w-72" /></Field>
        <Field label="Header line" htmlFor="pe-eyebrow"><Input id="pe-eyebrow" value={draft.eyebrow || ''} onChange={(e) => setDraft({ ...draft, eyebrow: e.target.value })} /></Field>
        <Field label="Voice language" htmlFor="pe-lang"><Input id="pe-lang" value={draft.language || ''} onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder={config?.voice?.defaults?.language} className="w-28" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={draft.presenter !== false} onCheckedChange={(v) => setDraft({ ...draft, presenter: v })} /> Teacher</label>
        <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={draft.burn_captions !== false} onCheckedChange={(v) => setDraft({ ...draft, burn_captions: v })} /> Subtitles on video</label>
        <span className="ml-auto flex gap-2 pb-0.5">
          <Button variant="outline" onClick={save} disabled={!dirty || saving}><Save /> Save</Button>
          <Button onClick={() => render()} disabled={rendering || !config?.video?.enabled}>{rendering ? <Loader2 className="animate-spin" /> : <Clapperboard />} Render MP4</Button>
          <ConfirmDeleteButton label="Delete video" title={`Delete “${draft.title}”?`} description="The project and its scenes are removed. Rendered files already downloaded are not affected." onConfirm={async () => { await api.studio.deleteProject(id); refresh(); onDeleted(); }} />
        </span>
      </div>
      {!config?.video?.enabled && <Notice tone="warn">Video rendering is not available on the server (FFmpeg not found). See VIDEO_ENGINE_SETUP.md.</Notice>}
      {!config?.voice?.enabled && <Notice tone="warn">No voice provider is configured, so the scenes cannot be voiced. See GOOGLE_TTS_SETUP.md.</Notice>}
      <p className="text-xs text-muted-foreground">{scenes.length} scenes · {chars.toLocaleString()} characters of narration. Rendering voices only scenes whose narration changed (the rest come from the audio cache) and re-renders only changed scenes.</p>
      <JobStatus job={job} onChange={refetch} />
      {project.video_url && (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={project.video_url} controls poster={apiUrl(project.thumbnail_url)} className="aspect-video w-full rounded-xl bg-black">
            <source src={apiUrl(project.video_url)} type="video/mp4" />
            {project.subtitles_url && <track kind="subtitles" srcLang="en" label="English" src={apiUrl(project.subtitles_url)} />}
          </video>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Rendered {project.rendered_at ? new Date(project.rendered_at).toLocaleString() : ''}</p>
            <p className="text-muted-foreground">{fmtSeconds(project.video_seconds)} · {project.scenes_rendered} rendered, {project.scenes_reused} reused</p>
            <Button asChild size="sm" className="w-full"><a href={apiUrl(project.video_url)} download={`${draft.title}.mp4`}><Download /> MP4</a></Button>
            {project.srt_url && <Button asChild size="sm" variant="outline" className="w-full"><a href={apiUrl(project.srt_url)} download={`${draft.title}.srt`}><Download /> Subtitles (SRT)</a></Button>}
            {project.subtitles_url && <Button asChild size="sm" variant="outline" className="w-full"><a href={apiUrl(project.subtitles_url)} download={`${draft.title}.vtt`}><Download /> Subtitles (VTT)</a></Button>}
          </div>
        </div>
      )}
      {project.status === 'failed' && project.error && <Notice tone="error">{project.error}</Notice>}
      <div className="space-y-3">
        {scenes.map((s, i) => (
          <SceneEditor
            key={s.id} project={project} scene={s} index={i} count={scenes.length} previewVersion={version} rendering={rendering}
            onChange={(next) => setScenes(scenes.map((x) => (x.id === s.id ? next : x)))}
            onMove={(d) => { const next = [...scenes]; next.splice(i + d, 0, next.splice(i, 1)[0]); setScenes(next); }}
            onRemove={() => setScenes(scenes.filter((x) => x.id !== s.id))}
            onImage={(file) => image(s, file)}
            onRerender={() => render(s.id)}
          />
        ))}
        <Button variant="outline" onClick={() => setScenes([...scenes, { id: Math.random().toString(36).slice(2, 10), title: 'New scene', layout: 'points', points: ['Key point'], narration: '' }])}><Plus /> Add scene</Button>
      </div>
    </div>
  );
}

// Video Studio: projects (from lessons, meeting briefings, documents, text or blank), scene editing,
// rendering MP4s in the background and downloading them with subtitles.
export default function VideoStudio({ config }) {
  const { data: projects = [], isLoading } = useProjects();
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const refresh = useRefreshStudio();
  const current = selected && projects.some((p) => p.id === selected) ? selected : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Button className="w-full" onClick={() => setCreating(true)}><Plus /> New video</Button>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !projects.length && <p className="text-sm text-muted-foreground">No videos yet. Start one from a lesson, a meeting briefing or a document.</p>}
        <ul className="space-y-1.5">
          {projects.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSelected(p.id)} className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${current === p.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent'}`}>
                <span className="block truncate font-medium">{p.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.scene_count} scenes
                  <Badge variant={p.status === 'ready' ? 'default' : p.status === 'failed' ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px] capitalize">{p.status}</Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="w-full" onClick={refresh}><FileUp className="hidden" /><RefreshCw /> Refresh</Button>
      </aside>
      <section className="min-w-0">
        {current ? <ProjectEditor key={current} id={current} config={config} onDeleted={() => setSelected(null)} />
          : <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Choose a video on the left, or create a new one.</div>}
      </section>
      <NewProjectDialog open={creating} onOpenChange={setCreating} onCreated={(p) => { refresh(); setSelected(p.id); }} />
    </div>
  );
}
