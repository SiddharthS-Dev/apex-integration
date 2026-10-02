import { ENTITY_NAMES } from '@academy/shared';
import { newId, stamp } from '@/api/drivers/demo/records';
import { API_CHAPTERS, SRE_CHAPTERS } from '@/api/drivers/demo/seedChapters';
import { API_DRAFT_MODULE, RELIABILITY_MODULES } from '@/api/drivers/demo/seedLessons';

// Builds the initial demo academy: two users, a published course and a draft awaiting review.

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const SRE_PLAYBOOK = 'Site Reliability Engineering Playbook';
const API_PLAYBOOK = 'API Design Standards';

function demoUser(email, fullName, role, age) {
  const at = daysAgo(age);
  return {
    id: newId(), email, full_name: fullName, role, disabled: false, created_date: at, updated_date: at,
    last_login_at: null, password: null, any_password: true,
  };
}

function addPlaybook(add, { title, chapters, age, ...rest }) {
  const slug = title.toLowerCase().replace(/\W+/g, '-');
  const playbook = add('Playbook', {
    title, file_url: `demo:seed-${slug}`, file_name: `${title.replace(/\s+/g, '_')}.pdf`, file_type: 'pdf', file_size: 1_450_000,
    author: 'Platform Engineering Guild', organization: 'Inspironics', chapter_count: chapters.length,
    toc_summary: chapters.map((c) => `${c.number}. ${c.title}`).join('\n'), source: 'upload', ...rest,
  }, age);
  chapters.forEach((c) => add('Chapter', { playbook_id: playbook.id, ...c }, age));
  add('PlaybookVersion', {
    playbook_id: playbook.id, version_label: rest.version || '1.0', title, author: playbook.author,
    organization: playbook.organization, chapter_count: chapters.length, toc_summary: playbook.toc_summary,
    file_name: playbook.file_name, file_size: playbook.file_size,
    chapters_snapshot: JSON.stringify(chapters.map(({ number, title: t, summary, content }) => ({ number, title: t, summary, content }))),
  }, age);
  return playbook;
}

function addLessonContent(add, lesson, spec, sourcePlaybook, status, age) {
  const source = { source_playbook: sourcePlaybook, source_chapter: spec.source_chapter, source_section: spec.source_section };
  (spec.q || []).forEach(([question_text, options, correct_answer, explanation, difficulty, cognitive_level]) => add('Question', {
    lesson_id: lesson.id, question_text, options, correct_answer, explanation, difficulty, cognitive_level, ...source, status,
  }, age));
  (spec.f || []).forEach(([front, back, difficulty]) => add('Flashcard', {
    lesson_id: lesson.id, front, back, difficulty, ...source, status,
  }, age));
}

function addModules(add, course, modules, sourcePlaybook, defaultStatus, age) {
  const lessons = [];
  modules.forEach((m, mi) => {
    const mod = add('Module', {
      course_id: course.id, title: m.title, description: m.description, order: mi,
      lesson_count: m.lessons.length, source_chapters: m.source_chapters,
    }, age);
    m.lessons.forEach((spec, li) => {
      const { q, f, status, ...fields } = spec;
      const lessonStatus = status || defaultStatus;
      const lesson = add('Lesson', {
        ...fields, module_id: mod.id, order: li, video_title: fields.teaching_script ? fields.title : undefined,
        duration_target: '8-12 minutes', source_playbook: sourcePlaybook, status: lessonStatus,
      }, age);
      lessons.push({ lesson, module: mod });
      addLessonContent(add, lesson, spec, sourcePlaybook, lessonStatus === 'approved' ? 'approved' : 'pending_review', age);
    });
  });
  return lessons;
}

export function buildSeed() {
  const admin = demoUser('admin@demo.local', 'Ada Admin', 'admin', 40);
  const learner = demoUser('learner@demo.local', 'Lee Learner', 'user', 30);
  const tables = Object.fromEntries(ENTITY_NAMES.map((n) => [n, []]));
  const add = (name, data, age, by = admin.id) => {
    const rec = stamp(name, data, by, daysAgo(age));
    tables[name].push(rec);
    return rec;
  };

  // Published: playbook → course → 2 modules × 3 approved lessons, tests published.
  const sre = addPlaybook(add, { title: SRE_PLAYBOOK, chapters: SRE_CHAPTERS, age: 21, version: '2.1', status: 'published', progress: 100 });
  const course = add('Course', {
    playbook_id: sre.id, title: 'Reliability Engineering Foundations', status: 'published', published: true, difficulty: 'intermediate',
    description: 'Measure reliability with SLIs, SLOs and error budgets, respond to incidents calmly, and ship change safely.',
    module_count: RELIABILITY_MODULES.length, lesson_count: 6, version: '1',
  }, 20);
  const lessons = addModules(add, course, RELIABILITY_MODULES, SRE_PLAYBOOK, 'approved', 20);
  tables.Module.filter((m) => m.course_id === course.id).forEach((m, i) => add('Assessment', {
    course_id: course.id, module_id: m.id, playbook_id: sre.id, title: `Module ${i + 1} Test: ${m.title}`,
    type: 'module_test', question_count: 12, passing_score: 70, duration_minutes: 30, status: 'published',
  }, 19));
  add('Assessment', {
    course_id: course.id, playbook_id: sre.id, title: 'Final Assessment: Reliability Engineering Foundations',
    type: 'course_assessment', question_count: 24, passing_score: 70, duration_minutes: 60, status: 'published',
  }, 19);

  // Draft awaiting review in the Content Studio.
  const apiPb = addPlaybook(add, { title: API_PLAYBOOK, chapters: API_CHAPTERS, age: 3, version: '1.0', status: 'needs_review', progress: 100 });
  const draft = add('Course', {
    playbook_id: apiPb.id, title: 'API Design Essentials', status: 'pending_review', published: false, difficulty: 'beginner',
    description: 'Design predictable, evolvable HTTP APIs following the API Design Standards.', module_count: 1, lesson_count: 3, version: '1',
  }, 2);
  addModules(add, draft, [API_DRAFT_MODULE], API_PLAYBOOK, 'pending_review', 2);

  // The learner is a third of the way through the published course.
  add('CourseProgress', {
    user_id: learner.id, course_id: course.id, completed_lessons: lessons.slice(0, 2).map((l) => l.lesson.id), percentage: 33, started: true,
  }, 5, learner.id);

  return { version: 1, users: [admin, learner], tables, sessionUserId: null, logins: [], resets: {} };
}
