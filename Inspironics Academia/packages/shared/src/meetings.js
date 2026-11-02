import { addDays, utcToday } from './review.js';

// Meeting transcripts: parsing Teams exports, the analysis shape, a no-AI fallback analysis, matching
// action-item owners to accounts, and due-date reminders. Shared by the API and the demo driver.
//
// Teams exports a transcript in a few shapes; parseTranscript reads all of them:
//   Word (.docx) download     "Priya Raman   0:03" on one line, what they said on the next
//   WebVTT (.vtt)             "00:00:03.120 --> 00:00:07.000" then "<v Priya Raman>text</v>"
//   VTT pasted into Word      a cue line, then the speaker's name, then the text
//   Plain notes               "Priya Raman: text"
// The lines before the first utterance are the header: meeting title, date ("November 1, 2026,
// 4:30AM") and length ("45m 12s").

export const MEETING_EXTENSIONS = ['docx', 'vtt', 'txt'];
const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
export const isMeetingFile = (name) => MEETING_EXTENSIONS.includes(ext(name));

export const ACTION_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const REQUIREMENT_TYPES = ['business', 'functional', 'technical', 'non_functional', 'other'];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Seconds from "1:02:03", "02:03", "0:03.5" or "00:00:03.120". */
export function toSeconds(stamp) {
  const parts = String(stamp).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** "1:02:03" / "2:03" for a number of seconds. */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function isoDate(y, monthIndex, d) {
  const date = new Date(Date.UTC(y, monthIndex, d));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** A meeting date from header text such as "November 1, 2026, 4:30AM" or "2026-11-01". */
export function parseMeetingDate(text) {
  const s = String(text || '');
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return isoDate(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return isoDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  m = s.match(/\b(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return isoDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]);
  return '';
}

/**
 * Title and date from a Teams file name, e.g. "Weekly Sync-20261101_100000-Meeting Recording.docx"
 * → { title: 'Weekly Sync', date: '2026-11-01' }.
 */
export function meetingFromFileName(name = '') {
  const base = String(name).replace(/\.[^.]+$/, '');
  const stamp = base.match(/(\d{4})(\d{2})(\d{2})_\d{6}/);
  const title = base
    .replace(/-?\d{8}_\d{6}/, '')
    .replace(/-?\s*Meeting (Recording|Transcript)\s*$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title || base, date: stamp ? isoDate(+stamp[1], +stamp[2] - 1, +stamp[3]) : '' };
}

const SPEAKER_TIME = /^(.{1,80}?)(?:\s{2,}|\t+)((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)\s*$/;
const SPEAKER_TIME_TIGHT = /^([A-Za-z][^\d:\t]{1,60}?)\s+((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$/;
const CUE = /^((?:\d+:)?\d+:\d+(?:\.\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:\.\d+)?)/;
const VOICE = /^<v(?:\.[^\s>]+)?\s+([^>]+)>(.*?)(?:<\/v>)?\s*$/;
const COLON = /^([A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3}):\s+(.+)$/;
const DURATION = /^(?:(\d+)h\s*)?(\d+)m(?:\s*(\d+)s)?$|^(\d+)s$/;
const SYSTEM = /\b(started|stopped) transcription\b/i;
// A line that is only a person's name (after a VTT cue): one to five capitalised words, no digits.
const NAME_ONLY = /^[A-Z][\p{L}'’.-]*(?:\s+[A-Z(][\p{L}'’.()-]*){0,4}$/u;
// "Date: …", "Attendees: …" in a notes header are not speakers.
const HEADER_KEYS = /^(meeting|title|subject|date|time|duration|location|attendees|participants|organi[sz]er|agenda)$/i;

/**
 * Parses a transcript into { title, date, duration_seconds, segments, participants }.
 * segments: [{ speaker, start (seconds or null), text }], consecutive turns of one speaker merged.
 */
export function parseTranscript(raw = '') {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\u00a0/g, ' ').trimEnd());
  const segments = [];
  const header = [];
  let current = null;
  let cueTime = null;
  let pendingCueSpeaker = false;

  const open = (speaker, start) => {
    current = { speaker: speaker.trim(), start, text: '' };
    segments.push(current);
  };
  const add = (text) => {
    const t = text.trim();
    if (!t || !current) return;
    current.text = current.text ? `${current.text} ${t}` : t;
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'WEBVTT' || /^NOTE\b/.test(t) || /^\d+$/.test(t)) {
      if (!t) pendingCueSpeaker = false;
      continue;
    }
    let m;
    if ((m = t.match(CUE))) {
      cueTime = toSeconds(m[1]);
      pendingCueSpeaker = true;
      continue;
    }
    if ((m = t.match(VOICE))) {
      open(m[1], cueTime);
      add(m[2].replace(/<[^>]+>/g, ''));
      pendingCueSpeaker = false;
      continue;
    }
    if (pendingCueSpeaker && NAME_ONLY.test(t)) {
      // "VTT pasted into Word": the cue line is followed by the speaker's name on its own line.
      open(t, cueTime);
      pendingCueSpeaker = false;
      continue;
    }
    if ((m = t.match(SPEAKER_TIME) || t.match(SPEAKER_TIME_TIGHT))) {
      open(m[1], toSeconds(m[2]));
      continue;
    }
    if (!segments.length && !cueTime) {
      const c = t.match(COLON);
      if (c && !HEADER_KEYS.test(c[1])) {
        open(c[1], null);
        add(c[2]);
        continue;
      }
      header.push(t);
      continue;
    }
    if (current && !current.text) {
      add(t);
      continue;
    }
    const c = current && current.start == null ? t.match(COLON) : null;
    if (c) {
      open(c[1], null);
      add(c[2]);
      continue;
    }
    add(t);
  }

  // Merge consecutive turns of one speaker; drop "X started transcription" and empty turns.
  const merged = [];
  for (const s of segments) {
    if (!s.text || SYSTEM.test(s.text) || SYSTEM.test(s.speaker)) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === s.speaker) prev.text = `${prev.text} ${s.text}`;
    else merged.push({ speaker: s.speaker, start: s.start, text: s.text });
  }

  let duration = null;
  for (const h of header) {
    const d = h.replace(/\s+/g, '').match(DURATION);
    if (d) duration = d[4] ? +d[4] : (+(d[1] || 0)) * 3600 + (+d[2]) * 60 + (+(d[3] || 0));
  }
  const lastStart = [...merged].reverse().find((s) => s.start != null)?.start;
  const dateLine = header.find((h) => parseMeetingDate(h));
  const titleLine = header.find((h) => h !== dateLine && !DURATION.test(h.replace(/\s+/g, '')));

  return {
    title: titleLine ? titleLine.replace(/-?\d{8}_\d{6}.*$/, '').replace(/-?\s*Meeting (Recording|Transcript)\s*$/i, '').trim() : '',
    date: dateLine ? parseMeetingDate(dateLine) : '',
    duration_seconds: duration ?? (lastStart != null ? Math.round(lastStart) : null),
    segments: merged,
    participants: [...new Set(merged.map((s) => s.speaker))],
  };
}

const words = (text) => (String(text).match(/[\p{L}\p{N}'’]+/gu) || []).length;

/** Per speaker: turns, words, estimated seconds and share of the talking — most talkative first. */
export function speakerStats(segments = [], durationSeconds = null) {
  const by = new Map();
  segments.forEach((s, i) => {
    const next = segments.slice(i + 1).find((x) => x.start != null);
    const seconds = s.start != null && next ? Math.max(0, next.start - s.start)
      : s.start != null && durationSeconds ? Math.max(0, durationSeconds - s.start)
        : words(s.text) / 2.5; // ~150 words a minute when there are no timestamps
    const row = by.get(s.speaker) || { name: s.speaker, turns: 0, words: 0, seconds: 0 };
    row.turns += 1;
    row.words += words(s.text);
    row.seconds += seconds;
    by.set(s.speaker, row);
  });
  const totalWords = [...by.values()].reduce((n, r) => n + r.words, 0) || 1;
  return [...by.values()]
    .map((r) => ({ ...r, seconds: Math.round(r.seconds), share: Math.round((r.words / totalWords) * 100) }))
    .sort((a, b) => b.words - a.words);
}

/** The transcript as "[m:ss] Speaker: text" lines, the form the model reads. */
export function formatTranscript(segments = []) {
  return segments.map((s) => `${s.start != null ? `[${formatClock(s.start)}] ` : ''}${s.speaker}: ${s.text}`).join('\n');
}

/**
 * The team a transcript belongs to: the first folder under the meetings folder it was filed in, without
 * a trailing "Meeting Transcripts"/"Meetings"/"Transcripts" ("…/HMS Meeting Transcripts/x.docx" → "HMS").
 * '' for a transcript directly in the meetings folder.
 */
export function teamFromPath(path = '', meetingsPath = '') {
  const parts = String(path).split('/').filter(Boolean);
  const base = String(meetingsPath === '/' ? '' : meetingsPath).split('/').filter(Boolean);
  const within = parts.slice(0, -1);
  const startsWith = base.every((seg, i) => (within[i] || '').toLowerCase() === seg.toLowerCase());
  const folder = startsWith ? within[base.length] : within[within.length - 1];
  if (!folder) return '';
  const name = folder.replace(/[\s_-]*(meeting\s+transcripts?|meetings?|transcripts?)$/i, '').replace(/[_]+/g, ' ').trim();
  return name || folder.trim();
}

// ---- analysis shape ------------------------------------------------------------------------------

const clipText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

/**
 * Cleans an analysis (from the model or the heuristic) into the stored shape:
 * { title, summary, purpose, themes, decisions, requirements, action_items, open_questions, risks }.
 * Owners are kept only when they name a participant; anything malformed is dropped, never invented.
 */
export function normalizeAnalysis(raw = {}, { participants = [] } = {}) {
  const people = new Map(participants.map((p) => [p.toLowerCase(), p]));
  const person = (name) => {
    const n = clipText(name, 80);
    if (!n) return '';
    if (people.has(n.toLowerCase())) return people.get(n.toLowerCase());
    const first = [...people.values()].filter((p) => p.toLowerCase().split(/\s+/)[0] === n.toLowerCase().split(/\s+/)[0]);
    return first.length === 1 ? first[0] : n;
  };
  return {
    title: clipText(raw.title, 140),
    summary: clipText(raw.summary, 2000),
    purpose: clipText(raw.purpose, 400),
    themes: arr(raw.themes).map((t) => ({ title: clipText(t?.title, 100), detail: clipText(t?.detail, 600) })).filter((t) => t.title).slice(0, 8),
    decisions: arr(raw.decisions).map((d) => ({ decision: clipText(d?.decision, 300), rationale: clipText(d?.rationale, 400), owner: person(d?.owner) })).filter((d) => d.decision).slice(0, 20),
    requirements: arr(raw.requirements).map((r) => ({
      text: clipText(r?.text, 400),
      type: oneOf(r?.type, REQUIREMENT_TYPES, 'other'),
      priority: oneOf(r?.priority, PRIORITIES, 'medium'),
      raised_by: person(r?.raised_by),
    })).filter((r) => r.text).slice(0, 30),
    action_items: arr(raw.action_items).map((a) => ({
      task: clipText(a?.task, 300),
      detail: clipText(a?.detail, 600),
      owner: person(a?.owner),
      due_date: validDate(a?.due_date),
      due_text: clipText(a?.due_text, 60),
      priority: oneOf(a?.priority, PRIORITIES, 'medium'),
      quote: clipText(a?.quote, 400),
      time: Number.isFinite(+a?.time) && a?.time !== '' && a?.time != null ? Math.max(0, Math.round(+a.time)) : null,
    })).filter((a) => a.task).slice(0, 40),
    open_questions: arr(raw.open_questions).map((q) => ({ question: clipText(q?.question, 300), owner: person(q?.owner) })).filter((q) => q.question).slice(0, 15),
    risks: arr(raw.risks).map((r) => ({ risk: clipText(r?.risk, 300), impact: oneOf(r?.impact, PRIORITIES, 'medium'), mitigation: clipText(r?.mitigation, 300) })).filter((r) => r.risk).slice(0, 15),
  };
}

// ---- heuristic analysis (no AI) ------------------------------------------------------------------

const sentences = (text) => String(text).match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter((s) => s.length > 3) || [];

/** "by Friday", "tomorrow", "next week", "by 15 November" → ISO date relative to the meeting, or ''. */
export function resolveDue(phrase, meetingDate) {
  const p = String(phrase || '').toLowerCase();
  const base = validDate(meetingDate) || utcToday();
  if (/\b(today|end of (the )?day|eod)\b/.test(p)) return base;
  if (/\btomorrow\b/.test(p)) return addDays(base, 1);
  if (/\bnext week\b/.test(p)) return addDays(base, 7);
  if (/\bend of (the )?week|\beow\b/.test(p)) {
    const dow = new Date(`${base}T00:00:00Z`).getUTCDay();
    return addDays(base, (5 - dow + 7) % 7);
  }
  const wd = WEEKDAYS.findIndex((d) => p.includes(d));
  if (wd >= 0) {
    const dow = new Date(`${base}T00:00:00Z`).getUTCDay();
    return addDays(base, ((wd - dow + 7) % 7) || 7);
  }
  const explicit = parseMeetingDate(`${phrase} ${base.slice(0, 4)}`);
  return explicit || '';
}

const DUE = /\b(by|before|until|due|on)\s+(today|tomorrow|end of (?:the )?(?:day|week)|eod|eow|next week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+|[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)\b/i;
const BARE_DUE = /\b(today|tomorrow|next week|end of (?:the )?(?:day|week)|eod|eow)\b/i;
const COMMIT = /\b(I'll|I will|I'm going to|I can take|I'll take|we'll|we will|let me|action item|to-?do|follow[- ]up|can you|could you|would you|please)\b/i;
const DECIDE = /\b(we('ve| have)? decided|we agreed|agreed (that|to)|let's go with|we'll go with|final decision|decision is|(?:is|was|were|has been|have been|got) approved|we approve[sd]?)\b/i;
const REQUIRE = /\b(must|has to|have to|is required|requirement|needs? to support|should support|shall|mandatory)\b/i;
const RISK = /\b(risk|concern|blocker|blocked|worried|might slip|delay|dependency)\b/i;
const OPEN = /\b(not sure|tbd|to be decided|open question|need to figure out|we don't know|unclear)\b/i;

const STOP = new Set('the a an and or but so to of in on at for with from this that these those is are was were be been being it its we you they i he she our your their my me us them as by if then than there here what which who whom when where why how all any each few more most other some such no nor not only own same too very can will just should now also about into over after before again further once do does did doing have has had having would could yeah okay ok right um uh like know think going get got really thing things lot want need mean sure well let lets yes one two'.split(' '));

/**
 * A rule-based analysis for when AI is off: commitments become action items (owner = the speaker,
 * or the person asked), with due dates resolved against the meeting date; decisions, requirements,
 * risks and open questions by their wording; themes from the most frequent two-word phrases.
 */
export function heuristicAnalysis(parsed, { date = '' } = {}) {
  const segs = parsed.segments || [];
  const firstNames = new Map(parsed.participants.map((p) => [p.split(/\s+/)[0].toLowerCase(), p]));
  const out = { title: parsed.title || '', summary: '', purpose: '', themes: [], decisions: [], requirements: [], action_items: [], open_questions: [], risks: [] };

  for (const s of segs) {
    for (const sentence of sentences(s.text)) {
      if (COMMIT.test(sentence) && (/\b(I'll|I will|I'm going to|I can take|I'll take|let me)\b/i.test(sentence) || DUE.test(sentence) || /\b(action item|follow[- ]up|can you|could you)\b/i.test(sentence))) {
        const asked = sentence.match(/\b(?:can|could|would)\s+you\b/i) && [...firstNames.keys()].find((n) => new RegExp(`\\b${n}\\b`, 'i').test(sentence));
        const due = sentence.match(DUE);
        const bare = due ? null : sentence.match(BARE_DUE);
        out.action_items.push({
          task: sentence.replace(/^(so|okay|ok|and|yeah|right)[, ]+/i, '').slice(0, 200),
          owner: asked ? firstNames.get(asked) : s.speaker,
          due_text: due ? due[0] : bare ? bare[0] : '',
          due_date: due ? resolveDue(due[2], date) : bare ? resolveDue(bare[0], date) : '',
          priority: /\b(urgent|asap|critical|priority)\b/i.test(sentence) ? 'high' : 'medium',
          quote: sentence,
          time: s.start,
        });
        continue;
      }
      if (DECIDE.test(sentence)) {
        out.decisions.push({ decision: sentence, owner: s.speaker });
        continue;
      }
      if (REQUIRE.test(sentence)) {
        out.requirements.push({ text: sentence, type: 'other', priority: 'medium', raised_by: s.speaker });
      } else if (OPEN.test(sentence) || (sentence.endsWith('?') && sentence.length > 40)) {
        out.open_questions.push({ question: sentence, owner: s.speaker });
      }
      if (RISK.test(sentence) && sentence.length > 30) out.risks.push({ risk: sentence, impact: 'medium' });
    }
  }

  // Themes: frequent two-word phrases without filler words.
  const counts = new Map();
  for (const s of segs) {
    const toks = (s.text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]+/gu) || []).filter((w) => w.length > 2);
    for (let i = 0; i < toks.length - 1; i++) {
      if (STOP.has(toks[i]) || STOP.has(toks[i + 1])) continue;
      const k = `${toks[i]} ${toks[i + 1]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  out.themes = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => ({ title: k.replace(/\b\w/g, (c) => c.toUpperCase()), detail: `Mentioned ${n} times.` }));

  const stats = speakerStats(segs, parsed.duration_seconds);
  const mins = parsed.duration_seconds ? Math.round(parsed.duration_seconds / 60) : null;
  out.summary = [
    `${parsed.participants.length} participant${parsed.participants.length === 1 ? '' : 's'}${mins ? ` over ${mins} minutes` : ''}.`,
    stats[0] ? `${stats.slice(0, 3).map((s) => `${s.name} (${s.share}%)`).join(', ')} spoke most.` : '',
    `${out.action_items.length} possible action item${out.action_items.length === 1 ? '' : 's'} and ${out.decisions.length} decision${out.decisions.length === 1 ? '' : 's'} found by keyword. Turn on AI for a written summary.`,
  ].filter(Boolean).join(' ');
  out.risks = out.risks.slice(0, 10);
  out.open_questions = out.open_questions.slice(0, 10);
  return out;
}

// ---- team rosters --------------------------------------------------------------------------------

export const TEAM_ROLES = ['member', 'sme'];

const nameTokens = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * True when two spellings name the same person: identical once case, spacing and punctuation are
 * ignored ("Siva Subramanian N" = "SivaSubramanian N"), or the same given name(s) with a surname and its
 * initial ("Siva Subramanian N" = "Sivasubramanian Narayanan").
 */
export function samePerson(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join('') === tb.join('')) return true;
  if (ta.length < 2 || tb.length < 2) return false;
  const given = (t) => t.slice(0, -1).join('');
  const last = (t) => t[t.length - 1];
  const [la, lb] = [last(ta), last(tb)];
  const initialOk = la === lb || (la.length === 1 && lb.startsWith(la)) || (lb.length === 1 && la.startsWith(lb));
  return given(ta) === given(tb) && initialOk;
}

/** The roster entry a transcript name refers to (by name or alias), or null. */
export function rosterMatch(name, members = []) {
  return members.find((m) => samePerson(name, m.name) || (m.aliases || []).some((a) => samePerson(name, a))) || null;
}

// A Teams login shared by several people ("Admin Inspironics") is not a team member.
const SHARED_LOGIN = /\b(admin|administrator|meeting room|conference room|guest|test|bot)\b/i;

/**
 * A roster built from a team's meetings: everyone who spoke in at least two of them (in a team with
 * one or two meetings, everyone who spoke), one entry per person with other spellings as aliases.
 * People named in `smes` (SMEs on other teams) are SMEs here too and join on any appearance. Shared
 * logins and one-off attendees are left out — they show as guests. Each entry carries `meetings`, how
 * many of the team's meetings the person spoke in. Sorted SMEs last, then by attendance.
 */
export function suggestRoster(meetings = [], { smes = [] } = {}) {
  const people = [];
  for (const m of meetings) {
    const seen = new Set();
    for (const p of m.participants || []) {
      if (SHARED_LOGIN.test(p)) continue;
      let entry = people.find((e) => samePerson(e.name, p) || e.aliases.some((a) => samePerson(a, p)));
      if (!entry) {
        entry = { name: p, aliases: [], meetings: 0 };
        people.push(entry);
      } else if (entry.name !== p && !entry.aliases.includes(p)) {
        entry.aliases.push(p);
      }
      if (!seen.has(entry)) { entry.meetings += 1; seen.add(entry); }
    }
  }
  const minMeetings = meetings.length <= 2 ? 1 : 2;
  const isSme = (name, aliases) => smes.some((s) => samePerson(s, name) || aliases.some((a) => samePerson(s, a)));
  return people
    .map((e) => ({ ...e, role: isSme(e.name, e.aliases) ? 'sme' : 'member' }))
    .filter((e) => e.role === 'sme' || e.meetings >= minMeetings)
    .sort((a, b) => (a.role === 'sme') - (b.role === 'sme') || b.meetings - a.meetings || a.name.localeCompare(b.name));
}

/**
 * Who a team's meetings involved. With a roster: { members, smes } are its people (counted whether or
 * not they spoke), `guests` everyone else who spoke. Without one, the roster suggestRoster would build
 * from the participants is used the same way (`roster: false` says it is a suggestion).
 */
export function teamPeople(meetings = [], roster = null, { smes = [] } = {}) {
  const spoke = [];
  for (const m of meetings) for (const p of m.participants || []) if (!spoke.some((s) => samePerson(s, p))) spoke.push(p);
  const saved = (roster?.members || []).filter((m) => String(m.name || '').trim());
  const members = saved.length ? saved : suggestRoster(meetings, { smes });
  if (!members.length) return { roster: false, people: [], members: [], smes: [], guests: spoke };
  return {
    roster: saved.length > 0,
    people: members.map((m) => m.name),
    members: members.filter((m) => m.role !== 'sme').map((m) => m.name),
    smes: members.filter((m) => m.role === 'sme').map((m) => m.name),
    guests: spoke.filter((p) => !rosterMatch(p, members)),
  };
}

// ---- owners and reminders ------------------------------------------------------------------------

const normName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * The account an owner name refers to: exact full name, then email local part ("priya.raman"),
 * then a first name only one active user has. Null when unsure.
 */
export function matchOwner(name, users = []) {
  const n = normName(name);
  if (!n) return null;
  const active = users.filter((u) => !u.disabled);
  const full = active.filter((u) => normName(u.full_name) === n);
  if (full.length === 1) return full[0];
  const byEmail = active.filter((u) => normName(String(u.email || '').split('@')[0].replace(/[._-]+/g, ' ')) === n);
  if (byEmail.length === 1) return byEmail[0];
  const first = n.split(' ')[0];
  if (n.split(' ').length === 1) {
    const byFirst = active.filter((u) => normName(u.full_name).split(' ')[0] === first);
    if (byFirst.length === 1) return byFirst[0];
  }
  return null;
}

/**
 * Daily reminders for assigned, published action items: one the day before it is due, one once it
 * is overdue. Dedupe keys make it safe to run repeatedly. Returns { due_soon, overdue }.
 */
export async function actionItemReminders(store, { today = utcToday(), notify = () => {} } = {}) {
  const items = (await store.filter('ActionItem', { published: true, status: { $in: ['open', 'in_progress'] } }, null, 100000))
    .filter((a) => a.owner_user_id && a.due_date);
  const summary = { due_soon: 0, overdue: 0 };
  for (const a of items) {
    const data = { task: a.task, meeting_title: a.meeting_title, due_date: a.due_date, meeting_id: a.meeting_id };
    if (a.due_date < today) {
      await notify(a.owner_user_id, 'action_item_overdue', data, `action_item_overdue:${a.id}`);
      summary.overdue += 1;
    } else if (a.due_date <= addDays(today, 1)) {
      await notify(a.owner_user_id, 'action_item_due', data, `action_item_due:${a.id}`);
      summary.due_soon += 1;
    }
  }
  return summary;
}
