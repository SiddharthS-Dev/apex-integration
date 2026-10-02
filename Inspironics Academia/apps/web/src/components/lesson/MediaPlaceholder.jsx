import { Film, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';

// Gradient panel used when a lesson has no video (audio-only or nothing yet).
export default function MediaPlaceholder({ title, label, audio = false, className }) {
  const Icon = audio ? AudioLines : Film;
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-center p-6',
        className,
      )}
    >
      <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center">
        <Icon className="w-7 h-7" />
      </div>
      {title && <h3 className="text-lg sm:text-xl font-semibold max-w-xl">{title}</h3>}
      {label && <p className="text-sm text-white/80">{label}</p>}
    </div>
  );
}
