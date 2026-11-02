// Spaced-repetition flashcard review (SM-2), shared by the API and the demo driver so both schedule
// cards, build the daily queue and compute review statistics identically.
//
// Cards enter a learner's queue once they complete the card's lesson: unseen cards arrive as "new"
// (capped per day), reviewed cards come back when their SM-2 due date arrives. Every review is kept
// as a ReviewLog row, which is what retention, streak and forecast figures are computed from.
//
// `store` is the caller's service-role data access:
//   filter(entity, query, sort, limit) · get(entity, id) · create(entity, data, userId) · update(entity, id, patch)
// Each may return a value or a promise.

export const NEW_CARDS_PER_DAY = 20;
export const MATURE_INTERVAL_DAYS = 21;
export const FORECAST_DAYS = 7;
export const REVIEW_RATINGS = Object.freeze([
  { key: 'again', label: 'Again', quality: 1 },
  { key: 'hard', label: 'Hard', quality: 3 },
  { key: 'good', label: 'Good', quality: 4 },
  { key: 'easy', label: 'Easy', quality: 5 },
]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const utcToday = () => new Date().toISOString().slice(0, 10);

/** `day` (YYYY-MM-DD) shifted by `n` days. */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The learner's own calendar day, as sent by the browser, so "due today" follows their midnight.
 * Anything malformed or more than a day away from the server's UTC date falls back to UTC.
 */
export function resolveToday(requested) {
  const utc = utcToday();
  if (typeof requested !== 'string' || !DAY_RE.test(requested)) return utc;
  return requested >= addDays(utc, -1) && requested <= addDays(utc, 1) ? requested : utc;
}

/** SM-2. quality 0–5 (3+ = remembered). Returns the ReviewSchedule fields to store. */
export function sm2(schedule = {}, quality, today = utcToday()) {
  const q = Math.max(0, Math.min(5, Math.round(Number(quality) || 0)));
  let ease = schedule?.ease_factor ?? 2.5;
  let reps = schedule?.reps ?? 0;
  let interval = schedule?.interval_days ?? 0;
  let lapses = schedule?.lapses ?? 0;
  if (q < 3) {
    if (reps > 0) lapses += 1;
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(interval * ease));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return {
    ease_factor: Number(ease.toFixed(2)),
    reps,
    interval_days: interval,
    lapses,
    last_quality: q,
    due_date: addDays(today, interval),
    last_reviewed: today,
  };
}

/** Days until the card is next due for each rating — shown on the rating buttons. */
export function previewIntervals(schedule) {
  return Object.fromEntries(REVIEW_RATINGS.map((r) => [r.key, sm2(schedule || {}, r.quality).interval_days]));
}

const isApproved = (card) => card?.status === 'approved';

/**
 * Review statistics from a learner's schedules and recent logs.
 * retention_30d: share of reviews of already-seen cards in the last 30 days recalled (quality ≥ 3).
 */
export function reviewStats({ schedules = [], logs = [], today = utcToday() }) {
  const due = schedules.filter((s) => s.due_date && s.due_date <= today);
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = addDays(today, i);
    const count = schedules.filter((s) => s.due_date && (i === 0 ? s.due_date <= date : s.due_date === date)).length;
    return { date, count };
  });

  const since = addDays(today, -29);
  const recent = logs.filter((l) => l.reviewed_date && l.reviewed_date >= since && !l.first_review);
  const recalled = recent.filter((l) => Number(l.quality) >= 3).length;

  const days = new Set(logs.map((l) => l.reviewed_date).filter(Boolean));
  let streak = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak += 1;

  return {
    due_today: due.length,
    overdue: due.filter((s) => s.due_date < today).length,
    reviewed_today: logs.filter((l) => l.reviewed_date === today).length,
    learned: schedules.length,
    mature: schedules.filter((s) => (s.interval_days || 0) >= MATURE_INTERVAL_DAYS).length,
    lapses: schedules.reduce((n, s) => n + (s.lapses || 0), 0),
    retention_30d: recent.length ? Math.round((recalled / recent.length) * 100) : null,
    reviews_30d: logs.filter((l) => l.reviewed_date && l.reviewed_date >= since).length,
    streak,
    forecast,
  };
}

async function loadLogs(store, userId, today) {
  return store.filter('ReviewLog', { user_id: userId, reviewed_date: { $gte: addDays(today, -60) } }, '-created_date', 5000);
}

/**
 * Today's queue: { today, due, new, stats }. `due` is every scheduled card due today or earlier
 * (most overdue first); `new` is unseen cards from completed lessons, up to what is left of today's
 * new-card allowance. Each item is the flashcard plus { schedule, course_id, course_title, lesson_title, intervals }.
 */
export async function loadReviewQueue(store, user, { today = utcToday(), newLimit = NEW_CARDS_PER_DAY } = {}) {
  const [progress, schedules, logs] = await Promise.all([
    store.filter('CourseProgress', { user_id: user.id }, '-updated_date', 500),
    store.filter('ReviewSchedule', { user_id: user.id }, 'due_date', 10000),
    loadLogs(store, user.id, today),
  ]);

  const lessonCourse = new Map();
  for (const p of progress) for (const id of p.completed_lessons || []) if (!lessonCourse.has(id)) lessonCourse.set(id, p.course_id);
  const lessonIds = [...new Set([...lessonCourse.keys(), ...schedules.map((s) => s.lesson_id).filter(Boolean)])];
  const cards = lessonIds.length
    ? (await store.filter('Flashcard', { lesson_id: { $in: lessonIds } }, 'created_date', 10000)).filter(isApproved)
    : [];
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Schedules of cards that were since rejected or deleted don't count anywhere.
  const live = schedules.filter((s) => cardById.has(s.flashcard_id));
  const scheduled = new Set(live.map((s) => s.flashcard_id));
  const dueSchedules = live.filter((s) => s.due_date && s.due_date <= today);

  const introducedToday = logs.filter((l) => l.reviewed_date === today && l.first_review).length;
  const allowance = Math.max(0, newLimit - introducedToday);
  const unseen = cards.filter((c) => !scheduled.has(c.id) && lessonCourse.has(c.lesson_id));

  const courseIds = [...new Set([...lessonCourse.values(), ...live.map((s) => s.course_id)].filter(Boolean))];
  const [courses, lessons] = await Promise.all([
    courseIds.length ? store.filter('Course', { id: { $in: courseIds } }, null, 1000) : [],
    lessonIds.length ? store.filter('Lesson', { id: { $in: lessonIds } }, null, 10000) : [],
  ]);
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
  const lessonTitle = new Map(lessons.map((l) => [l.id, l.title]));

  const item = (card, schedule) => {
    const courseId = schedule?.course_id || lessonCourse.get(card.lesson_id) || '';
    return {
      ...card,
      schedule: schedule || null,
      course_id: courseId,
      course_title: courseTitle.get(courseId) || '',
      lesson_title: lessonTitle.get(card.lesson_id) || '',
      intervals: previewIntervals(schedule),
    };
  };

  return {
    today,
    due: dueSchedules.map((s) => item(cardById.get(s.flashcard_id), s)),
    new: unseen.slice(0, allowance).map((c) => item(c, null)),
    new_available: unseen.length,
    new_allowance: allowance,
    stats: { ...reviewStats({ schedules: live, logs, today }), new_available: unseen.length },
  };
}

async function courseOfLesson(store, lessonId) {
  const lesson = lessonId ? await store.get('Lesson', lessonId) : null;
  const mod = lesson?.module_id ? await store.get('Module', lesson.module_id) : null;
  return mod?.course_id || '';
}

/**
 * Records one review: reschedules the card with SM-2 and logs it.
 * Returns { schedule, log, intervals } — `intervals` previews the card's next ratings.
 */
export async function recordReview(store, user, { flashcard_id: flashcardId, quality, today = utcToday() }) {
  const card = flashcardId ? await store.get('Flashcard', String(flashcardId)) : null;
  if (!isApproved(card)) return null;
  const q = Number(quality);
  if (!Number.isInteger(q) || q < 0 || q > 5) throw new RangeError('quality must be an integer from 0 to 5');

  const [existing] = await store.filter('ReviewSchedule', { user_id: user.id, flashcard_id: card.id }, '-updated_date', 1);
  const next = sm2(existing, q, today);
  const courseId = existing?.course_id || (await courseOfLesson(store, card.lesson_id));
  const schedule = existing
    ? await store.update('ReviewSchedule', existing.id, next)
    : await store.create('ReviewSchedule', {
      user_id: user.id, flashcard_id: card.id, lesson_id: card.lesson_id, course_id: courseId, ...next,
    }, user.id);
  const log = await store.create('ReviewLog', {
    user_id: user.id,
    flashcard_id: card.id,
    lesson_id: card.lesson_id,
    course_id: courseId,
    quality: q,
    first_review: !existing,
    previous_interval: existing?.interval_days || 0,
    interval_days: next.interval_days,
    reviewed_date: today,
  }, user.id);
  return { schedule, log, intervals: previewIntervals(schedule) };
}

/** Learners with cards due today: [{ user_id, count }] — for the daily reminder. */
export async function dueReviewCounts(store, today = utcToday()) {
  const due = (await store.filter('ReviewSchedule', { due_date: { $lte: today } }, null, 100000)).filter((s) => s.due_date);
  const cardIds = [...new Set(due.map((s) => s.flashcard_id))];
  const live = new Set(cardIds.length
    ? (await store.filter('Flashcard', { id: { $in: cardIds } }, null, 100000)).filter(isApproved).map((c) => c.id)
    : []);
  const counts = new Map();
  for (const s of due) if (live.has(s.flashcard_id)) counts.set(s.user_id, (counts.get(s.user_id) || 0) + 1);
  return [...counts].map(([user_id, count]) => ({ user_id, count }));
}
