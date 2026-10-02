// Pure helpers for the Playbook Hub: card variant per playbook, the real pipeline stages the
// server reports through `progress`, and an activity feed built from existing records.

// Progress checkpoints written by processPlaybookExtract / processPlaybookStructure.
export const STAGES = [
  { at: 15, label: 'Read file', active: 'Reading the source file' },
  { at: 30, label: 'Extract text', active: 'Extracting text' },
  { at: 40, label: 'Detect chapters', active: 'Detecting chapters' },
  { at: 50, label: 'Save chapters', active: 'Saving chapters' },
  { at: 60, label: 'Build course', active: 'Building the course structure' },
  { at: 100, label: 'Ready', active: 'Finishing up' },
];

// Index of the stage currently running (the first checkpoint not yet reached).
export function stageIndex(progress = 0) {
  const i = STAGES.findIndex((s) => progress < s.at);
  return i === -1 ? STAGES.length - 1 : i;
}

export function variantOf(playbook, busy) {
  if (busy || playbook.status === 'processing') return 'processing';
  if (playbook.status === 'failed') return 'error';
  if (playbook.status === 'uploaded') return 'queued';
  if (playbook.status === 'archived') return 'archived';
  return 'ready'; // processed | needs_review | published
}

// A run that hasn't reported progress for this long has most likely stopped (e.g. a server restart).
// Matches the server's 30-minute per-playbook lock TTL, so a restart offered here won't be refused.
const STALL_MS = 30 * 60_000;
export function isStalled(playbook, busy, now = Date.now()) {
  if (busy || playbook.status !== 'processing' || !playbook.updated_date) return false;
  return now - new Date(playbook.updated_date).getTime() > STALL_MS;
}

export const FILTERS = [
  { key: 'all', label: 'All', match: (v) => v !== 'archived' },
  { key: 'attention', label: 'Needs attention', match: (v) => v === 'error' || v === 'queued' },
  { key: 'processing', label: 'Processing', match: (v) => v === 'processing' },
  { key: 'ready', label: 'Ready', match: (v) => v === 'ready' },
  { key: 'archived', label: 'Archived', match: (v) => v === 'archived' },
];

// Cards needing action first, then live work, then finished ones — newest first within each.
const ORDER = { error: 0, processing: 1, queued: 2, ready: 3, archived: 4 };
export function sortForHub(items) {
  return [...items].sort((a, b) => ORDER[a.variant] - ORDER[b.variant]
    || String(b.playbook.updated_date || '').localeCompare(String(a.playbook.updated_date || '')));
}

export const READY_LABEL = {
  processed: 'Chapters extracted',
  needs_review: 'Course ready for review',
  published: 'Published',
};

// Activity feed: playbook lifecycle + Dropbox sync runs. Newest first.
export function activityEvents(playbooks = [], syncLogs = []) {
  const events = [];
  for (const p of playbooks) {
    const title = p.title || p.file_name;
    if (p.created_date) {
      events.push({
        id: `${p.id}-added`, at: p.created_date, kind: p.source === 'dropbox' ? 'dropbox' : 'upload',
        text: p.source === 'dropbox' ? `Imported “${title}” from Dropbox` : `Uploaded “${title}”`,
      });
    }
    const changed = p.updated_date && p.updated_date !== p.created_date;
    if (!changed) continue;
    const base = { id: `${p.id}-${p.status}`, at: p.updated_date, kind: 'ai' };
    if (p.status === 'failed') events.push({ ...base, kind: 'error', text: `Processing failed for “${title}”` });
    else if (p.status === 'processing') events.push({ ...base, text: `Processing “${title}”` });
    else if (p.status === 'processed') events.push({ ...base, text: `Extracted ${p.chapter_count || 0} chapters from “${title}”` });
    else if (p.status === 'needs_review') events.push({ ...base, text: `Built a course from “${title}” — ready for review` });
    else if (p.status === 'published') events.push({ ...base, kind: 'success', text: `Published “${title}”` });
  }
  for (const s of syncLogs) {
    if (!s.started_at) continue;
    const text = s.status === 'running'
      ? 'Dropbox sync running'
      : `Dropbox sync ${s.status === 'failed' ? 'failed' : 'finished'}: ${s.added || 0} added, ${s.updated || 0} updated${s.failed ? `, ${s.failed} failed` : ''}`;
    events.push({ id: `sync-${s.id}`, at: s.finished_at || s.started_at, kind: s.status === 'failed' ? 'sync-error' : 'dropbox', text });
  }
  return events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
