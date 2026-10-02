import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Cloud, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import PlaybookUploader from '@/components/admin/PlaybookUploader';

// Friendly holographic helper — decorative; the panel's real job is the upload box beside it.
function AssistantAvatar() {
  const reduce = useReducedMotion();
  return (
    <div className="relative w-20 h-24 shrink-0" aria-hidden="true">
      <motion.svg
        viewBox="0 0 80 90" className="relative z-10 w-full h-full drop-shadow-[0_0_14px_rgb(56_189_248/0.55)]"
        animate={reduce ? {} : { y: [0, -3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <defs>
          <linearGradient id="bot-face" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e0f2fe" /><stop offset="1" stopColor="#a5b4fc" />
          </linearGradient>
        </defs>
        <rect x="14" y="14" width="52" height="42" rx="16" fill="url(#bot-face)" />
        <rect x="21" y="23" width="38" height="24" rx="10" fill="#0f172a" />
        <circle cx="32" cy="35" r="4" fill="#22d3ee" /><circle cx="48" cy="35" r="4" fill="#22d3ee" />
        <path d="M34 42 q6 4 12 0" stroke="#22d3ee" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="9" y="28" width="6" height="14" rx="3" fill="#818cf8" /><rect x="65" y="28" width="6" height="14" rx="3" fill="#818cf8" />
        <path d="M40 14 v-7" stroke="#818cf8" strokeWidth="2" /><circle cx="40" cy="6" r="3" fill="#22d3ee" />
        <path d="M24 60 h32 l6 16 h-44 z" fill="#6366f1" opacity=".85" />
      </motion.svg>
      <div className="absolute bottom-0 inset-x-1 h-5 rounded-[50%] bg-sky-400/40 blur-md" />
      <div className="absolute bottom-1 inset-x-3 h-2 rounded-[50%] border border-sky-300/60" />
    </div>
  );
}

export function DropboxSyncButton({ status, running }) {
  const connected = !!(status?.configured && status?.connected);
  return (
    <Link
      to="/admin/integrations"
      className={cn(
        'group relative inline-flex items-center gap-2 rounded-xl px-4 h-10 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5',
        'border border-sky-400/50 bg-sky-500/10 text-sky-700 dark:text-sky-200 hover:bg-sky-500/20 hover:shadow-[0_0_24px_-4px_rgb(14_165_233/0.8)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400',
        connected && 'motion-safe:animate-[glow-pulse_2.4s_ease-in-out_infinite]',
      )}
    >
      {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
      {running ? 'Syncing…' : 'Dropbox sync'}
      <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-emerald-400 shadow-md shadow-emerald-400/60' : 'bg-slate-400')} title={connected ? 'Connected' : 'Not connected'} />
    </Link>
  );
}

export default function HubHeader({ dropbox, syncRunning }) {
  return (
    <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] items-center">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl glass tone-idle glass-glow flex items-center justify-center neon-text shrink-0">
          <Upload className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Playbook Repository</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload engineering playbooks and turn them into structured, reviewable courses.</p>
          <div className="mt-4"><DropboxSyncButton status={dropbox} running={syncRunning} /></div>
        </div>
      </div>
      <div className="glass tone-processing glass-glow p-4 flex items-center gap-4">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground mb-2">
            Drop a PDF or DOCX playbook — I&apos;ll extract its chapters and draft a course for review.
          </p>
          <PlaybookUploader compact className="" />
        </div>
      </div>
    </div>
  );
}
