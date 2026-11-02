import { norm } from './util.js';

// The plan for a lesson video, grounded in its playbook chapter.
//
// Every lesson has a video_type, and each type teaches in its own order (VIDEO_STRUCTURES): the
// script follows it, and the slide designer picks scene layouts that suit it. Slides are designed
// from the playbook chapter itself, not only from the narration, so a procedure is shown as the
// playbook's steps, a rule as the playbook's own words, a threshold table as the table. Each slide
// names the playbook section it comes from.
//
// Anything a slide presents as the playbook's own words (a rule's quote, a code or config block) is
// checked against the chapter text. When it is not there, the slide falls back to plain points, so a
// video never shows a quotation the playbook does not contain.

export const VIDEO_STRUCTURES = {
  concept: {
    flow: 'hook → why it matters → what the core idea is (define it) → how it works → a realistic example → the common mistake → recap',
    layouts: ['definition', 'rule', 'compare', 'points'],
  },
  deep_dive: {
    flow: 'context → the mechanism in detail → edge cases and trade-offs → the rules the playbook sets → a worked example → recap',
    layouts: ['rule', 'table', 'decision', 'steps'],
  },
  example: {
    flow: 'the situation → what happened, in order → the decisions made → what the playbook says should happen → lessons learned → recap',
    layouts: ['timeline', 'decision', 'compare', 'rule'],
  },
  architecture: {
    flow: 'the big picture → each component in turn → how requests and data flow between them → failure points and safeguards → recap',
    layouts: ['steps', 'table', 'compare', 'points'],
  },
  demonstration: {
    flow: 'the goal → prerequisites → the procedure, step by step → how to verify it worked (checklist) → common mistakes → recap',
    layouts: ['steps', 'checklist', 'code', 'compare'],
  },
  revision: {
    flow: 'a rapid recap of each key rule and term → a quick self-check → one-line takeaways',
    layouts: ['rule', 'definition', 'checklist', 'points'],
  },
};

export const structureFor = (videoType) => VIDEO_STRUCTURES[videoType] || VIDEO_STRUCTURES.concept;

// What each layout is for — the slide designer's menu.
export const SLIDE_LAYOUTS = {
  points: 'key ideas as a short list (the default when nothing more specific fits)',
  steps: 'an ordered procedure, stages or sequence, drawn as numbered steps',
  checklist: 'things to check, confirm or have in place, ticked off one by one',
  rule: 'one rule, policy or requirement quoted word for word from the playbook ("must", "never", "always")',
  definition: 'one term and what it means, as the playbook defines it',
  compare: 'two sides set against each other: do vs don\'t, before vs after, option A vs option B',
  decision: 'conditions and what to do in each ("if severity is P1, then …"), drawn as branches',
  table: 'values the playbook gives as a table or list of pairs: thresholds, roles, SLAs, limits',
  timeline: 'events in time order, as in an incident or case study',
  code: 'a command, configuration or code sample copied exactly from the playbook',
};
export const LAYOUT_NAMES = Object.keys(SLIDE_LAYOUTS);

const MAX_POINT = 110;
const MAX_CELL = 48;
const MAX_QUOTE = 280;

export const clip = (text, max) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:–-]+$/, '')}…`;
};

const strings = (list, max, n) => (Array.isArray(list) ? list : [])
  .map((p) => clip(String(p ?? '').replace(/^[-*•\d.)\s]+/, '').replace(/[.]+$/, ''), max))
  .filter((p) => p.length >= 2)
  .slice(0, n);

// Text compared for "is this really in the playbook": case, spacing, quote and dash styles ignored.
const loose = (s) => String(s || '').toLowerCase()
  .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/** True when `quote` appears in `source` word for word (ignoring case, spacing and typographic quotes). */
export function verbatimIn(source, quote) {
  const q = loose(quote).replace(/^["']|["']$/g, '').replace(/[.;:,]+$/, '');
  return q.length >= 12 && loose(source).includes(q);
}

/** True when every non-blank line of `code` appears in `source`. */
export function codeIn(source, code) {
  const lines = String(code || '').split('\n').map((l) => loose(l)).filter(Boolean);
  const src = loose(source);
  return lines.length > 0 && lines.every((l) => src.includes(l));
}

/** A section reference the chapter actually has; otherwise the lesson's own section or chapter. */
function sourceRef(raw, source, fallback) {
  const ref = clip(raw, 70);
  if (ref && norm(source).includes(norm(ref.replace(/^§\s*/, '')))) return ref.replace(/^§\s*/, '');
  return clip(fallback, 70);
}

/**
 * Turns one storyboard scene from the model into a slide the player can draw, enforcing each
 * layout's shape and the verbatim checks. Always returns a usable slide: a layout whose fields are
 * missing or unverifiable becomes 'points' (from the model's points, else `fallbackPoints`).
 * Every slide keeps a `points` summary, used by the player's accessible text and older clients.
 */
export function normalizeSlide(raw = {}, { source = '', sectionFallback = '', fallbackPoints = [] } = {}) {
  const layout = LAYOUT_NAMES.includes(raw.layout) ? raw.layout : 'points';
  const points = strings(raw.points, MAX_POINT, layout === 'steps' || layout === 'checklist' ? 6 : 4);
  const base = { title: clip(raw.title, 60), source: sourceRef(raw.source_ref, source, sectionFallback) };
  const asPoints = (extra = []) => {
    const pts = points.length ? points : extra.length ? extra : fallbackPoints;
    return { ...base, layout: 'points', points: pts.slice(0, 4) };
  };

  switch (layout) {
    case 'points':
      return asPoints();
    case 'steps':
    case 'checklist':
      return points.length >= 2 ? { ...base, layout, points } : asPoints();
    case 'rule': {
      const quote = clip(raw.quote, MAX_QUOTE).replace(/^["“']|["”']$/g, '');
      if (!verbatimIn(source, quote)) return asPoints(strings([quote], MAX_POINT, 1));
      return { ...base, layout, quote, points: points.length ? points : strings([quote], MAX_POINT, 1) };
    }
    case 'definition': {
      const term = clip(raw.term, 40);
      const definition = clip(raw.definition, 220);
      if (!term || !definition) return asPoints();
      return { ...base, layout, term, definition, points: points.length ? points : [`${term}: ${clip(definition, MAX_POINT)}`] };
    }
    case 'compare': {
      const columns = (Array.isArray(raw.columns) ? raw.columns : []).slice(0, 2).map((c) => ({
        label: clip(c?.label, 28),
        tone: ['do', 'dont', 'neutral'].includes(c?.tone) ? c.tone : 'neutral',
        items: strings(c?.items, 80, 4),
      }));
      if (columns.length !== 2 || columns.some((c) => !c.label || !c.items.length)) return asPoints();
      return { ...base, layout, columns, points: points.length ? points : columns.flatMap((c) => c.items.map((i) => `${c.label}: ${i}`)).slice(0, 4) };
    }
    case 'decision': {
      const branches = (Array.isArray(raw.branches) ? raw.branches : [])
        .map((b) => ({ when: clip(b?.when, 60), then: clip(b?.then, 90) }))
        .filter((b) => b.when && b.then)
        .slice(0, 4);
      if (branches.length < 2) return asPoints();
      return { ...base, layout, question: clip(raw.question, 80), branches, points: points.length ? points : branches.map((b) => `${b.when} → ${b.then}`) };
    }
    case 'table': {
      const headers = strings(raw.table?.headers, 28, 4);
      const rows = (Array.isArray(raw.table?.rows) ? raw.table.rows : [])
        .map((r) => (Array.isArray(r) ? r : []).slice(0, headers.length).map((c) => clip(c, MAX_CELL)))
        .filter((r) => r.length === headers.length && r.every(Boolean))
        .slice(0, 6);
      if (headers.length < 2 || rows.length < 2) return asPoints();
      return { ...base, layout, table: { headers, rows }, points: points.length ? points : rows.slice(0, 4).map((r) => r.join(' — ')) };
    }
    case 'timeline': {
      const events = (Array.isArray(raw.events) ? raw.events : [])
        .map((e) => ({ label: clip(e?.label, 24), text: clip(e?.text, 90) }))
        .filter((e) => e.label && e.text)
        .slice(0, 5);
      if (events.length < 2) return asPoints();
      return { ...base, layout, events, points: points.length ? points : events.map((e) => `${e.label}: ${e.text}`) };
    }
    case 'code': {
      const code = String(raw.code || '').replace(/\r/g, '').split('\n').slice(0, 14).map((l) => l.slice(0, 90)).join('\n').trim();
      if (!codeIn(source, code)) return asPoints();
      return { ...base, layout, code, language: clip(raw.language, 20), points: points.length ? points : [base.title || 'Code sample'] };
    }
    default:
      return asPoints();
  }
}

export const STORYBOARD_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Slide heading, 2–7 words' },
          layout: { type: 'string', enum: LAYOUT_NAMES },
          source_ref: { type: 'string', description: 'The playbook section heading this slide comes from, as written in the chapter' },
          points: { type: 'array', items: { type: 'string' }, description: '2–4 key points (up to 6 for steps and checklist), each at most 14 words' },
          quote: { type: 'string', description: 'rule: the rule copied word for word from the chapter' },
          term: { type: 'string', description: 'definition: the term' },
          definition: { type: 'string', description: 'definition: its meaning, as the playbook defines it' },
          columns: {
            type: 'array',
            description: 'compare: exactly two columns',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                tone: { type: 'string', enum: ['do', 'dont', 'neutral'] },
                items: { type: 'array', items: { type: 'string' } },
              },
              required: ['label', 'tone', 'items'],
            },
          },
          question: { type: 'string', description: 'decision: the question being decided' },
          branches: {
            type: 'array',
            description: 'decision: 2–4 condition → action pairs',
            items: { type: 'object', properties: { when: { type: 'string' }, then: { type: 'string' } }, required: ['when', 'then'] },
          },
          table: {
            type: 'object',
            description: 'table: 2–4 headers and 2–6 rows of the same width',
            properties: {
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            required: ['headers', 'rows'],
          },
          events: {
            type: 'array',
            description: 'timeline: 2–5 events in order',
            items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'] },
          },
          code: { type: 'string', description: 'code: lines copied exactly from the chapter' },
          language: { type: 'string' },
          visual: { type: 'string', description: 'Only when asked: the brief for a silent background clip, 40–100 words' },
        },
        required: ['title', 'layout', 'source_ref', 'points'],
      },
    },
  },
  required: ['scenes'],
};

/** The slide designer's prompt: the playbook chapter, the lesson's structure, and the narration parts. */
export function storyboardPrompt({ lesson, segments, source, keyPoints = [], clips = false }) {
  const structure = structureFor(lesson.video_type);
  return [
    `Design the on-screen slides for a professional training video of the engineering lesson "${lesson.video_title || lesson.title}". The narration is split into ${segments.length} consecutive parts; each part is shown as one slide while it is spoken, with subtitles underneath.`,
    '',
    `Lesson type: ${lesson.video_type || 'concept'} — it teaches in this order: ${structure.flow}.`,
    lesson.teaching_objective ? `Learning goal: ${lesson.teaching_objective}` : '',
    keyPoints.length ? `Lesson key points:\n- ${keyPoints.join('\n- ')}` : '',
    '',
    `SOURCE: playbook "${source.playbook || lesson.source_playbook || ''}"${source.version ? ` (${source.version})` : ''}, chapter "${source.chapter || lesson.source_chapter || ''}". The slides must show what THIS text says.`,
    '"""',
    source.text || '(chapter text unavailable — use only what the narration says)',
    '"""',
    '',
    ...segments.map((s, i) => `Part ${i + 1}: ${s}`),
    '',
    `Return exactly ${segments.length} slides, in order, one per part. For each, pick the layout that shows the part's content best:`,
    ...LAYOUT_NAMES.map((name) => `- ${name}: ${SLIDE_LAYOUTS[name]}`),
    `Layouts that usually suit a ${lesson.video_type || 'concept'} lesson: ${structure.layouts.join(', ')}. Vary them: avoid the same layout on more than two slides in a row, and use "points" only when nothing more specific fits.`,
    '',
    'Rules for every slide:',
    '- title: a 2–7 word heading naming what this part teaches, in the playbook\'s terms. Never promise a count the slide does not show.',
    '- source_ref: the heading of the chapter section this part draws on, copied as it appears in the chapter text (e.g. "3.2 Escalation Path").',
    '- points: 2–4 short key points in the order they are spoken (up to 6 for steps and checklist), at most 14 words each, no trailing full stops. Always fill them, whatever the layout: they are the slide\'s text summary.',
    '- Show what the playbook actually says: its exact step order, its numbers, thresholds, role names and terms. No facts, numbers or claims that are in neither the chapter nor the narration.',
    '- rule: "quote" must be copied character for character from the chapter text above, at most 2 sentences. If no sentence fits, choose another layout.',
    '- code: "code" must be lines copied exactly from the chapter text. If the chapter has no code or config for this part, choose another layout.',
    '- compare: exactly two columns, each 1–4 items of at most 10 words; tone "do"/"dont" for right vs wrong practice, otherwise "neutral".',
    '- decision: 2–4 branches; "when" is the condition (at most 8 words), "then" the action (at most 12 words).',
    '- table: 2–4 columns, 2–6 rows, short cells, values exactly as the playbook gives them.',
    '- timeline: 2–5 events with a short label (a time, a stage or "T+15 min") and what happened.',
    '- Fill only the fields of the layout you chose; leave the others out.',
    clips
      ? '- visual: a silent 8-second background clip for the slide: one abstract technical motion-graphic matching the idea, with no text, letters, numbers, people or logos in it.'
      : '- visual: leave it out.',
  ].filter((l) => l !== null && l !== undefined).join('\n');
}
