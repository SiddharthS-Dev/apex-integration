import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatClock } from '@academy/shared';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { localDay } from '@/lib/progress';

// Meeting notes: hooks, labels and exports shared by the Meetings pages. Learners receive only
// published meetings through row-level security; admins receive every meeting.

export const MEETINGS_KEY = 'meetings';

export const useMeetings = () => useQuery({
  queryKey: [MEETINGS_KEY, 'list'],
  queryFn: () => api.entities.Meeting.list('-meeting_date', 500),
});

export const useMeeting = (id) => useQuery({
  queryKey: [MEETINGS_KEY, 'one', id],
  enabled: !!id,
  queryFn: () => api.entities.Meeting.get(id),
});

export const useTranscript = (meetingId) => useQuery({
  queryKey: [MEETINGS_KEY, 'transcript', meetingId],
  enabled: !!meetingId,
  queryFn: async () => (await api.entities.MeetingTranscript.filter({ meeting_id: meetingId }, '-created_date', 1))[0] || null,
});

export const useMeetingActionItems = (meetingId) => useQuery({
  queryKey: [MEETINGS_KEY, 'actions', meetingId],
  enabled: !!meetingId,
  queryFn: () => api.entities.ActionItem.filter({ meeting_id: meetingId }, 'due_date', 500),
});

/** Every action item, for the meetings list (open / total per meeting). */
export const useAllActionItems = () => useQuery({
  queryKey: [MEETINGS_KEY, 'actions', 'all'],
  queryFn: () => api.entities.ActionItem.list('due_date', 5000),
});

/** Published action items assigned to the signed-in user. */
export function useMyActionItems() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [MEETINGS_KEY, 'actions', 'mine', user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await api.entities.ActionItem.filter({ owner_user_id: user.id }, 'due_date', 1000)).filter((a) => a.published),
  });
}

/** Refreshes every meeting query (lists, details, items, transcripts, notifications). */
export function useInvalidateMeetings() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [MEETINGS_KEY] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

export const STATUS_LABEL = {
  uploaded: 'Not processed',
  processing: 'Processing',
  needs_review: 'Needs review',
  published: 'Published',
  failed: 'Failed',
  archived: 'Archived',
};

export const STATUS_STYLE = {
  uploaded: 'bg-muted text-muted-foreground',
  processing: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  needs_review: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  archived: 'bg-muted text-muted-foreground',
};

export const ACTION_LABEL = { open: 'Open', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };

export const PRIORITY_STYLE = {
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};

export const REQUIREMENT_LABEL = {
  business: 'Business', functional: 'Functional', technical: 'Technical', non_functional: 'Non-functional', other: 'Other',
};

export const isOpen = (a) => a.status === 'open' || a.status === 'in_progress';

/** 'overdue' · 'soon' (due today or tomorrow) · 'later' · 'none' — only for open items. */
export function dueState(item, today = localDay()) {
  if (!isOpen(item) || !item.due_date) return 'none';
  if (item.due_date < today) return 'overdue';
  if (item.due_date <= addDays(today, 1)) return 'soon';
  return 'later';
}

export const formatDay = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const formatMinutes = (m) => {
  if (!m) return '';
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export { formatClock };

// ---- exports ---------------------------------------------------------------------------------

export function downloadText(fileName, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (s) => String(s || 'meeting').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** The whole analysis and its action items as Markdown minutes. */
export function minutesMarkdown(meeting, items = []) {
  const lines = [`# ${meeting.title}`, ''];
  const meta = [meeting.meeting_date && formatDay(meeting.meeting_date), meeting.duration_minutes && formatMinutes(meeting.duration_minutes)].filter(Boolean).join(' · ');
  if (meta) lines.push(meta, '');
  if (meeting.participants?.length) lines.push(`**Participants:** ${meeting.participants.join(', ')}`, '');
  if (meeting.purpose) lines.push('## Purpose', '', meeting.purpose, '');
  if (meeting.summary) lines.push('## Summary', '', meeting.summary, '');
  if (meeting.themes?.length) {
    lines.push('## Key ideas', '');
    meeting.themes.forEach((t) => lines.push(`- **${t.title}** — ${t.detail || ''}`.trim()));
    lines.push('');
  }
  if (meeting.decisions?.length) {
    lines.push('## Decisions', '');
    meeting.decisions.forEach((d) => lines.push(`- ${d.decision}${d.rationale ? ` — ${d.rationale}` : ''}${d.owner ? ` (${d.owner})` : ''}`));
    lines.push('');
  }
  if (items.length) {
    lines.push('## Action items', '', '| Task | Owner | Due | Priority | Status |', '|---|---|---|---|---|');
    items.forEach((a) => lines.push(`| ${a.task.replace(/\|/g, '/')} | ${a.owner_name || '—'} | ${a.due_date ? formatDay(a.due_date) : a.due_text || '—'} | ${a.priority} | ${ACTION_LABEL[a.status] || a.status} |`));
    lines.push('');
  }
  if (meeting.requirements?.length) {
    lines.push('## Requirements', '');
    meeting.requirements.forEach((r) => lines.push(`- [${REQUIREMENT_LABEL[r.type] || r.type}, ${r.priority}] ${r.text}${r.raised_by ? ` (${r.raised_by})` : ''}`));
    lines.push('');
  }
  if (meeting.open_questions?.length) {
    lines.push('## Open questions', '');
    meeting.open_questions.forEach((q) => lines.push(`- ${q.question}${q.owner ? ` (${q.owner})` : ''}`));
    lines.push('');
  }
  if (meeting.risks?.length) {
    lines.push('## Risks', '');
    meeting.risks.forEach((r) => lines.push(`- **${r.impact}** — ${r.risk}${r.mitigation ? ` Mitigation: ${r.mitigation}` : ''}`));
    lines.push('');
  }
  return lines.join('\n');
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function actionItemsCsv(items = []) {
  const head = ['Meeting', 'Meeting date', 'Task', 'Owner', 'Due date', 'Due (as said)', 'Priority', 'Status', 'Quote', 'Time'];
  const rows = items.map((a) => [
    a.meeting_title, a.meeting_date, a.task, a.owner_name, a.due_date, a.due_text, a.priority, ACTION_LABEL[a.status] || a.status,
    a.source_quote, a.source_time != null ? formatClock(a.source_time) : '',
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
