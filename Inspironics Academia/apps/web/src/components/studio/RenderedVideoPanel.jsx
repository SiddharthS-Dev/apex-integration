import { useEffect } from 'react';
import { Clapperboard, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { apiUrl } from '@/lib/mount';
import { fmtSeconds, jobActive, useLatestJob, useRefreshStudio } from '@/lib/studio';
import useAppConfig from '@/lib/useAppConfig';
import JobStatus from './JobStatus';

// "Render MP4" for a lesson or a meeting briefing: starts the background render, shows its real
// progress, and offers the MP4 and subtitles once rendered. Admins render; everyone can download.
//   target: { type: 'lesson' | 'meeting', id }, fn: 'renderLessonVideo' | 'renderMeetingVideo'
//   video: { url, thumbnail, vtt, srt, seconds, renderedAt }
export default function RenderedVideoPanel({ target, fn, payload, video, title, isAdmin, onRendered }) {
  const { video_render_enabled: enabled } = useAppConfig();
  const refresh = useRefreshStudio();
  const { data: job, refetch } = useLatestJob(isAdmin ? target.type : null, isAdmin ? target.id : null);
  const running = jobActive(job);
  // When a render finishes, the record (with its new MP4) is fetched again.
  const status = job?.status;
  useEffect(() => { if (status === 'completed') onRendered?.(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!video?.url && !isAdmin) return null;

  const start = async () => {
    try {
      await api.functions.invoke(fn, payload);
      toast.success('Rendering the MP4 in the background — you can keep working');
    } catch (e) {
      toast.error(e?.message || 'Could not start rendering');
    } finally {
      refetch();
      refresh();
    }
  };
  const safe = (title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim();

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">MP4 video</span>
        {video?.url && <span className="text-xs text-muted-foreground">{fmtSeconds(video.seconds)}{video.renderedAt ? ` · rendered ${new Date(video.renderedAt).toLocaleDateString()}` : ''}</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          {video?.url && <Button asChild size="sm" variant="outline"><a href={apiUrl(video.url)} download={`${safe}.mp4`}><Download /> MP4</a></Button>}
          {video?.srt && <Button asChild size="sm" variant="ghost"><a href={apiUrl(video.srt)} download={`${safe}.srt`}>SRT</a></Button>}
          {video?.vtt && <Button asChild size="sm" variant="ghost"><a href={apiUrl(video.vtt)} download={`${safe}.vtt`}>VTT</a></Button>}
          {isAdmin && (
            <Button size="sm" onClick={start} disabled={running || !enabled} title={enabled ? '' : 'Video rendering is not available on the server'}>
              {running ? <Loader2 className="animate-spin" /> : <Clapperboard />} {video?.url ? 'Re-render MP4' : 'Render MP4'}
            </Button>
          )}
        </span>
      </div>
      {isAdmin && job && <JobStatus job={job} onChange={() => { refetch(); onRendered?.(); }} />}
    </div>
  );
}
