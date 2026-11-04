import crypto from 'node:crypto';
import { aiEnabled, invokeLLM } from '../ai/claude.js';
import { withLock } from '../db/locks.js';
import { objectKey, putObject } from '../files/objectStore.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { mapPool } from '../lib/pool.js';
import { concatMp3 } from '../media/mp3.js';
import { generateNarration, mediaEnabled, mediaUnavailableError } from '../media/index.js';
import { entities } from '../repo/entities.js';
import { buildCaptions } from './generateLessonMedia.js';
import { asHttpError, errMsg } from './util.js';

// generateMeetingVideo — a narrated video briefing of a meeting, presented by an animated teacher in
// the player: why the team met, what was said and decided, what is required, and exactly who has to
// do what by when. Built like a lesson video: a deck of scenes, each with a slide and a spoken part;
// the parts are voiced (MEDIA_PROVIDER, e.g. Base44 GenerateSpeech), joined into one track, and
// meeting.briefing_scenes records when each scene plays, its slide and its subtitles.
//
// The AI writes the deck from the meeting notes when it is on; otherwise (or when its answer is
// unusable) the deck is written from the notes directly. Either way every open action item is in
// the video: any the AI leaves out get a scene of their own.
//
// Payload: { meeting_id }
// Returns: { ok: true, meeting_id, audio_url, scenes, method: 'ai' | 'notes', seconds, voice: 'recorded' | 'browser', voice_error? }

const VOICE = 'storm';
const MAX_SCENE_CHARS = 900; // ≈ 60 s of speech per scene
const MAX_SCENES = 10;
const ITEMS_PER_SCENE = 5;
const LAYOUTS = ['points', 'steps', 'checklist', 'rule', 'table', 'compare', 'timeline'];
const PRIORITY = { high: 0, medium: 1, low: 2 };

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const isOpenItem = (a) => a.status !== 'done' && a.status !== 'cancelled';

export function spokenDate(day) {
  const d = new Date(`${String(day || '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function namesList(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

/** Trim spoken text to the scene limit at a sentence end where possible. */
export function sceneSpeech(text, max = MAX_SCENE_CHARS) {
  const clean = str(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

const firstSentences = (text, n) => (str(text).match(/[^.!?]+[.!?]+/g) || [str(text)]).slice(0, n).join(' ').trim();

/** Open action items, most urgent first: priority, then due date. */
export function orderItems(items) {
  return list(items).filter(isOpenItem).sort((a, b) => (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1)
    || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
}

/** A task as the end of a spoken sentence: "Update the schema." → "update the schema" (acronyms kept). */
export function asClause(task) {
  const t = str(task).replace(/^to\s+/i, '').replace(/[.!]+$/, '');
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/** Lower-cases a leading capital mid-sentence ("Enforce strict…" → "enforce strict…"), keeping acronyms. */
export const lowerFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

/** ", because the team…" — or ", to keep…" when the reason is a purpose ("To keep…"). */
export function reasonClause(rationale) {
  const r = str(rationale).replace(/^because\s+/i, '').replace(/[.]$/, '');
  if (!r) return '';
  return /^(to|so that|in order to)\s/i.test(r) ? `, ${lowerFirst(r)}` : `, because ${lowerFirst(r)}`;
}

const dueOf = (item) => str(item.due_text) || (item.due_date ? spokenDate(item.due_date) : '');

/** ", by October 20, 2026" — or the due text as it is when it reads on its own (", within three days"). */
export function duePhrase(item) {
  const text = str(item.due_text).replace(/[.]$/, '');
  if (text && /^(by|within|before|on|in|over|after|during|until|asap|as soon|end of|next|this|today|tomorrow|every|each)\b/i.test(text)) return `, ${lowerFirst(text)}`;
  const due = text || (item.due_date ? spokenDate(item.due_date) : '');
  return due ? `, by ${due}` : '';
}

function actionItemScenes(items, { label = 'Action items' } = {}) {
  const scenes = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_SCENE) {
    const chunk = items.slice(i, i + ITEMS_PER_SCENE);
    const part = items.length > ITEMS_PER_SCENE ? ` (${Math.floor(i / ITEMS_PER_SCENE) + 1} of ${Math.ceil(items.length / ITEMS_PER_SCENE)})` : '';
    const lines = chunk.map((a) => {
      const who = str(a.owner_name) || 'The team';
      const due = dueOf(a);
      return `${who}${who === 'The team' ? ' needs' : ', you need'} to ${asClause(a.task)}${duePhrase(a)}${a.priority === 'high' ? '. This one is high priority' : ''}.`;
    });
    const opener = label !== 'Action items'
      ? `${chunk.length === 1 ? 'One more action item' : 'A few more action items'} to remember. `
      : i === 0 ? 'Now the most important part: what each of you needs to do next. ' : 'Here are more action items. ';
    scenes.push({
      title: `${label}${part}`,
      layout: 'table',
      table: { headers: ['Task', 'Owner', 'Due'], rows: chunk.map((a) => [clip(str(a.task), 80), str(a.owner_name) || 'Team', dueOf(a) || '—']) },
      points: chunk.map((a) => clip(`${str(a.owner_name) || 'Team'}: ${str(a.task)}`, 90)),
      source: 'Action items',
      narration: `${opener}${lines.join(' ')}`,
    });
  }
  return scenes;
}

/** The briefing written straight from the meeting notes (no AI). */
export function briefingFromNotes(meeting, items) {
  const open = orderItems(items);
  const people = list(meeting.participants).map(str).filter(Boolean);
  const date = spokenDate(meeting.meeting_date);
  const themes = list(meeting.themes).filter((t) => str(t?.title));
  const decisions = list(meeting.decisions).filter((d) => str(d?.decision));
  const requirements = list(meeting.requirements).filter((r) => str(r?.text));
  const risks = list(meeting.risks).filter((r) => str(r?.risk));
  const questions = list(meeting.open_questions).filter((q) => str(q?.question));
  const scenes = [];

  scenes.push({
    title: meeting.title,
    layout: 'points',
    points: [meeting.team && `${meeting.team} team`, date, meeting.duration_minutes > 0 && `${Math.round(meeting.duration_minutes)} minutes`, people.length && `${people.length} participants`].filter(Boolean),
    source: 'Briefing',
    narration: `Hello everyone, and welcome to this video briefing on the ${meeting.title} meeting${meeting.team ? ` of the ${meeting.team} team` : ''}${date ? `, held on ${date}` : ''}. ${people.length ? `${namesList(people)} took part. ` : ''}In the next few minutes I will walk you through why we met, what we agreed, and exactly what each of you needs to do next.`,
  });
  if (str(meeting.purpose)) {
    scenes.push({ title: 'Why we met', layout: 'rule', quote: clip(str(meeting.purpose), 260), points: [clip(str(meeting.purpose), 120)], source: 'Purpose', narration: `Let's start with why we met. ${str(meeting.purpose)}` });
  }
  if (str(meeting.summary) || themes.length) {
    scenes.push({
      title: 'What we discussed',
      layout: 'points',
      points: themes.length ? themes.slice(0, 5).map((t) => clip(str(t.title), 80)) : [clip(firstSentences(meeting.summary, 1), 100)],
      source: 'Summary',
      narration: `${firstSentences(meeting.summary, 3)}${themes.length ? ` The key ideas to remember are: ${namesList(themes.slice(0, 4).map((t) => str(t.title)))}.` : ''}`,
    });
  }
  if (decisions.length) {
    scenes.push({
      title: 'What we decided',
      layout: 'steps',
      points: decisions.slice(0, 5).map((d) => clip(str(d.decision), 90)),
      source: 'Decisions',
      narration: `We made ${decisions.length === 1 ? 'one decision' : `${decisions.length} decisions`}. ${decisions.slice(0, 5).map((d, i) => `${decisions.length > 1 ? `${['First', 'Second', 'Third', 'Fourth', 'Fifth'][i]}, ${lowerFirst(str(d.decision).replace(/[.]$/, ''))}` : str(d.decision).replace(/[.]$/, '')}${reasonClause(d.rationale)}.`).join(' ')}`,
    });
  }
  if (requirements.length) {
    scenes.push({
      title: 'What is required',
      layout: 'checklist',
      points: requirements.slice(0, 6).map((r) => clip(str(r.text), 90)),
      source: 'Requirements',
      narration: `These are the requirements that came out of the meeting. ${requirements.slice(0, 6).map((r) => `${str(r.text).replace(/[.]$/, '')}${r.priority === 'high' ? ', and this is a high priority' : ''}.`).join(' ')}`,
    });
  }
  scenes.push(...actionItemScenes(open));
  if (risks.length || questions.length) {
    const both = risks.length && questions.length;
    scenes.push({
      title: 'Watch out for',
      layout: both ? 'compare' : 'points',
      ...(both ? { columns: [{ label: 'Risks', tone: 'dont', items: risks.slice(0, 4).map((r) => clip(str(r.risk), 70)) }, { label: 'Open questions', tone: 'neutral', items: questions.slice(0, 4).map((q) => clip(str(q.question), 70)) }] } : {}),
      points: [...risks.slice(0, 4).map((r) => clip(str(r.risk), 90)), ...questions.slice(0, 4).map((q) => clip(str(q.question), 90))].slice(0, 5),
      source: 'Questions & risks',
      narration: `${risks.length ? `Keep an eye on these risks. ${risks.slice(0, 3).map((r) => `${str(r.risk).replace(/[.]$/, '')}${str(r.mitigation) ? `; to handle it, ${lowerFirst(str(r.mitigation).replace(/[.]$/, ''))}` : ''}.`).join(' ')} ` : ''}${questions.length ? `And these questions are still open: ${questions.slice(0, 3).map((q) => `${str(q.question).replace(/[?.]$/, '')}${str(q.owner) ? `, which ${str(q.owner)} will follow up` : ''}?`).join(' ')}` : ''}`,
    });
  }
  scenes.push({
    title: 'Your next steps',
    layout: 'checklist',
    points: [open.length ? 'Check the action items assigned to you' : 'Review the meeting notes', 'Update the status as you make progress', 'Raise blockers early with the team', 'Re-watch this briefing whenever you need it'],
    source: 'Wrap-up',
    narration: `To wrap up: ${open.length ? `there ${open.length === 1 ? 'is one open action item' : `are ${open.length} open action items`}, so please check the ones assigned to you, ` : 'please review the meeting notes, '}keep their status up to date as you make progress, and raise any blockers early. Thank you, and see you at the next meeting.`,
  });
  return scenes.slice(0, MAX_SCENES - 1).concat(scenes.length > MAX_SCENES - 1 ? [scenes.at(-1)] : []);
}

const SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          layout: { type: 'string', enum: LAYOUTS },
          points: { type: 'array', items: { type: 'string' } },
          quote: { type: 'string' },
          table: { type: 'object', properties: { headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } },
          columns: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, tone: { type: 'string', enum: ['do', 'dont', 'neutral'] }, items: { type: 'array', items: { type: 'string' } } } } },
          events: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } } } },
          source: { type: 'string' },
          narration: { type: 'string' },
        },
      },
    },
  },
};

function briefingPrompt(meeting, open) {
  const lines = (arr, f) => list(arr).map(f).filter(Boolean).join('\n') || '(none)';
  return `You are a warm, clear instructor recording a short video briefing for a team about a meeting they had (or missed). You appear on screen as an animated teacher; slides change behind you as you speak. Speak directly to the team ("you", "we").

MEETING: ${meeting.title}${meeting.team ? ` — ${meeting.team} team` : ''}${meeting.meeting_date ? `, ${spokenDate(meeting.meeting_date)}` : ''}
PARTICIPANTS: ${list(meeting.participants).join(', ') || '(unknown)'}
PURPOSE: ${str(meeting.purpose) || '(not stated)'}
SUMMARY: ${str(meeting.summary) || '(none)'}
KEY IDEAS:
${lines(meeting.themes, (t) => str(t?.title) && `- ${str(t.title)}: ${str(t.detail)}`)}
DECISIONS:
${lines(meeting.decisions, (d) => str(d?.decision) && `- ${str(d.decision)}${str(d.rationale) ? ` (why: ${str(d.rationale)})` : ''}${str(d.owner) ? ` [owner: ${str(d.owner)}]` : ''}`)}
REQUIREMENTS:
${lines(meeting.requirements, (r) => str(r?.text) && `- ${str(r.text)}${r.priority ? ` [${r.priority}]` : ''}`)}
OPEN ACTION ITEMS (most urgent first):
${lines(open, (a) => `- ${str(a.task)} — owner: ${str(a.owner_name) || 'team'}${dueOf(a) ? `, due ${dueOf(a)}` : ''}${a.priority ? `, ${a.priority} priority` : ''}${str(a.detail) ? ` (${str(a.detail)})` : ''}`)}
RISKS:
${lines(meeting.risks, (r) => str(r?.risk) && `- ${str(r.risk)}${str(r.mitigation) ? ` (mitigation: ${str(r.mitigation)})` : ''}`)}
OPEN QUESTIONS:
${lines(meeting.open_questions, (q) => str(q?.question) && `- ${str(q.question)}${str(q.owner) ? ` [${str(q.owner)}]` : ''}`)}

Write the briefing as 5–${MAX_SCENES} scenes, in this order (skip a part only when the notes have nothing for it):
1. Welcome: the meeting, team, date and who took part; what the briefing will cover.
2. Purpose: why the team met.
3. What was discussed: the key ideas, explained simply.
4. Decisions, with the reasons.
5. Requirements.
6. Action items — the most important part. Name EVERY open action item listed above with its owner and due date, addressing the owner by name ("Vishnu, you will…"). Use layout "table" with headers ["Task", "Owner", "Due"] and one row per item; split across several scenes when there are more than ${ITEMS_PER_SCENE}.
7. Risks and open questions to watch.
8. Wrap-up: the next steps and a friendly close.

Each scene:
- "title": 2–6 words.
- "layout": one of ${LAYOUTS.join(', ')} (rule = one key sentence in "quote"; compare = exactly two "columns"; timeline = dated "events").
- "points": 2–5 short points (max 12 words each) shown on the slide.
- "source": which part of the notes the scene comes from (e.g. "Purpose", "Action items").
- "narration": what you say during the scene — 40–130 words of natural spoken English, PLAIN TEXT only (no markdown, no stage directions, no emoji). Use the notes' facts, names and dates exactly; never invent tasks, owners or dates.`;
}

function cleanScene(s) {
  const layout = LAYOUTS.includes(s?.layout) ? s.layout : 'points';
  const scene = {
    title: clip(str(s?.title) || 'Briefing', 60),
    layout,
    points: list(s?.points).map(str).filter(Boolean).slice(0, 6).map((p) => clip(p, 110)),
    source: clip(str(s?.source), 40),
    narration: str(s?.narration),
  };
  if (layout === 'rule' && str(s.quote)) scene.quote = clip(str(s.quote), 280);
  if (layout === 'table') {
    const headers = list(s.table?.headers).map(str);
    const rows = list(s.table?.rows).filter((r) => Array.isArray(r) && r.length === headers.length).map((r) => r.map((c) => clip(str(String(c ?? '')), 90)));
    if (headers.length >= 2 && rows.length) scene.table = { headers, rows };
  }
  if (layout === 'compare') {
    const columns = list(s.columns).slice(0, 2).map((c) => ({ label: str(c?.label), tone: ['do', 'dont', 'neutral'].includes(c?.tone) ? c.tone : 'neutral', items: list(c?.items).map(str).filter(Boolean) }));
    if (columns.length === 2 && columns.every((c) => c.label && c.items.length)) scene.columns = columns;
  }
  if (layout === 'timeline') {
    const events = list(s.events).map((e) => ({ label: str(e?.label), text: str(e?.text) })).filter((e) => e.label && e.text);
    if (events.length >= 2) scene.events = events;
  }
  if (!scene.points.length) scene.points = [scene.title];
  return scene;
}

const words = (s) => str(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);

/** True when the scenes mention the action item: its owner and most of its task's words. */
export function mentionsItem(scenes, item) {
  const text = scenes.map((s) => [s.narration, ...s.points, ...(s.table?.rows || []).flat()].join(' ')).join(' ').toLowerCase();
  const owner = str(item.owner_name).toLowerCase().split(' ')[0];
  const task = words(item.task);
  const hit = task.filter((w) => text.includes(w)).length;
  return (!owner || text.includes(owner)) && (task.length === 0 || hit / task.length >= 0.6);
}

/**
 * The AI's deck, cleaned; open action items it left out get their own scene before the wrap-up.
 * Returns null when the answer is unusable (the notes-based deck is used instead).
 */
export function briefingFromAi(result, open) {
  const scenes = list(result?.scenes).map(cleanScene).filter((s) => s.narration.length >= 20).slice(0, MAX_SCENES);
  if (scenes.length < 3) return null;
  const missing = open.filter((a) => !mentionsItem(scenes, a));
  if (missing.length) {
    const extra = actionItemScenes(missing, { label: 'More action items' });
    scenes.splice(Math.max(1, scenes.length - 1), 0, ...extra);
  }
  return scenes;
}

async function withRetry(label, fn, log, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log.warn('pipeline.meeting_video.attempt_failed', { kind: label, attempt: i, error: errMsg(e) });
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

/** Voices every scene with the media provider and joins the parts into one stored MP3 track. */
async function recordVoice(meetingId, scenes, log) {
  if (!mediaEnabled()) throw mediaUnavailableError();
  const voiced = await mapPool(scenes, 3, (s, i) => withRetry(`audio ${i + 1}`, () => generateNarration({ text: s.narration, voice: VOICE }), log));
  const failed = voiced.find((r) => !r.ok);
  if (failed) throw failed.error;
  if (voiced.some((r) => !r.value.bytes)) throw new Error('The media provider returned narration that cannot be joined');
  const joined = concatMp3(voiced.map((r) => r.value.bytes));
  if (!joined.seconds) throw new Error('Narration audio could not be read');
  const hash = crypto.createHash('sha256').update(joined.bytes).digest('hex');
  const key = objectKey('media', 'meeting', meetingId, 'briefing', hash);
  await putObject(key, joined.bytes, { source: 'media', kind: 'audio', meeting_id: meetingId, content_type: 'audio/mpeg' });
  return { audioUrl: `/api/media/${key}`, spans: joined.spans, seconds: joined.seconds };
}

/** Scene timings for the browser voice: about 2.6 words a second, plus a short pause per scene. */
export function estimatedSpans(scenes) {
  let t = 0;
  return scenes.map((s) => {
    const words = str(s.narration).split(' ').filter(Boolean).length;
    const span = { start: t, end: t + Math.max(3, words / 2.6 + 0.8) };
    t = span.end;
    return span;
  });
}

export default async function generateMeetingVideo(payload = {}, ctx = {}) {
  const meetingId = payload?.meeting_id ? String(payload.meeting_id) : '';
  if (!meetingId) throw badRequest('meeting_id is required');
  const { acquired, result } = await withLock(`pipeline:meeting-video:${meetingId}`, () => generate(meetingId, ctx), { ttlMs: 60 * 60 * 1000 });
  if (!acquired) throw conflict('This meeting\'s video is already being generated — try again when it finishes');
  return result;
}

async function generate(meetingId, ctx) {
  const log = ctx.log || defaultLog;
  const meeting = await entities.Meeting.get(meetingId);
  if (!meeting) throw notFound('Meeting not found');
  if (!['needs_review', 'published'].includes(meeting.status)) throw badRequest('Process the transcript first — the video is made from the meeting notes.');

  try {
    await entities.Meeting.update(meetingId, { briefing_status: 'generating', briefing_error: '' });
    const open = orderItems(await entities.ActionItem.filter({ meeting_id: meetingId }, undefined, 500));

    let scenes = null;
    let method = 'notes';
    if (aiEnabled()) {
      try {
        scenes = briefingFromAi(await invokeLLM({ prompt: briefingPrompt(meeting, open), schema: SCHEMA, maxTokens: 12000, effort: 'medium' }), open);
        if (scenes) method = 'ai';
      } catch (e) {
        log.warn('pipeline.meeting_video.script_failed', { meeting_id: meetingId, error: errMsg(e) });
      }
    }
    if (!scenes) scenes = briefingFromNotes(meeting, open);
    scenes = scenes.map((s) => ({ ...s, narration: sceneSpeech(s.narration) }));

    // The voice-over: recorded by the media provider (each scene voiced, then joined so each scene
    // knows when it plays). When the provider is off or refuses (e.g. Base44 out of monthly credits),
    // the briefing is still made: the player reads it aloud with the browser's voice, scene by scene,
    // with timings estimated from the length of each part.
    let voice;
    try {
      voice = await recordVoice(meetingId, scenes, log);
    } catch (e) {
      log.warn('pipeline.meeting_video.voice_unavailable', { meeting_id: meetingId, error: errMsg(e) });
      voice = { audioUrl: '', spans: estimatedSpans(scenes), seconds: 0, error: errMsg(e) };
    }

    const label = [meeting.title, meeting.meeting_date ? spokenDate(meeting.meeting_date) : ''].filter(Boolean).join(' · ');
    const saved = scenes.map((s, i) => {
      const start = +voice.spans[i].start.toFixed(2);
      const end = +voice.spans[i].end.toFixed(2);
      const { narration, ...slide } = s;
      return { start, end, ...slide, playbook: label, text: narration, captions: buildCaptions(narration, start, end) };
    });
    const seconds = Math.round(voice.seconds || saved.at(-1).end);

    await entities.Meeting.update(meetingId, {
      briefing_status: 'ready',
      briefing_audio_url: voice.audioUrl,
      briefing_scenes: JSON.stringify(saved),
      briefing_method: method,
      briefing_voice: voice.audioUrl ? 'recorded' : 'browser',
      briefing_generated_at: new Date().toISOString(),
      // Kept as a note: why the recorded voice-over is missing.
      briefing_error: voice.error || '',
    });
    log.info('pipeline.meeting_video.done', { meeting_id: meetingId, method, voice: voice.audioUrl ? 'recorded' : 'browser', scenes: saved.length, seconds });
    return {
      ok: true, meeting_id: meetingId, audio_url: voice.audioUrl || null, scenes: saved.length, method, seconds,
      voice: voice.audioUrl ? 'recorded' : 'browser', ...(voice.error ? { voice_error: voice.error } : {}),
    };
  } catch (e) {
    log.error('pipeline.meeting_video.failed', { meeting_id: meetingId, error: errMsg(e) });
    try {
      await entities.Meeting.update(meetingId, { briefing_status: 'failed', briefing_error: errMsg(e) });
    } catch { /* ignore */ }
    throw asHttpError(e);
  }
}
