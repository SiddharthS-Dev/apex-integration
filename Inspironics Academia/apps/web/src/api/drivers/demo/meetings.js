import JSZip from 'jszip';
import {
  formatTranscript, heuristicAnalysis, isMeetingFile, matchOwner, meetingFromFileName, normalizeAnalysis, parseTranscript,
  resolveToday, speakerStats,
} from '@academy/shared';
import { ApiError } from '@/api/drivers/http';
import { table } from '@/api/drivers/demo/store';
import { badRequest, notFound } from '@/api/drivers/demo/records';
import { findAll, findOne, insert, patch, persist, removeWhere, sleep } from '@/api/drivers/demo/service';
import { notify, store } from '@/api/drivers/demo/backend';

// Meetings in the demo: the same contract as POST /api/meetings/upload and the processMeeting /
// publishMeeting functions. There is no AI here, so analysis is the shared keyword-rule fallback
// (analysis_method 'heuristic'). The transcript text is kept in a demo-only side table so a meeting
// can be processed again after a reload.

const SOURCE = '_MeetingSource';
const MAX_MB = 50;

const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// Same reading of a Word file as the API: one paragraph per line, tabs kept.
async function docxText(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw badRequest('Invalid DOCX: the file is not a readable Word document');
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw badRequest('Invalid DOCX: word/document.xml not found');
  const xml = await doc.async('string');
  return decode(xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)(?:\s[^>]*)?\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ''));
}

const sourceOf = (meetingId) => table(SOURCE).find((s) => s.meeting_id === meetingId) || null;

export function createMeetings() {
  return {
    async upload(file) {
      if (!file) throw badRequest('No file provided');
      if (!isMeetingFile(file.name)) throw badRequest('Upload a Teams transcript: .docx, .vtt or .txt');
      if (file.size > MAX_MB * 1024 * 1024) throw new ApiError(413, `File exceeds the ${MAX_MB} MB limit`);
      const kind = file.name.toLowerCase().split('.').pop();
      const text = kind === 'docx' ? await docxText(file) : await file.text();
      const named = meetingFromFileName(file.name);
      const meeting = insert('Meeting', {
        title: named.title, meeting_date: named.date || undefined, file_name: file.name, file_type: kind, file_size: file.size,
        file_url: `demo:${file.name}`, source: 'upload', status: 'uploaded', progress: 0,
      });
      table(SOURCE).push({ meeting_id: meeting.id, text, file_name: file.name });
      persist();
      return { ...meeting };
    },
    contentUrl(meetingId) {
      const src = sourceOf(meetingId);
      return URL.createObjectURL(new Blob([src?.text || 'Demo mode: the original transcript is not stored.'], { type: 'text/plain' }));
    },
  };
}

const normTask = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function processMeeting({ meeting_id: id } = {}) {
  const meeting = id ? findOne('Meeting', { id: String(id) }) : null;
  if (!meeting) throw notFound('Meeting not found');
  // A seeded meeting has no file: its stored turns are the transcript.
  const text = sourceOf(meeting.id)?.text
    || formatTranscript(findOne('MeetingTranscript', { meeting_id: meeting.id })?.segments || []);
  patch('Meeting', meeting.id, { status: 'processing', progress: 20, error: '' });
  persist();
  await sleep(600);

  const parsed = parseTranscript(text);
  if (!parsed.segments.length) {
    patch('Meeting', meeting.id, { status: 'failed', error: 'No speaker turns found — is this a Teams transcript?' });
    persist();
    throw badRequest('No speaker turns found — is this a Teams transcript?');
  }
  const date = parsed.date || meeting.meeting_date || meetingFromFileName(meeting.file_name || '').date;
  const analysis = normalizeAnalysis(heuristicAnalysis(parsed, { date }), { participants: parsed.participants });
  const users = store.users();

  removeWhere('MeetingTranscript', { meeting_id: meeting.id });
  insert('MeetingTranscript', { meeting_id: meeting.id, segments: parsed.segments, published: false });

  // Keep what a person edited; carry the status of items that come back the same.
  const before = findAll('ActionItem', { meeting_id: meeting.id });
  const kept = before.filter((a) => a.edited);
  const statusOf = new Map(before.map((a) => [normTask(a.task), a.status]));
  removeWhere('ActionItem', { meeting_id: meeting.id, edited: { $ne: true } });
  const keptTasks = new Set(kept.map((a) => normTask(a.task)));
  const title = meeting.title || parsed.title;
  for (const a of analysis.action_items) {
    if (keptTasks.has(normTask(a.task))) continue;
    const owner = matchOwner(a.owner, users);
    insert('ActionItem', {
      meeting_id: meeting.id, meeting_title: title, meeting_date: date || undefined, task: a.task, detail: a.detail,
      owner_name: a.owner, owner_user_id: owner?.id || '', due_date: a.due_date || undefined, due_text: a.due_text,
      priority: a.priority, status: statusOf.get(normTask(a.task)) || 'open', source_quote: a.quote,
      source_time: a.time ?? undefined, published: false,
    });
  }
  kept.forEach((a) => patch('ActionItem', a.id, { published: false }));

  const count = findAll('ActionItem', { meeting_id: meeting.id }).length;
  patch('Meeting', meeting.id, {
    title,
    meeting_date: date || undefined,
    duration_minutes: parsed.duration_seconds ? Math.round(parsed.duration_seconds / 60) : undefined,
    participants: parsed.participants,
    speaker_stats: speakerStats(parsed.segments, parsed.duration_seconds),
    summary: analysis.summary,
    purpose: analysis.purpose,
    themes: analysis.themes,
    decisions: analysis.decisions,
    requirements: analysis.requirements,
    open_questions: analysis.open_questions,
    risks: analysis.risks,
    analysis_method: 'heuristic',
    action_item_count: count,
    status: 'needs_review',
    progress: 100,
    error: '',
  });
  persist();
  return { ok: true, meeting_id: meeting.id, status: 'needs_review', analysis_method: 'heuristic', action_item_count: count };
}

export async function publishMeeting({ meeting_id: id, publish = true } = {}, { user }) {
  const meeting = id ? findOne('Meeting', { id: String(id) }) : null;
  if (!meeting) throw notFound('Meeting not found');
  if (publish && !['needs_review', 'published'].includes(meeting.status)) throw badRequest('Process the transcript before publishing it.');
  const on = publish !== false;
  const today = resolveToday();
  patch('Meeting', meeting.id, on ? { status: 'published', published_date: meeting.published_date || today } : { status: 'needs_review' });
  findAll('MeetingTranscript', { meeting_id: meeting.id }).forEach((t) => patch('MeetingTranscript', t.id, { published: on }));
  const items = findAll('ActionItem', { meeting_id: meeting.id });
  items.forEach((a) => patch('ActionItem', a.id, { published: on }));

  let notified = 0;
  if (on) {
    const data = {
      meeting_id: meeting.id, meeting_title: meeting.title, meeting_date: meeting.meeting_date,
      action_count: items.length, decision_count: (meeting.decisions || []).length,
    };
    for (const u of store.users()) {
      if (u.disabled || u.id === user?.id) continue;
      notify(u.id, 'meeting_published', data, `meeting_published:${meeting.id}:${u.id}`);
      notified += 1;
    }
    for (const a of items) {
      if (!a.owner_user_id || ['done', 'cancelled'].includes(a.status)) continue;
      notify(a.owner_user_id, 'action_item_assigned', {
        task: a.task, meeting_title: meeting.title, meeting_id: meeting.id, due_date: a.due_date,
      }, `action_item_assigned:${a.id}:${a.owner_user_id}`);
    }
  }
  persist();
  return { ok: true, status: on ? 'published' : 'needs_review', notified };
}
