import { badRequest } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { getSetting, setSetting } from '../repo/settings.js';

// deletePlaybooks — removes playbooks and everything generated from them: chapters, version
// snapshots, and their courses with modules, lessons, questions, flashcards and assessments.
// Learner records (progress, quiz attempts, certificates, review schedules) are kept: they are the
// learners' history, and certificates carry their own course title.
//
// A Dropbox playbook would come back on the next sync; keep_out_of_sync remembers its Dropbox file id
// so the sync skips it from then on. The file in Dropbox is never touched.
//
// Payload: { playbook_ids: [...] } or { all: true }, plus keep_out_of_sync (default true)
// Returns: { ok, deleted, kept_out_of_sync }

export const IGNORED_KEY = 'dropbox.ignored_ids';
const MAX = 10_000;
const BATCH = 500;

/** Dropbox file ids an admin deleted and asked to keep out of syncs. */
export async function ignoredDropboxIds() {
  return new Set(await getSetting(IGNORED_KEY, []));
}

/** Lets every kept-out file sync again. Returns how many there were. */
export async function clearIgnoredDropboxIds() {
  const n = (await ignoredDropboxIds()).size;
  await setSetting(IGNORED_KEY, []);
  return n;
}

export async function ignoreDropboxIds(ids) {
  if (!ids.length) return;
  const current = await ignoredDropboxIds();
  for (const id of ids) current.add(id);
  await setSetting(IGNORED_KEY, [...current]);
}

const chunks = (list) => Array.from({ length: Math.ceil(list.length / BATCH) }, (_, i) => list.slice(i * BATCH, (i + 1) * BATCH));
const removeIn = async (entity, field, ids) => {
  for (const part of chunks(ids)) if (part.length) await entities[entity].deleteMany({ [field]: { $in: part } });
};
const idsOf = async (entity, field, ids) => {
  const out = [];
  for (const part of chunks(ids)) out.push(...(await entities[entity].filter({ [field]: { $in: part } }, null, 100_000)).map((r) => r.id));
  return out;
};

/** Deletes the playbooks with these ids and their generated content. Returns the playbooks deleted. */
export async function removePlaybooks(ids) {
  const playbooks = [];
  for (const part of chunks(ids)) playbooks.push(...(await entities.Playbook.filter({ id: { $in: part } }, null, MAX)));
  const pbIds = playbooks.map((p) => p.id);
  if (!pbIds.length) return [];

  const courseIds = await idsOf('Course', 'playbook_id', pbIds);
  const moduleIds = await idsOf('Module', 'course_id', courseIds);
  const lessonIds = await idsOf('Lesson', 'module_id', moduleIds);
  const assessmentIds = await idsOf('Assessment', 'course_id', courseIds);

  await removeIn('Question', 'lesson_id', lessonIds);
  await removeIn('Question', 'assessment_id', assessmentIds);
  await removeIn('Flashcard', 'lesson_id', lessonIds);
  await removeIn('Lesson', 'id', lessonIds);
  await removeIn('Assessment', 'id', assessmentIds);
  await removeIn('Module', 'id', moduleIds);
  await removeIn('Course', 'id', courseIds);
  await removeIn('Chapter', 'playbook_id', pbIds);
  await removeIn('PlaybookVersion', 'playbook_id', pbIds);
  await removeIn('Playbook', 'id', pbIds);
  return playbooks;
}

export default async function deletePlaybooks(payload = {}, ctx = {}) {
  const all = payload.all === true;
  const requested = Array.isArray(payload.playbook_ids) ? [...new Set(payload.playbook_ids.map(String))] : [];
  if (!all && !requested.length) throw badRequest('playbook_ids (or all: true) is required');
  if (requested.length > MAX) throw badRequest(`At most ${MAX} playbooks at a time`);
  const keepOut = payload.keep_out_of_sync !== false;

  const ids = all ? (await entities.Playbook.list(null, MAX)).map((p) => p.id) : requested;
  const removed = await removePlaybooks(ids);
  const dropboxIds = removed.filter((p) => p.source === 'dropbox' && p.external_id).map((p) => p.external_id);
  if (keepOut) await ignoreDropboxIds(dropboxIds);

  log.info('playbooks.deleted', { by: ctx.user?.id, deleted: removed.length, kept_out_of_sync: keepOut ? dropboxIds.length : 0 });
  return { ok: true, deleted: removed.length, kept_out_of_sync: keepOut ? dropboxIds.length : 0 };
}
