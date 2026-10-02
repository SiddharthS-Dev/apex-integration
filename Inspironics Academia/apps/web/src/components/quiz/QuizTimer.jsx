import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Countdown that calls onExpire once when time runs out.
export default function QuizTimer({ minutes, onExpire }) {
  const deadline = useRef(Date.now() + minutes * 60_000);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const [left, setLeft] = useState(minutes * 60);

  useEffect(() => {
    const id = setInterval(() => {
      const secs = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) {
        clearInterval(id);
        expireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const low = left <= 60;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums',
        low
          ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
          : 'bg-primary/10 text-primary',
      )}
    >
      <Timer className="w-3.5 h-3.5" />
      {fmt(left)}
    </span>
  );
}
