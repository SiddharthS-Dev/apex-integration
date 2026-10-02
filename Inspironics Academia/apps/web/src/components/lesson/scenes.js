// lesson.video_scenes is a JSON array written by generateLessonMedia, times in seconds into the narration:
//   [{ start, end, title, layout, points, captions: [{ start, end, text }], video_url }]
// Scenes from before slides existed have only { start, end, title, video_url }. Anything malformed
// yields [] so the player falls back to one clip.
const LAYOUTS = new Set(['points', 'steps']);

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
    .map((s, i) => ({
      index: i,
      start: +s.start,
      end: +s.end,
      title: String(s.title || `Part ${i + 1}`),
      layout: LAYOUTS.has(s.layout) ? s.layout : 'points',
      points: (Array.isArray(s.points) ? s.points : []).map((p) => String(p).trim()).filter(Boolean),
      captions: cuesOf(s.captions),
      videoUrl: s.video_url || null,
    }))
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

/**
 * How many of a slide's points are on screen at time `t`. They build up over the first 70% of the
 * scene — roughly as the narration reaches each one — so the full slide is up before it moves on.
 */
export function pointsShown(scene, t) {
  const n = scene?.points.length || 0;
  if (!n) return 0;
  const progress = (t - scene.start) / Math.max(0.1, (scene.end - scene.start) * 0.7);
  return Math.max(1, Math.min(n, Math.floor(progress * n) + 1));
}
