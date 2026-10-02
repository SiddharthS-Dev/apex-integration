import { useCallback, useEffect, useRef, useState } from 'react';

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// Some engines (Chrome) stop long utterances after ~15 s, so the text is queued as short chunks.
function chunk(text, max = 220) {
  const sentences = String(text || '').replace(/[#*_`>]+/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && (buf.length + s.length + 1) > max) { out.push(buf); buf = ''; }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) out.push(buf);
  return out;
}

// Browser text-to-speech fallback for lessons without narration audio.
// state: 'idle' | 'playing' | 'paused'. Speech is cancelled on unmount and when the text changes.
export default function useSpeechNarration(text) {
  const [state, setState] = useState('idle');
  const runRef = useRef(0);
  const isSupported = supported() && !!text;

  const stop = useCallback(() => {
    runRef.current += 1;
    if (supported()) window.speechSynthesis.cancel();
    setState('idle');
  }, []);

  useEffect(() => stop, [text, stop]);

  const play = useCallback(() => {
    if (!isSupported) return;
    const synth = window.speechSynthesis;
    if (state === 'paused') { synth.resume(); setState('playing'); return; }
    synth.cancel();
    const run = ++runRef.current;
    const parts = chunk(text);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (i === parts.length - 1) u.onend = () => { if (runRef.current === run) setState('idle'); };
      u.onerror = () => { if (runRef.current === run) setState('idle'); };
      synth.speak(u);
    });
    setState('playing');
  }, [isSupported, state, text]);

  const pause = useCallback(() => {
    if (!supported()) return;
    window.speechSynthesis.pause();
    setState('paused');
  }, []);

  return { supported: isSupported, state, play, pause, stop };
}
