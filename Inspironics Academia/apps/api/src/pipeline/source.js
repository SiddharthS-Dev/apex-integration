import { entities } from '../repo/entities.js';
import { norm } from './util.js';

// Where a lesson comes from: its module, course, playbook and the playbook chapter it teaches.

function wordOverlap(a, b) {
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

/** Find the chapter that best matches a lesson's source_chapter (falls back to module source chapters). */
export function matchChapter(chapters, sourceChapter, moduleSources) {
  if (!chapters.length) return null;
  const target = norm(sourceChapter);
  if (target) {
    const exact = chapters.find((c) => norm(c.title) === target);
    if (exact) return exact;
    const contains = chapters.find((c) => {
      const t = norm(c.title);
      return t && (t.includes(target) || target.includes(t));
    });
    if (contains) return contains;
  }
  const candidates = [sourceChapter, ...String(moduleSources || '').split(',')].map((s) => String(s || '').trim()).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const c of chapters) {
    for (const cand of candidates) {
      const score = wordOverlap(c.title, cand);
      if (score > bestScore) { best = c; bestScore = score; }
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/**
 * The lesson's source: { mod, course, playbook, chapter, version } — any of them null when missing.
 * `version` is the playbook's latest version label (e.g. "v3 (2.1)"), for on-screen references.
 */
export async function loadLessonSource(lesson) {
  const mod = lesson.module_id ? await entities.Module.get(lesson.module_id) : null;
  const course = mod?.course_id ? await entities.Course.get(mod.course_id) : null;
  const playbook = course?.playbook_id ? await entities.Playbook.get(course.playbook_id) : null;
  const chapters = playbook ? await entities.Chapter.filter({ playbook_id: playbook.id }) : [];
  const chapter = matchChapter(chapters, lesson.source_chapter || '', mod?.source_chapters || '');
  const [latest] = playbook ? await entities.PlaybookVersion.filter({ playbook_id: playbook.id }, '-created_date', 1) : [];
  return { mod, course, playbook, chapter, version: latest?.version_label || playbook?.version || '' };
}
