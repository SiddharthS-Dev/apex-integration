import { ENTITY_NAMES, addDays, buildNotification, sm2 } from '@academy/shared';
import { newId, stamp } from '@/api/drivers/demo/records';
import { API_CHAPTERS, SRE_CHAPTERS } from '@/api/drivers/demo/seedChapters';
import { API_DRAFT_MODULE, RELIABILITY_MODULES } from '@/api/drivers/demo/seedLessons';
import { addMeetings } from '@/api/drivers/demo/seedMeetings';

// Builds the initial demo academy: two users, a published course and a draft awaiting review.

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
// The visitor's own calendar day, like the review queue the pages request.
const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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

  addRetentionData(add, { learner, sre, course, lessons, tables });

  // Meeting notes: one published review with action items for Lee, one stand-up awaiting review.
  const { meeting, sources } = addMeetings(add, { admin, learner, today: localDay() });
  tables._MeetingSource = sources;
  const mine = tables.ActionItem.filter((a) => a.owner_user_id === learner.id);
  add('Notification', {
    user_id: learner.id,
    ...buildNotification('meeting_published', {
      meeting_id: meeting.id, meeting_title: meeting.title, meeting_date: meeting.meeting_date,
      action_count: meeting.action_item_count, decision_count: meeting.decisions.length,
    }),
    read: false, dedupe_key: `meeting_published:${meeting.id}:${learner.id}`,
  }, 5);
  const overdue = mine.find((a) => a.status !== 'done' && a.due_date < localDay());
  if (overdue) {
    add('Notification', {
      user_id: learner.id,
      ...buildNotification('action_item_overdue', { task: overdue.task, meeting_title: meeting.title, due_date: overdue.due_date, meeting_id: meeting.id }),
      read: false, dedupe_key: `action_item_overdue:${overdue.id}`,
    }, 0);
  }

  return { version: 4, users: [admin, learner], tables, sessionUserId: null, logins: [], resets: {} };
}

// Flashcard review history for the learner's two completed lessons (a few cards due today, a two-week
// review log), plus a recertification: Lee was certified on the playbook's previous course, and the
// playbook's Incident Response chapter has since been rewritten.
function addRetentionData(add, { learner, sre, course, lessons, tables }) {
  const today = localDay();
  const cards = tables.Flashcard.filter((f) => lessons.slice(0, 2).some((l) => l.lesson.id === f.lesson_id));
  cards.forEach((card, i) => {
    const lastReviewed = addDays(today, -(i % 4) - 1);
    const qualities = [4, 5, 3, 4, 1, 4, 5];
    const schedule = sm2(sm2({}, 4, addDays(lastReviewed, -6)), qualities[i % qualities.length], lastReviewed);
    // Every third card is due now so the Daily Review has work on first open.
    const due = i % 3 === 0 ? addDays(today, -(i % 2)) : schedule.due_date;
    add('ReviewSchedule', {
      user_id: learner.id, flashcard_id: card.id, lesson_id: card.lesson_id, course_id: course.id, ...schedule, due_date: due,
    }, 5, learner.id);
  });
  for (let d = 13; d >= 1; d -= 1) {
    if (d % 5 === 0) continue; // a couple of missed days
    const card = cards[d % cards.length];
    if (!card) break;
    [d % 4 === 0 ? 2 : 4, 5, 3].slice(0, 1 + (d % 3)).forEach((quality, k) => add('ReviewLog', {
      user_id: learner.id, flashcard_id: cards[(d + k) % cards.length].id, lesson_id: card.lesson_id, course_id: course.id,
      quality, first_review: d >= 12, previous_interval: 1, interval_days: quality >= 3 ? 6 : 1, reviewed_date: addDays(today, -d),
    }, d, learner.id));
  }

  const oldCourse = add('Course', {
    playbook_id: sre.id, title: 'Reliability Engineering Foundations', status: 'archived', published: false, difficulty: 'intermediate',
    description: 'Previous edition of the course.', module_count: 0, lesson_count: 0, version: '0',
  }, 90);
  const cert = add('Certificate', {
    user_id: learner.id, course_id: oldCourse.id, course_title: oldCourse.title, user_name: learner.full_name, score: 86,
    completion_date: addDays(today, -60), certificate_id: 'IEA-DEMO2026-LEE001', playbook_id: sre.id, playbook_version: '2.0',
    status: 'recert_required',
  }, 60, learner.id);
  const dueDate = addDays(today, 12);
  add('Recertification', {
    user_id: learner.id, user_name: learner.full_name, playbook_id: sre.id, playbook_title: sre.title,
    certificate_id: cert.certificate_id, old_course_id: oldCourse.id, new_course_id: course.id, reason: 'playbook_changed',
    from_version: '2.0', to_version: '2.1', changed_chapters: ['Incident Response'], removed_chapters: [],
    status: 'pending', due_date: dueDate,
  }, 18);
  [
    ['recert_required', { playbook_title: sre.title, reason: 'playbook_changed', due_date: dueDate, changed_count: 1 }, 18],
    ['review_due', { count: tables.ReviewSchedule.filter((r) => r.due_date <= today).length }, 0],
  ].forEach(([kind, data, age]) => add('Notification', {
    user_id: learner.id, ...buildNotification(kind, data), read: false, dedupe_key: `seed:${kind}`,
  }, age));
}
