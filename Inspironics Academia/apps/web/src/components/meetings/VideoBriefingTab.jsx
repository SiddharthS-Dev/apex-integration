import { useState } from 'react';
import { AlertTriangle, Clapperboard, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import AiVideoPlayer from '@/components/AiVideoPlayer';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { parseScenes } from '@/components/lesson/scenes';
import SpokenBriefingPlayer from '@/components/meetings/SpokenBriefingPlayer';
import RenderedVideoPanel from '@/components/studio/RenderedVideoPanel';
import { useInvalidateMeetings } from '@/lib/meetings';

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

// The meeting's video briefing: an animated teacher walks the team through the purpose, what was
// discussed and decided, the requirements and — above all — who has to do what by when, with slides
// and subtitles in step with the narration. Admins generate (and regenerate) it with the configured
// AI and voice providers, and can render it as an MP4 to download or share.
export default function VideoBriefingTab({ meeting, isAdmin }) {
  const refresh = useInvalidateMeetings();
  const [busy, setBusy] = useState(false);
  const scenes = parseScenes({ video_scenes: meeting.briefing_scenes });
  const recorded = !!meeting.briefing_audio_url;
  const ready = meeting.briefing_status === 'ready' && scenes.length > 0;
  const generating = busy || meeting.briefing_status === 'generating';
  const context = { course: 'Meeting briefing', module: meeting.team ? `${meeting.team} team` : meeting.title, presenter: true };

  const generate = async () => {
    setBusy(true);
    const id = toast.loading('Generating the video briefing — writing the script and recording the voice-over. This takes a few minutes…');
    try {
      const { data } = await api.functions.invoke('generateMeetingVideo', { meeting_id: meeting.id });
      toast.success('Video briefing ready', {
        id,
        description: `${data.scenes} scenes · ${clock(data.seconds)}${data.method === 'notes' ? ' · written from the meeting notes' : ''}${data.voice === 'browser' ? ' · read aloud by the browser (no recorded voice-over)' : ''}`,
      });
    } catch (e) {
      toast.error(e?.message || 'Could not generate the video', { id });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const generateButton = (label) => (
    <Button onClick={generate} disabled={generating} variant={ready ? 'outline' : 'default'} size={ready ? 'sm' : 'default'}>
      {generating ? <Loader2 className="animate-spin" /> : ready ? <RefreshCw /> : <Sparkles />}
      {generating ? 'Generating…' : label}
    </Button>
  );

  if (!ready) {
    if (generating) {
      return <EmptyState icon={Loader2} title="Recording the video briefing…" description="The script is being written from the meeting notes and voiced scene by scene. This usually takes a few minutes." />;
    }
    return (
      <div className="space-y-4">
        {meeting.briefing_status === 'failed' && meeting.briefing_error && isAdmin && (
          <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The last attempt failed: {meeting.briefing_error}
          </p>
        )}
        <EmptyState
          icon={Clapperboard}
          title="No video briefing yet"
          description={isAdmin
            ? 'Generate a narrated video in which an animated teacher explains the purpose of the meeting, what was decided, the requirements and every open action item with its owner and due date.'
            : 'A video summary of this meeting will appear here once it has been made.'}
          action={isAdmin ? generateButton('Generate video briefing') : undefined}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        {recorded ? (
          <AiVideoPlayer
            audioUrl={meeting.briefing_audio_url}
            scenes={scenes}
            title={`${meeting.title} — video briefing`}
            autoPlay={false}
            context={context}
          />
        ) : <SpokenBriefingPlayer scenes={scenes} context={context} />}
        {!recorded && isAdmin && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>No recorded voice-over{meeting.briefing_error ? ` — ${meeting.briefing_error}` : ''}. The browser reads the briefing aloud instead; regenerate once a voice provider is configured (Rendering the MP4 records the voice-over scene by scene).</span>
          </p>
        )}
        <RenderedVideoPanel
          target={{ type: 'meeting', id: meeting.id }}
          fn="renderMeetingVideo"
          payload={{ meeting_id: meeting.id }}
          title={`${meeting.title} - briefing`}
          isAdmin={isAdmin}
          onRendered={refresh}
          video={{ url: meeting.briefing_video_url, thumbnail: meeting.briefing_thumbnail_url, vtt: meeting.briefing_subtitles_url, srt: meeting.briefing_srt_url, seconds: meeting.briefing_video_seconds, renderedAt: meeting.briefing_video_rendered_at }}
        />
        <p className="text-xs text-muted-foreground">
          {meeting.briefing_generated_at && <>Generated {when(meeting.briefing_generated_at)}</>}
          {meeting.briefing_method === 'notes' && ' · written from the meeting notes'}
          {' · '}Subtitles and scene skipping are in the player controls.
        </p>
      </div>
      <aside className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">In this video</h2>
          {isAdmin && generateButton('Regenerate')}
        </div>
        <ol className="space-y-1.5">
          {scenes.map((s, i) => (
            <li key={s.index} className="flex gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{clock(s.start)}{s.source ? ` · ${s.source}` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
        {isAdmin && meeting.status !== 'published' && (
          <p className="text-xs text-muted-foreground">Learners see the video once the meeting is published.</p>
        )}
      </aside>
    </div>
  );
}
