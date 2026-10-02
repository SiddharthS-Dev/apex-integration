import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Check, Cloud, Cpu, ExternalLink, Film, Inbox, Loader2, Search, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import useAppConfig from '@/lib/useAppConfig';
import StatusBadge from '@/components/admin/StatusBadge';
import PipelineDiagram from './PipelineDiagram';
import { kindInfo, monthlyCreated, pipelineStages, queueFor } from './controlData';

const TABS = ['Summary', 'Pipeline', 'Queue', 'Settings'];
const PAGE_FOR = {
  playbooks: '/admin/playbooks', courses: '/admin/courses', lessons: '/admin/courses',
  questions: '/admin/questions', learners: '/admin/learners', certificates: '/admin/learners',
};

const tip = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

function Summary({ info, data, kind }) {
  const monthly = monthlyCreated(kind === 'learners' ? info.items : info.items);
  const [hover, setHover] = useState(null);
  const shown = hover ?? { label: 'Total', value: info.total };
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex items-center gap-4">
        <div className="relative w-40 h-40 shrink-0">
          {info.slices.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={info.slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none"
                  animationDuration={900} onMouseEnter={(_, i) => setHover(info.slices[i])} onMouseLeave={() => setHover(null)}
                >
                  {info.slices.map((s) => <Cell key={s.key} fill={s.color} style={{ filter: `drop-shadow(0 0 6px ${s.color}88)`, outline: 'none' }} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="w-full h-full rounded-full border-[14px] border-muted" />}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-2xl font-bold tabular-nums">{shown.value}</div>
            <div className="text-[10px] text-muted-foreground max-w-[5.5rem] text-center leading-tight">{shown.label}</div>
          </div>
        </div>
        <ul className="space-y-1.5 min-w-0 text-xs">
          {info.slices.length === 0 && <li className="text-muted-foreground">No {info.label.toLowerCase()} yet.</li>}
          {info.slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 min-w-0" onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}>
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums pl-2">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground mb-1">New {info.label.toLowerCase()} per month · last 12 months</div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dd-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#38bdf8" stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval={0} />
              <Tooltip {...tip} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} formatter={(v) => [v, 'Created']} />
              <Bar dataKey="count" fill="url(#dd-bar)" radius={[4, 4, 0, 0]} animationDuration={900} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-xl bg-muted/40 px-3 py-2"><div className="text-[10px] text-muted-foreground">Total</div><div className="font-semibold tabular-nums">{info.total}</div></div>
          <div className="rounded-xl bg-muted/40 px-3 py-2"><div className="text-[10px] text-muted-foreground">Status</div><div className="font-semibold truncate">{info.hint}</div></div>
        </div>
      </div>
    </div>
  );
}

function Queue({ kind, data, actions }) {
  const [q, setQ] = useState('');
  const items = queueFor(kind, data).filter((i) => !q || `${i.title} ${i.meta}`.toLowerCase().includes(q.toLowerCase()));
  if (!['lessons', 'questions', 'courses', 'playbooks'].includes(kind)) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{kind === 'learners' ? 'Learners have nothing to review.' : 'Certificates are issued automatically when a learner passes a final test.'}</p>;
  }
  return (
    <div>
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the queue"
          className="w-full h-9 rounded-xl border border-[hsl(var(--glass-line))] bg-background/40 pl-9 pr-3 text-sm outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
        />
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2"><Inbox className="w-6 h-6" />Nothing waiting — the queue is clear.</div>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {items.slice(0, 50).map((item) => {
            const busy = actions.busy.includes(item.id);
            return (
              <motion.li key={item.id} layout whileHover={{ scale: 1.01 }} className="glass tone-idle p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium line-clamp-1 [overflow-wrap:anywhere]" title={item.title}>{item.title}</div>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <StatusBadge status={item.status} className="text-[10px] py-0" />
                    <span className="text-[11px] text-muted-foreground truncate">{item.meta}</span>
                  </div>
                </div>
                {item.quick && (
                  <motion.button
                    type="button" whileTap={{ scale: 0.97 }} disabled={busy} onClick={() => actions.quickApprove(item)}
                    className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-emerald-400/40 text-emerald-600 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Quick approve
                  </motion.button>
                )}
                <Link
                  to={item.reviewTo}
                  className="shrink-0 inline-flex items-center h-8 px-3 rounded-lg bg-violet-600 text-white text-xs font-medium shadow-[0_0_16px_-4px_rgb(139_92_246/0.9)] hover:bg-violet-500 hover:shadow-[0_0_22px_-2px_rgb(139_92_246)] transition-all active:scale-[0.98]"
                >
                  Review
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Setting({ icon: Icon, label, value, ok }) {
  return (
    <div className="glass tone-idle p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-violet-500/10 text-violet-500 dark:text-violet-300 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
      <span className={cn('ml-auto w-2 h-2 rounded-full shrink-0', ok ? 'bg-emerald-400 shadow-md shadow-emerald-400/60' : 'bg-slate-400')} />
    </div>
  );
}

function Settings() {
  const cfg = useAppConfig();
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Setting icon={Cpu} label="AI generation" value={cfg.ai_enabled ? `On · ${cfg.ai_model}` : 'Off (AI_ENABLED)'} ok={cfg.ai_enabled} />
        <Setting icon={Film} label="Lesson media" value={cfg.media_enabled ? cfg.media_provider : 'Placeholder + browser narration'} ok={cfg.media_enabled} />
        <Setting icon={Cloud} label="Dropbox" value={cfg.dropbox_configured ? 'Configured' : 'Not configured'} ok={cfg.dropbox_configured} />
        <Setting icon={Upload} label="Upload limit" value={`${cfg.max_upload_mb} MB per file`} ok />
      </div>
      <p className="text-xs text-muted-foreground">
        These come from the API server&apos;s environment and are read-only here.{' '}
        <Link to="/admin/integrations" className="text-primary hover:underline">Manage Dropbox</Link>
      </p>
    </div>
  );
}

export default function DeepDivePanel({ kind, data, actions, initialTab = 'Summary', onClose, style }) {
  const [tab, setTab] = useState(initialTab);
  const info = kindInfo(kind, data);
  return (
    <motion.div
      role="dialog" aria-label={`${info.label} deep dive`}
      initial={{ opacity: 0, scale: 0.92, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={style}
      className="glass glass-glow tone-idle z-50 p-4 sm:p-5 bg-popover/90 backdrop-blur-2xl shadow-2xl overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{info.label} · Deep dive</h2>
        <div className="flex items-center gap-1">
          <Link to={PAGE_FOR[kind]} className="inline-flex items-center gap-1 text-xs text-primary hover:underline mr-2">Open page <ExternalLink className="w-3 h-3" /></Link>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div role="tablist" className="flex gap-1 mt-3 mb-4 border-b border-[hsl(var(--glass-line))]">
        {TABS.map((t) => (
          <button
            key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('relative px-3 py-2 text-sm transition-colors', tab === t ? 'text-violet-600 dark:text-violet-300 font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {t}
            <span
              aria-hidden="true"
              className={cn('absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-violet-500 shadow-[0_0_8px_rgb(139_92_246)] transition-transform duration-200 origin-center', tab === t ? 'scale-x-100' : 'scale-x-0')}
            />
          </button>
        ))}
      </div>
      {tab === 'Summary' && <Summary info={info} data={data} kind={kind} />}
      {tab === 'Pipeline' && <PipelineDiagram stages={pipelineStages(data)} compact />}
      {tab === 'Queue' && <Queue kind={kind} data={data} actions={actions} />}
      {tab === 'Settings' && <Settings />}
    </motion.div>
  );
}
