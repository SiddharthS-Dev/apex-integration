import { useEffect, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const clean = (s) => s.replace(/[#*_`>[\]()-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Title + first ~5 sentences of the provided lesson text.
function buildSummary(title, text = '') {
  const sentences = String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 5)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
  return [title ? `${clean(title)}.` : '', ...sentences].join(' ').trim();
}

export default function TextToVoiceButton({ text, title }) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const toggle = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) { setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(buildSummary(title, text));
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.speak(utterance);
    setSpeaking(true);
  };

  const label = !supported ? 'Voice playback is not supported in this browser' : speaking ? 'Stop reading' : 'Listen to a summary';
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={supported ? -1 : 0}>
            <Button type="button" size="sm" variant={speaking ? 'default' : 'outline'} onClick={toggle} disabled={!supported || !(text || title)} aria-label={label}>
              {speaking ? <Square /> : <Volume2 />}
              <span className="hidden sm:inline">{speaking ? 'Stop' : 'Listen'}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
