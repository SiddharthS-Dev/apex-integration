import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Captions from '@/components/lesson/Captions';
import NarrationOverlay from '@/components/lesson/NarrationOverlay';
import PlayerControls from '@/components/lesson/PlayerControls';
import SlideStage from '@/components/lesson/SlideStage';
import { captionAt, sceneAt } from '@/components/lesson/scenes';

const FRAME = 'relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 shadow-sm [container-type:inline-size]';
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /en-(GB|US|IN)/i.test(v.lang) && /female|zira|aria|jenny|samantha|google uk english female|natural/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang)) || null;
}

// Plays a briefing that has no recorded voice-over: the browser reads it aloud, one subtitle cue at a
// time, and the clock follows the voice — it jumps to each cue as it starts and waits at its end
// until the cue has been spoken — so slides, subtitles and the teacher stay in step with the speech.
export default function SpokenBriefingPlayer({ scenes, context }) {
  const cues = useMemo(() => scenes.flatMap((s) => s.captions), [scenes]);
  const duration = scenes.length ? scenes.at(-1).end : 0;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const live = useRef({ token: 0, cue: -1, done: true, last: 0, current: 0, muted: false });

  const stopSpeech = useCallback(() => {
    live.current.token += 1;
    if (supported) window.speechSynthesis.cancel();
  }, []);

  const speakFrom = useCallback((k) => {
    stopSpeech();
    const token = live.current.token;
    const say = (i) => {
      if (token !== live.current.token) return;
      if (i >= cues.length) {
        live.current.cue = -1;
        setPlaying(false);
        live.current.current = duration;
        setCurrent(duration);
        return;
      }
      live.current.cue = i;
      live.current.done = false;
      live.current.current = cues[i].start;
      setCurrent(cues[i].start);
      const u = new SpeechSynthesisUtterance(cues[i].text);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.rate = 1;
      u.volume = live.current.muted ? 0 : 1;
      u.onend = () => { if (token === live.current.token) { live.current.done = true; say(i + 1); } };
      u.onerror = u.onend;
      window.speechSynthesis.speak(u);
    };
    say(Math.max(0, k));
  }, [cues, duration, stopSpeech]);

  // The clock: runs while playing, but never past the end of the cue still being spoken.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    live.current.last = performance.now();
    const tick = (now) => {
      const dt = (now - live.current.last) / 1000;
      live.current.last = now;
      const cue = cues[live.current.cue];
      const cap = cue && !live.current.done ? cue.end - 0.02 : duration;
      live.current.current = Math.min(cap, live.current.current + dt);
      setCurrent(live.current.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, cues, duration]);

  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const cueAt = (t) => {
    const i = cues.findIndex((c) => t < c.end);
    return i === -1 ? cues.length - 1 : i;
  };
  const play = (from = current) => {
    if (!supported || !cues.length) return;
    const start = from >= duration - 0.1 ? 0 : from;
    setPlaying(true);
    speakFrom(cueAt(start));
  };
  const pause = () => { stopSpeech(); setPlaying(false); };
  const seek = (t) => {
    const next = Math.max(0, Math.min(duration, t));
    live.current.current = next;
    setCurrent(next);
    if (playing) speakFrom(cueAt(next));
  };
  const active = sceneAt(scenes, current);
  const jump = (i) => seek(scenes[Math.max(0, Math.min(scenes.length - 1, i))].start + 0.01);

  if (!supported) {
    return <div className={`${FRAME} grid place-items-center p-6 text-center text-sm text-white/80`}>This browser cannot read the briefing aloud. Try Chrome, Edge or Safari.</div>;
  }

  return (
    <div className={FRAME}>
      <SlideStage scenes={scenes} current={current} playing={playing} onToggle={() => (playing ? pause() : play())} context={context} />
      {captionsOn && <Captions cue={captionAt(scenes, current)} besidePresenter={!!context?.presenter} />}
      {!playing && current === 0 && <NarrationOverlay onPlay={() => play(0)} />}
      <PlayerControls
        playing={playing}
        current={current}
        duration={duration}
        muted={muted}
        onToggle={() => (playing ? pause() : play())}
        onSeek={seek}
        onMute={() => {
          live.current.muted = !muted;
          setMuted(!muted);
          if (playing) speakFrom(live.current.cue);
        }}
        markers={scenes}
        onPrevScene={() => jump(current - scenes[active].start > 2 ? active : active - 1)}
        onNextScene={active < scenes.length - 1 ? () => jump(active + 1) : undefined}
        captions={captionsOn}
        onCaptions={() => setCaptionsOn((v) => !v)}
      />
    </div>
  );
}
