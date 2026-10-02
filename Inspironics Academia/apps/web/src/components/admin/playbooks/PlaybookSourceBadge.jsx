import { Cloud, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

const SOURCES = {
  dropbox: { label: 'Dropbox', icon: Cloud, className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  upload: { label: 'Upload', icon: Upload, className: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300' },
};

export default function PlaybookSourceBadge({ source, className }) {
  const meta = SOURCES[source] || SOURCES.upload;
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0', meta.className, className)}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}
