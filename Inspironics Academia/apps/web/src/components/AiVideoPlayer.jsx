import MediaPlaceholder from '@/components/lesson/MediaPlaceholder';
import NarratedPlayer from '@/components/lesson/NarratedPlayer';
import SpeechNarrationControls from '@/components/lesson/SpeechNarrationControls';
import { apiUrl } from '@/lib/mount';

// The frame is a size container: slides and subtitles scale with it, like a rendered video would.
const FRAME = 'relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 shadow-sm [container-type:inline-size]';

// Plays an AI lesson: scene clips (or one short looping clip) synced to long narration audio.
// Without narration audio, `narrationText` is read aloud with the browser's speech engine instead.
// Media URLs are same-origin /api/media/... paths (session cookie), never signed URLs.
export default function AiVideoPlayer({ videoUrl: rawVideoUrl, audioUrl: rawAudioUrl, title, narrationText, autoPlay = true, scenes: rawScenes = [], context }) {
  // Stored as '/api/media/...'; prefixed with the API's mount so they still resolve under Apex.
  const videoUrl = apiUrl(rawVideoUrl);
  const audioUrl = apiUrl(rawAudioUrl);
  const scenes = rawScenes.map((s) => (s.videoUrl ? { ...s, videoUrl: apiUrl(s.videoUrl) } : s));
  if (audioUrl) {
    return (
      <div className={FRAME}>
        <NarratedPlayer key={`${videoUrl || ''}|${audioUrl}`} videoUrl={videoUrl} audioUrl={audioUrl} title={title} autoPlay={autoPlay} scenes={scenes} context={context} />
      </div>
    );
  }

  return (
    <div className={FRAME}>
      {videoUrl ? (
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay={autoPlay}
          muted={autoPlay}
          loop={!!narrationText}
          playsInline
          className="absolute inset-0 w-full h-full object-contain"
          title={title}
        />
      ) : (
        <MediaPlaceholder title={title} label={narrationText ? 'Video coming soon — listen to the narration meanwhile' : 'Video coming soon'} />
      )}
      {narrationText && <SpeechNarrationControls text={narrationText} className={videoUrl ? 'top-3 left-3' : 'bottom-4 inset-x-0 justify-center'} />}
    </div>
  );
}
