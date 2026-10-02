import { badRequest } from '@/api/drivers/demo/records';
import { findAll, insert, mustGet, patch, persist, removeWhere, sleep } from '@/api/drivers/demo/service';

// Canned playbook extraction + structuring for the demo backend. Output is clearly marked "(demo)".

const VIDEO_TYPES = ['concept', 'deep_dive', 'example', 'architecture', 'demonstration', 'revision'];

function cannedChapters(playbook) {
  const topic = playbook.title || 'the playbook';
  return [
    ['Principles and Scope', `Why ${topic} exists, who it applies to and the principles behind it.`],
    ['Core Practices', `The day-to-day practices ${topic} requires, with worked examples.`],
    ['Operating Model', `Roles, reviews and metrics that keep ${topic} working over time.`],
  ].map(([title, summary], i) => ({
    number: String(i + 1),
    title,
    summary: `${summary} (demo)`,
    section_count: 2,
    content: `${i + 1}.1 ${title} overview. ${summary}\n\n${i + 1}.2 Applying ${title.toLowerCase()}. Teams document decisions, review them with peers and measure the outcome. (demo extraction)`,
  }));
}

export async function processPlaybookExtract({ playbook_id: id } = {}, { user }) {
  const playbook = mustGet('Playbook', id);
  patch('Playbook', id, { status: 'processing', progress: 15, error: '' });
  persist();
  await sleep(600);

  const existing = findAll('Chapter', { playbook_id: id }, 'number');
  const chapters = existing.length
    ? existing.map(({ number, title, summary, content, section_count }) => ({ number, title, summary, content, section_count }))
    : cannedChapters(playbook);
  removeWhere('Chapter', { playbook_id: id });
  chapters.forEach((c) => insert('Chapter', { playbook_id: id, ...c }, user.id));

  const toc = chapters.map((c) => `${c.number}. ${c.title}`).join('\n');
  const version = playbook.version || '1.0';
  patch('Playbook', id, {
    status: 'processed', progress: 50, chapter_count: chapters.length, toc_summary: toc, version,
    author: playbook.author || 'Unknown author (demo)', organization: playbook.organization || 'Inspironics',
  });
  const snapshots = findAll('PlaybookVersion', { playbook_id: id }).length;
  insert('PlaybookVersion', {
    playbook_id: id, version_label: `${version} · extraction ${snapshots + 1}`, title: playbook.title, author: playbook.author,
    organization: playbook.organization, chapter_count: chapters.length, toc_summary: toc, file_name: playbook.file_name,
    file_size: playbook.file_size, chapters_snapshot: JSON.stringify(chapters),
  }, user.id);
  persist();
  return { ok: true, stage: 'extract', playbook_id: id, chapter_count: chapters.length };
}

// Sections look like "1.2 Title. Text…" in the chapter content.
function sectionsOf(chapter) {
  const found = [...String(chapter.content || '').matchAll(/(?:^|\n)(\d+\.\d+)\s+([^.\n]+)\./g)].map((m) => ({ ref: `${m[1]} ${m[2].trim()}`, title: m[2].trim() }));
  return found.length ? found : [{ ref: `${chapter.number}.1 Key concepts`, title: `Key concepts of ${chapter.title}` }, { ref: `${chapter.number}.2 In practice`, title: `${chapter.title} in practice` }];
}

export async function processPlaybookStructure({ playbook_id: id, force = false } = {}, { user }) {
  const playbook = mustGet('Playbook', id);
  const courses = findAll('Course', { playbook_id: id });
  const active = courses.find((c) => c.status === 'pending_review' || c.status === 'published');
  if (active && !force) return { ok: true, skipped: true, stage: 'structure', course_id: active.id, reason: 'An active course already exists' };
  const chapters = findAll('Chapter', { playbook_id: id }).sort((a, b) => Number(a.number) - Number(b.number));
  if (!chapters.length) throw badRequest('No chapters extracted yet — run extraction first');
  await sleep(700);

  courses.forEach((c) => patch('Course', c.id, { status: 'archived', published: false }));
  const version = String(Math.max(0, ...courses.map((c) => Number(c.version) || 0)) + 1);
  const course = insert('Course', {
    playbook_id: id, title: playbook.title, status: 'pending_review', published: false, version,
    description: `Course generated from ${chapters.length} chapters of “${playbook.title}”. (demo)`,
  }, user.id);
  let lessonCount = 0;
  chapters.forEach((chapter, mi) => {
    const sections = sectionsOf(chapter);
    const mod = insert('Module', {
      course_id: course.id, title: chapter.title, description: chapter.summary, order: mi,
      lesson_count: sections.length, source_chapters: `${chapter.number}. ${chapter.title}`,
    }, user.id);
    sections.forEach((s, li) => {
      insert('Lesson', {
        module_id: mod.id, title: s.title, order: li, status: 'pending', duration_target: '8-12 minutes',
        video_type: VIDEO_TYPES[(mi + li) % VIDEO_TYPES.length], source_playbook: playbook.title,
        source_chapter: `${chapter.number}. ${chapter.title}`, source_section: s.ref,
      }, user.id);
      lessonCount += 1;
    });
  });
  patch('Course', course.id, { module_count: chapters.length, lesson_count: lessonCount });
  patch('Playbook', id, { status: 'needs_review', progress: 100 });
  persist();
  return { ok: true, stage: 'structure', course_id: course.id, module_count: chapters.length, lesson_count: lessonCount, chapter_count: chapters.length };
}
