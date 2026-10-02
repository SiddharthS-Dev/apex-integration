import { useState } from 'react';
import { ChevronDown, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TranscriptToggle({ script }) {
  const [open, setOpen] = useState(false);
  if (!script) return null;
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2"><ScrollText className="w-4 h-4 text-primary" />Transcript</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground whitespace-pre-line max-h-96 overflow-y-auto">
          {script}
        </div>
      )}
    </div>
  );
}
