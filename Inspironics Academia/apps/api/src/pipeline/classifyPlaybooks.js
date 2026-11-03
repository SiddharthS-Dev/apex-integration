import { SKILL_LEVELS, UNCLASSIFIED } from '@academy/shared';
import { badRequest } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { entities } from '../repo/entities.js';

// Playbook classification: one primary category (never duplicated across categories) plus
// department, technology tags, skill level and secondary tags. An admin's choice is recorded as
// category_source 'manual', which the Dropbox sync never overrides. A playbook's courses carry its
// category, so who may see the course follows the playbook.
//
// classifyPlaybooks payload: { playbook_ids, category?, department?, tech_tags?, skill_level?, tags? }
// Returns: { ok, updated }

const MAX = 5000;
const cleanList = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 30) : undefined);

/** Throws unless `key` is a category that exists (or 'unclassified'). */
export async function assertCategory(key) {
  if (key === UNCLASSIFIED) return;
  if (!key || !(await entities.PlaybookCategory.findOne({ key: String(key) }))) throw badRequest(`Unknown category "${key}"`);
}

/** The classification fields of `body`, validated; only the ones present. */
export async function classificationPatch(body = {}) {
  const patch = {};
  if (body.category !== undefined) {
    await assertCategory(body.category);
    patch.category = String(body.category);
  }
  if (body.department !== undefined) patch.department = String(body.department ?? '').trim().slice(0, 80);
  if (body.skill_level !== undefined) {
    const level = String(body.skill_level ?? '');
    if (level && !SKILL_LEVELS.includes(level)) throw badRequest(`skill_level must be one of: ${SKILL_LEVELS.join(', ')}`);
    patch.skill_level = level;
  }
  if (body.tech_tags !== undefined) patch.tech_tags = cleanList(body.tech_tags) || [];
  if (body.tags !== undefined) patch.tags = cleanList(body.tags) || [];
  return patch;
}

/** Copies a playbook's category to its courses (every version, archived included). */
export async function propagateCategory(playbookId, category) {
  const courses = await entities.Course.filter({ playbook_id: playbookId }, null, 1000);
  await Promise.all(courses.filter((c) => c.category !== category).map((c) => entities.Course.update(c.id, { category })));
  return courses.length;
}

export default async function classifyPlaybooks(payload = {}, ctx = {}) {
  const ids = Array.isArray(payload.playbook_ids) ? [...new Set(payload.playbook_ids.map(String))] : [];
  if (!ids.length) throw badRequest('playbook_ids is required');
  if (ids.length > MAX) throw badRequest(`At most ${MAX} playbooks at a time`);
  const patch = await classificationPatch(payload);
  if (!Object.keys(patch).length) throw badRequest('Nothing to change: give a category, department, tech_tags, skill_level or tags');
  if (patch.category !== undefined) patch.category_source = 'manual';

  let updated = 0;
  for (const id of ids) {
    const playbook = await entities.Playbook.get(id);
    if (!playbook) continue;
    await entities.Playbook.update(id, patch);
    if (patch.category !== undefined && patch.category !== playbook.category) await propagateCategory(id, patch.category);
    updated += 1;
  }
  log.info('playbooks.classified', { by: ctx.user?.id, updated, category: patch.category });
  return { ok: true, updated };
}
