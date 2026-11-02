// lesson.video_scenes is a JSON array written by generateLessonMedia, times in seconds into the narration:
//   [{ start, end, title, layout, points, source, playbook, captions: [{ start, end, text }], video_url,
//      ...layout fields (quote · term, definition · columns · question, branches · table · events · code, language) }]
// Scenes from before slides existed have only { start, end, title, video_url }. Anything malformed
// yields [] so the player falls back to one clip; a layout whose fields are missing is drawn as points.
const LAYOUTS = new Set(['points', 'steps', 'checklist', 'rule', 'definition', 'compare', 'decision', 'table', 'timeline', 'code']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);

// The layout-specific part of a scene, or null when it is unusable (the scene then shows its points).
function layoutFields(s) {
  switch (s.layout) {
    case 'rule': return str(s.quote) ? { quote: str(s.quote) } : null;
    case 'definition': return str(s.term) && str(s.definition) ? { term: str(s.term), definition: str(s.definition) } : null;
    case 'compare': {
      const columns = list(s.columns).slice(0, 2).map((c) => ({ label: str(c?.label), tone: str(c?.tone) || 'neutral', items: list(c?.items).map(str).filter(Boolean) }));
      return columns.length === 2 && columns.every((c) => c.label && c.items.length) ? { columns } : null;
    }
    case 'decision': {
      const branches = list(s.branches).map((b) => ({ when: str(b?.when), then: str(b?.then) })).filter((b) => b.when && b.then);
      return branches.length >= 2 ? { question: str(s.question), branches } : null;
    }
    case 'table': {
      const headers = list(s.table?.headers).map(str);
      const rows = list(s.table?.rows).filter((r) => Array.isArray(r) && r.length === headers.length).map((r) => r.map((c) => String(c ?? '')));
      return headers.length >= 2 && rows.length ? { table: { headers, rows } } : null;
    }
    case 'timeline': {
      const events = list(s.events).map((e) => ({ label: str(e?.label), text: str(e?.text) })).filter((e) => e.label && e.text);
      return events.length >= 2 ? { events } : null;
    }
    case 'code': return str(s.code) ? { code: String(s.code).replace(/\s+$/, ''), language: str(s.language) } : null;
    default: return {};
  }
}

const cuesOf = (raw) => (Array.isArray(raw) ? raw : [])
  .filter((c) => c && Number.isFinite(+c.start) && Number.isFinite(+c.end) && String(c.text || '').trim())
  .map((c) => ({ start: +c.start, end: +c.end, text: String(c.text).trim() }));

export function parseScenes(lesson) {
  let raw = lesson?.video_scenes;
  if (!raw) return [];
  try {
    if (typeof raw === 'string') raw = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && Number.isFinite(+s.start) && Number.isFinite(+s.end) && +s.end > +s.start)
    .map((s, i) => {
      const layout = LAYOUTS.has(s.layout) ? s.layout : 'points';
      const fields = layoutFields({ ...s, layout });
      return {
        index: i,
        start: +s.start,
        end: +s.end,
        title: String(s.title || `Part ${i + 1}`),
        layout: fields ? layout : 'points',
        ...(fields || {}),
        points: (Array.isArray(s.points) ? s.points : []).map((p) => String(p).trim()).filter(Boolean),
        source: str(s.source),
        playbook: str(s.playbook),
        captions: cuesOf(s.captions),
        videoUrl: s.video_url || null,
      };
    })
    .sort((a, b) => a.start - b.start);
}

/** True when the scenes carry explainer slides (rather than only clips). */
export const hasSlides = (scenes) => scenes.some((s) => s.points.length);

/** Index of the scene playing at time `t` (the last scene covers the tail). */
export function sceneAt(scenes, t) {
  if (!scenes.length) return -1;
  const i = scenes.findIndex((s) => t < s.end);
  return i === -1 ? scenes.length - 1 : i;
}

/** The subtitle cue being spoken at time `t`, or null between cues. */
export function captionAt(scenes, t) {
  const scene = scenes[sceneAt(scenes, t)];
  return scene?.captions.find((c) => t >= c.start && t < c.end) || null;
}

/** How many items a scene reveals one by one: points, steps, rows, branches, events or code lines. */
export function itemCount(scene) {
  switch (scene?.layout) {
    case 'rule': case 'definition': return 1;
    case 'compare': return scene.columns.reduce((n, c) => n + c.items.length, 0);
    case 'decision': return scene.branches.length;
    case 'table': return scene.table.rows.length;
    case 'timeline': return scene.events.length;
    case 'code': return scene.code.split('\n').length;
    default: return scene?.points.length || 0;
  }
}

/**
 * How many of a slide's items are on screen at time `t`. They build up over the first 70% of the
 * scene — roughly as the narration reaches each one — so the full slide is up before it moves on.
 */
export function pointsShown(scene, t) {
  const n = itemCount(scene);
  if (!n) return 0;
  const progress = (t - scene.start) / Math.max(0.1, (scene.end - scene.start) * 0.7);
  return Math.max(1, Math.min(n, Math.floor(progress * n) + 1));
}
