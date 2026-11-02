import {
  formatTranscript, heuristicAnalysis, matchOwner, meetingFromFileName, normalizeAnalysis, parseTranscript, speakerStats,
} from '@academy/shared';
import { aiEnabled, invokeLLM } from '../ai/claude.js';
import { withLock } from '../db/locks.js';
import { loadPlaybookBytes } from '../files/playbookSource.js';
import { meetingsAccount, withDropboxAccount } from '../dropbox/connection.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { listUsers } from '../repo/users.js';
import { extractText, normalizeText } from './text.js';
import { asHttpError, errMsg, norm, pipelineError } from './util.js';

// processMeeting — turns a meeting transcript (Teams .docx, .vtt or .txt) into meeting notes:
// summary, purpose, key ideas, decisions, requirements, action items, open questions and risks,
// plus who spoke how much. Claude writes the analysis when AI is on; otherwise keyword rules find
// the likely action items and decisions (Meeting.analysis_method says which).
//
// Action items are rows of their own (ActionItem), matched to accounts by the owner's name.
// Re-processing replaces generated items but keeps any a person edited or added, and carries the
// status of an item that comes out the same again. The meeting ends in 'needs_review': an admin
// publishes it (publishMeeting).
//
// Payload: { meeting_id }
// Returns: { ok, meeting_id, status, analysis_method, action_item_count, participants }

const CHUNK_CHARS = 120_000; // a long meeting is analysed in parts, then merged

const ITEM = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    detail: { type: 'string' },
    owner: { type: 'string' },
    due_date: { type: 'string' },
    due_text: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    quote: { type: 'string' },
    time: { type: 'number' },
  },
  required: ['task', 'owner', 'due_date', 'due_text', 'priority', 'quote'],
};

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    purpose: { type: 'string' },
    summary: { type: 'string' },
    themes: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
    decisions: { type: 'array', items: { type: 'object', properties: { decision: { type: 'string' }, rationale: { type: 'string' }, owner: { type: 'string' } }, required: ['decision', 'rationale', 'owner'] } },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['business', 'functional', 'technical', 'non_functional', 'other'] },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          raised_by: { type: 'string' },
        },
        required: ['text', 'type', 'priority', 'raised_by'],
      },
    },
    action_items: { type: 'array', items: ITEM },
    open_questions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, owner: { type: 'string' } }, required: ['question', 'owner'] } },
    risks: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, impact: { type: 'string', enum: ['high', 'medium', 'low'] }, mitigation: { type: 'string' } }, required: ['risk', 'impact', 'mitigation'] } },
  },
  required: ['title', 'purpose', 'summary', 'themes', 'decisions', 'requirements', 'action_items', 'open_questions', 'risks'],
};

const RULES = `Rules:
- Be faithful to the transcript. Never invent people, numbers, dates, decisions or commitments. Speech-to-text errors are common: read through them, but do not guess at what was not said.
- title: a short, specific name for the meeting (keep the given title if it is already specific).
- purpose: one sentence on why the meeting was held.
- summary: 4-8 sentences a colleague who missed it can act on — what was discussed, what was concluded, what happens next.
- themes: 3-6 key ideas — the thinking behind the discussion: positions taken, principles argued for, concerns that shaped it. Each with a 1-3 sentence detail.
- decisions: only what was actually agreed or approved. rationale: why, as said. owner: who made or owns it ("" if unclear).
- requirements: product, system, process or business requirements stated (must/should/needs to support …). type: business | functional | technical | non_functional | other.
- action_items: concrete tasks someone committed to ("I'll …") or was asked to do ("Arjun, can you …"). One task per item, starting with a verb. owner: the participant's name exactly as listed, or "" if nobody took it. due_date: YYYY-MM-DD when a deadline was said (resolve "Friday", "tomorrow", "next week" against the meeting date), else "". due_text: the deadline as said, else "". priority: high only when urgency was stated. quote: the words that created the task, copied exactly. time: seconds from the [m:ss] marker of that line (omit when there is none).
- open_questions: questions left unanswered, with who should answer ("" if unclear).
- risks: risks, blockers or concerns raised, with impact and any mitigation mentioned ("" if none).
- Use empty lists where the meeting had none.`;

function chunks(lines, size) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length > size && cur.length) {
      out.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

/** Claude's analysis of a parsed transcript; long meetings are analysed in parts and merged. */
export async function analyzeWithAI(parsed, { title, date }) {
  const header = [
    `Meeting: ${title || '(untitled)'}`,
    `Date: ${date || 'unknown'}`,
    parsed.duration_seconds ? `Length: ${Math.round(parsed.duration_seconds / 60)} minutes` : '',
    `Participants: ${parsed.participants.join(', ')}`,
  ].filter(Boolean).join('\n');
  const parts = chunks(formatTranscript(parsed.segments).split('\n'), CHUNK_CHARS);

  const analyse = (text, i) => invokeLLM({
    prompt: `You are writing the meeting notes for a company meeting held on Microsoft Teams, from its transcript. Colleagues who missed the meeting will rely on them, and action items will be tracked.\n\n${header}\n${parts.length > 1 ? `\nThis is part ${i + 1} of ${parts.length} of the transcript.\n` : ''}\nTRANSCRIPT ("[m:ss] Speaker: words"):\n"""\n${text}\n"""\n\n${RULES}`,
    schema: ANALYSIS_SCHEMA,
    maxTokens: 16000,
    effort: 'medium',
  });

  if (parts.length === 1) return analyse(parts[0], 0);
  const partials = [];
  for (let i = 0; i < parts.length; i++) partials.push(await analyse(parts[i], i));
  return invokeLLM({
    prompt: `These are the notes for each part of one long meeting, in order. Merge them into the notes for the whole meeting: one title, purpose and summary for all of it; combine themes; remove duplicate decisions, requirements, action items, questions and risks (keep the most specific wording, owner and due date); drop questions a later part answered.\n\n${header}\n\nPART NOTES (JSON):\n${JSON.stringify(partials)}\n\n${RULES}`,
    schema: ANALYSIS_SCHEMA,
    maxTokens: 16000,
    effort: 'medium',
  });
}

/** Transcript text from the stored file: Word documents through the extractor, .vtt/.txt as text. */
async function transcriptText(meeting) {
  // A Dropbox transcript is read through the meetings app when one is set up.
  const bytes = await withDropboxAccount(meetingsAccount(), () => loadPlaybookBytes(meeting));
  const type = String(meeting.file_type || meeting.file_name?.split('.').pop() || '').toLowerCase();
  if (type === 'vtt' || type === 'txt') return normalizeText(new TextDecoder().decode(bytes));
  return (await extractText({ file_type: 'docx', file_name: meeting.file_name }, bytes)).text;
}

const untitled = (meeting) => !meeting.title || meeting.title === meetingFromFileName(meeting.file_name || '').title;

export default async function processMeeting(payload = {}, ctx = {}) {
  const id = payload?.meeting_id ? String(payload.meeting_id) : '';
  if (!id) throw badRequest('meeting_id is required');
  const meeting = await entities.Meeting.get(id);
  if (!meeting) throw notFound('Meeting not found');
  const { acquired, result } = await withLock(`pipeline:meeting:${id}`, () => run(meeting, ctx.log || defaultLog), { ttlMs: 30 * 60_000 });
  if (!acquired) throw conflict('This meeting is already being processed — try again when the current run finishes');
  return result;
}

async function run(meeting, log) {
  const sr = entities;
  try {
    await sr.Meeting.update(meeting.id, { status: 'processing', progress: 10, error: '' });
    const parsed = parseTranscript(await transcriptText(meeting));
    if (!parsed.segments.length) throw pipelineError('No speaker turns were found. Upload the transcript Teams exports (Word .docx or .vtt), not the meeting chat or notes.');
    await sr.Meeting.update(meeting.id, { progress: 30 });

    const fromName = meetingFromFileName(meeting.file_name || '');
    const date = parsed.date || meeting.meeting_date || fromName.date || '';
    const givenTitle = untitled(meeting) ? (parsed.title || fromName.title || meeting.title) : meeting.title;

    let method = 'heuristic';
    let note = '';
    let raw;
    if (aiEnabled()) {
      try {
        raw = await analyzeWithAI(parsed, { title: givenTitle, date });
        method = 'ai';
      } catch (e) {
        note = `AI analysis failed (${errMsg(e)}); showing the keyword analysis instead. Reprocess to try again.`;
        log.warn('pipeline.meeting.ai_failed', { meeting_id: meeting.id, error: errMsg(e) });
      }
    }
    if (!raw) raw = heuristicAnalysis(parsed, { date });
    const analysis = normalizeAnalysis(raw, { participants: parsed.participants });
    await sr.Meeting.update(meeting.id, { progress: 75 });

    // Transcript: one row per meeting, replaced.
    await sr.MeetingTranscript.deleteMany({ meeting_id: meeting.id });
    await sr.MeetingTranscript.create({ meeting_id: meeting.id, segments: parsed.segments, published: false });

    // Action items: keep what people edited or added, carry status over for items that recur.
    const title = untitled(meeting) ? (parsed.title || analysis.title || fromName.title || meeting.title) : meeting.title;
    // An item is recognised by its wording or by the words that created it (an edited item keeps its quote).
    const existing = await sr.ActionItem.filter({ meeting_id: meeting.id }, null, 1000);
    const kept = existing.filter((a) => a.edited);
    const keysOf = (task, quote) => [norm(task), norm(quote)].filter(Boolean);
    const keptKeys = new Set(kept.flatMap((a) => keysOf(a.task, a.source_quote)));
    const statusOf = new Map(existing.filter((a) => !a.edited).flatMap((a) => keysOf(a.task, a.source_quote).map((k) => [k, a])));
    await Promise.all(existing.filter((a) => !a.edited).map((a) => sr.ActionItem.delete(a.id)));

    const users = await listUsers();
    const fresh = analysis.action_items.filter((a) => !keysOf(a.task, a.quote).some((k) => keptKeys.has(k))).map((a) => {
      const owner = matchOwner(a.owner, users);
      const before = keysOf(a.task, a.quote).map((k) => statusOf.get(k)).find(Boolean);
      return {
        meeting_id: meeting.id,
        meeting_title: title,
        meeting_date: date || undefined,
        task: a.task,
        detail: a.detail,
        owner_name: a.owner,
        owner_user_id: owner?.id || undefined,
        due_date: a.due_date || undefined,
        due_text: a.due_text,
        priority: a.priority,
        status: before?.status || 'open',
        completed_date: before?.completed_date,
        source_quote: a.quote,
        source_time: a.time ?? undefined,
        edited: false,
        published: false,
      };
    });
    if (fresh.length) await sr.ActionItem.bulkCreate(fresh);
    await Promise.all(kept.map((a) => sr.ActionItem.update(a.id, { published: false, meeting_title: title })));

    const actionCount = fresh.length + kept.length;
    await sr.Meeting.update(meeting.id, {
      title,
      meeting_date: date || undefined,
      duration_minutes: parsed.duration_seconds ? Math.max(1, Math.round(parsed.duration_seconds / 60)) : undefined,
      participants: parsed.participants,
      speaker_stats: speakerStats(parsed.segments, parsed.duration_seconds),
      summary: analysis.summary,
      purpose: analysis.purpose,
      themes: analysis.themes,
      decisions: analysis.decisions,
      requirements: analysis.requirements,
      open_questions: analysis.open_questions,
      risks: analysis.risks,
      analysis_method: method,
      action_item_count: actionCount,
      status: 'needs_review',
      progress: 100,
      error: note,
    });
    log.info('pipeline.meeting.done', { meeting_id: meeting.id, method, turns: parsed.segments.length, participants: parsed.participants.length, action_items: actionCount });
    return { ok: true, meeting_id: meeting.id, status: 'needs_review', analysis_method: method, action_item_count: actionCount, participants: parsed.participants.length };
  } catch (e) {
    const message = errMsg(e);
    log.error('pipeline.meeting.failed', { meeting_id: meeting.id, error: message });
    await sr.Meeting.update(meeting.id, { status: 'failed', error: message }).catch(() => {});
    throw asHttpError(e);
  }
}
