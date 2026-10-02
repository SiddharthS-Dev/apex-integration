import { Clapperboard, Film, Loader2, Presentation, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DisabledReason from '@/components/DisabledReason';
import AiVideoPlayer from '@/components/AiVideoPlayer';
import { hasSlides, parseScenes } from '@/components/lesson/scenes';
import useAppConfig, { MEDIA_DISABLED_REASON } from '@/lib/useAppConfig';

const fmt = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function MediaTab({ lesson, busy, onGenerateMedia, onRebuildSlides }) {
  const hasMedia = lesson.video_url || lesson.audio_url;
  const scenes = parseScenes(lesson);
  const slides = hasSlides(scenes);
  // Narration recorded scene by scene can take new slides without being recorded again.
  const canRebuild = !!(lesson.audio_url && scenes.length && onRebuildSlides);
  const { media_enabled: media } = useAppConfig();
  return (
    <div className="space-y-4">
      {hasMedia ? (
        <AiVideoPlayer
          key={`${lesson.video_url}|${lesson.audio_url}|${lesson.video_scenes || ''}`}
          videoUrl={lesson.video_url}
          audioUrl={lesson.audio_url}
          title={lesson.video_title || lesson.title}
          narrationText={lesson.teaching_script || lesson.summary}
          scenes={scenes}
          autoPlay={false}
          context={{ module: lesson.source_section || lesson.source_chapter }}
        />
      ) : (
        <div className="w-full aspect-video rounded-xl bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Film className="w-8 h-8" />
          <span className="text-sm">No video generated yet</span>
        </div>
      )}
      {scenes.length > 1 && (
        <div className="rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Clapperboard className="w-4 h-4 text-primary" /> {scenes.length} {slides ? 'slides' : 'scenes'}, synced to the narration
          </div>
          <ol className="grid gap-1 sm:grid-cols-2 text-xs">
            {scenes.map((s) => (
              <li key={s.index} className="flex items-center gap-2 min-w-0">
                <span className="tabular-nums text-muted-foreground shrink-0 w-20">{fmt(s.start)}–{fmt(s.end)}</span>
                <span className="truncate" title={s.title}>{s.index + 1}. {s.title}</span>
                {!slides && <span className="text-amber-600 dark:text-amber-400 shrink-0">(old clip — rebuild for slides)</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {lesson.teaching_script
            ? 'The video is built scene by scene from the teaching script: each part is narrated over an explainer slide of its key points, with subtitles.'
            : 'Generate lesson content first to create a narration script.'}
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {canRebuild && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRebuildSlides} title="New slides and subtitles over the narration already recorded — no new audio">
            {busy ? <Loader2 className="animate-spin" /> : <Presentation />}
            Rebuild slides & subtitles
          </Button>
        )}
        <DisabledReason reason={media ? null : MEDIA_DISABLED_REASON}>
          <Button size="sm" variant="outline" disabled={busy || !media || !lesson.teaching_script} onClick={onGenerateMedia}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {hasMedia ? 'Regenerate media' : 'Generate media'}
          </Button>
        </DisabledReason>
        </div>
      </div>
    </div>
  );
}
