import { useCallback, useEffect, useRef, useState } from 'react';

// Keeps a short looping (muted) video in sync with a long narration track:
// the video plays while narration plays and pauses with it.
export default function useNarrationSync({ autoPlay = true } = {}) {
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const [state, setState] = useState({ playing: false, current: 0, duration: 0, muted: false, blocked: false });
  const patch = useCallback((p) => setState((s) => ({ ...s, ...p })), []);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio) return undefined;
    const onPlay = () => { patch({ playing: true, blocked: false }); video?.play().catch(() => {}); };
    const onPause = () => { patch({ playing: false }); video?.pause(); };
    const onTime = () => patch({ current: audio.currentTime });
    const onMeta = () => patch({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    const events = [['play', onPlay], ['pause', onPause], ['ended', onPause], ['timeupdate', onTime], ['loadedmetadata', onMeta], ['durationchange', onMeta]];
    events.forEach(([e, fn]) => audio.addEventListener(e, fn));
    if (autoPlay) {
      video?.play().catch(() => {}); // muted video autoplay is allowed
      audio.play().catch(() => patch({ blocked: true }));
    }
    return () => {
      events.forEach(([e, fn]) => audio.removeEventListener(e, fn));
      audio.pause();
    };
  }, [autoPlay, patch]);

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => patch({ blocked: true }));
  }, [patch]);
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) play();
    else audio.pause();
  }, [play]);
  const seek = useCallback((t) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
    patch({ current: t });
  }, [patch]);
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    patch({ muted: audio.muted });
  }, [patch]);

  return { audioRef, videoRef, ...state, play, toggle, seek, toggleMute };
}
