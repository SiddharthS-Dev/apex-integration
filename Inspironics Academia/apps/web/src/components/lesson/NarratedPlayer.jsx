import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import useNarrationSync from '@/components/lesson/useNarrationSync';
import PlayerControls from '@/components/lesson/PlayerControls';
import MediaPlaceholder from '@/components/lesson/MediaPlaceholder';
import NarrationOverlay from '@/components/lesson/NarrationOverlay';
import SlideStage from '@/components/lesson/SlideStage';
import Captions from '@/components/lesson/Captions';
import { captionAt, hasSlides, sceneAt } from '@/components/lesson/scenes';

const CC_KEY = 'academy.captions';

// Subtitles default to on; the choice is remembered on this device.
function useCaptionsPref() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(CC_KEY) !== 'off'; } catch { return true; }
  });
  const toggle = useCallback(() => setOn((v) => {
    try { localStorage.setItem(CC_KEY, v ? 'off' : 'on'); } catch { /* storage unavailable */ }
    return !v;
  }), []);
  return [on, toggle];
}

// Plays the scene clip that matches the current point of the narration: every clip is a stacked,
// muted, looping <video>; only the active one is visible and playing, and the next one preloads so
// the cross-fade is instant. The scene title is drawn by the page (crisp text, never by the model).
function SceneStage({ scenes, current, playing, onToggle }) {
  const refs = useRef({});
  const [ready, setReady] = useState({});
  const [shownUrl, setShownUrl] = useState(null);
  const active = sceneAt(scenes, current);
  const activeUrl = scenes[active]?.videoUrl;
  const nextUrl = scenes[active + 1]?.videoUrl;
  const urls = useMemo(() => [...new Set(scenes.map((s) => s.videoUrl).filter(Boolean))], [scenes]);

  // Keep the previous clip on screen until the new scene's clip can play, so a scene change or a
  // far seek cross-fades instead of flashing an empty frame.
  useEffect(() => {
    if (activeUrl && (ready[activeUrl] || !shownUrl)) setShownUrl(activeUrl);
  }, [activeUrl, ready, shownUrl]);

  useEffect(() => {
    for (const [url, el] of Object.entries(refs.current)) {
      if (!el) continue;
      if ((url === activeUrl || url === shownUrl) && playing) el.play().catch(() => {});
      else el.pause();
    }
  }, [activeUrl, shownUrl, playing]);

  const scene = scenes[active];
  return (
    <>
      {urls.map((url) => (
        <video
          key={url}
          ref={(el) => { refs.current[url] = el; }}
          src={url}
          muted
          loop
          playsInline
          preload={url === activeUrl || url === nextUrl ? 'auto' : 'metadata'}
          onCanPlay={() => setReady((r) => (r[url] ? r : { ...r, [url]: true }))}
          onClick={onToggle}
          className={cn('absolute inset-0 w-full h-full object-cover transition-opacity duration-700', url === shownUrl ? 'opacity-100' : 'opacity-0')}
        />
      ))}
      {!shownUrl && <MediaPlaceholder title={scene?.title} label="Audio narration" audio />}
      {scene && (
        <div key={active} className="pointer-events-none absolute top-3 left-3 right-3 flex animate-in fade-in slide-in-from-top-1 duration-500">
          <div className="max-w-full rounded-xl bg-black/55 backdrop-blur-sm px-3 py-2 text-white shadow-lg">
            <div className="text-[10px] uppercase tracking-wider text-white/70">Scene {active + 1} of {scenes.length}</div>
            <div className="text-sm sm:text-base font-semibold leading-snug truncate">{scene.title}</div>
          </div>
        </div>
      )}
    </>
  );
}

// Narration audio with explainer slides (or, for older lessons, scene clips), a single looping muted
// video, or a gradient panel behind it — and subtitles when the scenes carry them.
export default function NarratedPlayer({ videoUrl, audioUrl, title, autoPlay, scenes = [], context }) {
  const slides = hasSlides(scenes);
  const hasScenes = slides || scenes.length > 1 || (scenes.length === 1 && scenes[0].videoUrl);
  const p = useNarrationSync({ autoPlay });
  const [captionsOn, toggleCaptions] = useCaptionsPref();
  const hasCaptions = scenes.some((s) => s.captions.length);
  const active = hasScenes ? sceneAt(scenes, p.current) : -1;
  const jump = (i) => p.seek(scenes[Math.max(0, Math.min(scenes.length - 1, i))].start + 0.01);

  return (
    <>
      {slides ? (
        <SlideStage scenes={scenes} current={p.current} playing={p.playing} onToggle={p.toggle} context={context} />
      ) : hasScenes ? (
        <SceneStage scenes={scenes} current={p.current} playing={p.playing} onToggle={p.toggle} />
      ) : videoUrl ? (
        <video
          ref={p.videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
          onClick={p.toggle}
        />
      ) : (
        <MediaPlaceholder title={title} label="Audio narration" audio />
      )}
      <audio ref={p.audioRef} src={audioUrl} preload="auto" />
      {hasCaptions && captionsOn && <Captions cue={captionAt(scenes, p.current)} />}
      {p.blocked && !p.playing && <NarrationOverlay onPlay={p.play} />}
      <PlayerControls
        playing={p.playing}
        current={p.current}
        duration={p.duration}
        muted={p.muted}
        onToggle={p.toggle}
        onSeek={p.seek}
        onMute={p.toggleMute}
        markers={hasScenes ? scenes : []}
        onPrevScene={hasScenes ? () => jump(p.current - scenes[active].start > 2 ? active : active - 1) : undefined}
        onNextScene={hasScenes && active < scenes.length - 1 ? () => jump(active + 1) : undefined}
        captions={hasCaptions ? captionsOn : undefined}
        onCaptions={toggleCaptions}
      />
    </>
  );
}
