import crypto from 'node:crypto';
import { fileExtension, isPlaybookFile } from '@academy/shared';
import { config } from '../config.js';
import { withLock } from '../db/locks.js';
import { listFolderRecursive } from '../dropbox/client.js';
import { getSyncSettings, loadConnection } from '../dropbox/connection.js';
import { loadPlaybookBytes } from '../files/playbookSource.js';
import { log } from '../lib/logger.js';
import { mapPool } from '../lib/pool.js';
import { entities } from '../repo/entities.js';
import { closeStaleRuns, finishSyncLog, insertSyncLog } from './log.js';

// Dropbox → Playbook synchronization.
//   1. Discovery   list the sync root recursively, keep .pdf/.docx
//   2. Compare     by Dropbox file id (external_id) + rev (revision) — pure, see planSync()
//   3. Process     new/changed files through a bounded pool: cache bytes, optionally extract
//   4. Archive     Dropbox playbooks not seen this run → 'archived' (never deleted), only after a
//                  fully successful discovery
//   5. Bookkeeping one sync_log row per run

export const SYNC_LOCK = 'sync:dropbox';
export const ALREADY_RUNNING = 'A synchronization is already running';

const stripExt = (name) => String(name).replace(/\.[^.]+$/, '');
const shortError = (err) => String(err?.message || err).replace(/\s+/g, ' ').slice(0, 200);

// Pure compare step.
//   discovered: Dropbox file entries ({ id, name, path_display, rev, size, content_hash })
//   stored:     existing Playbook records with source 'dropbox'
// Returns { add, update, unchanged, resume, archive, skipped } where
//   add/update entries are { file, playbook?, tooLarge },
//   unchanged/resume are { file, playbook } (resume = same rev but never processed),
//   archive is a list of playbooks, skipped counts non-playbook files.
export function planSync(discovered, stored, { maxBytes = Infinity } = {}) {
  const byId = new Map();
  for (const p of stored) if (p.external_id && !byId.has(p.external_id)) byId.set(p.external_id, p);

  const plan = { add: [], update: [], unchanged: [], resume: [], archive: [], skipped: 0 };
  const seen = new Set();
  for (const file of discovered) {
    if (!file?.id || !isPlaybookFile(file.name)) { plan.skipped++; continue; }
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    const tooLarge = Number(file.size || 0) > maxBytes;
    const playbook = byId.get(file.id);
    if (!playbook) plan.add.push({ file, tooLarge });
    else if (playbook.revision !== file.rev || playbook.status === 'archived') plan.update.push({ file, playbook, tooLarge });
    else if (playbook.status === 'uploaded' && !tooLarge) plan.resume.push({ file, playbook });
    else plan.unchanged.push({ file, playbook });
  }
  for (const p of stored) {
    if (p.source === 'dropbox' && p.status !== 'archived' && !seen.has(p.external_id)) plan.archive.push(p);
  }
  return plan;
}

function fileFields(file) {
  return {
    file_name: file.name,
    file_type: fileExtension(file.name),
    file_size: Number(file.size || 0),
    file_url: `dropbox:${file.id}`,
    source: 'dropbox',
    external_id: file.id,
    revision: file.rev,
    dropbox_path: file.path_display,
    content_hash: file.content_hash || undefined,
  };
}

async function loadExtractor() {
  try {
    const mod = await import('../pipeline/index.js');
    return typeof mod.runExtract === 'function' ? mod.runExtract : null;
  } catch (err) {
    log.warn('sync.extractor_unavailable', { error: shortError(err) });
    return null;
  }
}

async function runLocked(trigger) {
  const id = crypto.randomUUID();
  const startedAt = new Date();
  const counts = { discovered: 0, added: 0, updated: 0, unchanged: 0, archived: 0, failed: 0 };
  const errors = [];
  const fail = (what, err) => {
    counts.failed++;
    errors.push(`${what}: ${shortError(err)}`);
  };
  let status = 'success';

  await closeStaleRuns();
  await insertSyncLog({ id, trigger, startedAt: startedAt.toISOString() });
  log.info('sync.started', { id, trigger });

  try {
    const { root_path: root } = await getSyncSettings();
    const seenAt = startedAt.toISOString();
    const limitMb = config.maxExtractMb;
    const tooLargeMsg = `File exceeds the ${limitMb} MB extraction limit`;

    // 1. Discovery — any failure here aborts before archiving.
    let listing;
    try {
      listing = await listFolderRecursive(root);
    } catch (err) {
      errors.push(`Discovery failed: ${shortError(err)}`);
      status = 'failed';
      return { id, status, counts };
    }

    // 2. Compare.
    const stored = await entities.Playbook.filter({ source: 'dropbox' }, undefined, 10000);
    const plan = planSync(listing, stored, { maxBytes: limitMb * 1024 * 1024 });
    counts.discovered = plan.add.length + plan.update.length + plan.unchanged.length + plan.resume.length;
    const width = config.syncConcurrency;

    // Unchanged: only refresh last_seen_at (plus path/name if the file was moved or renamed).
    const touch = await mapPool([...plan.unchanged, ...plan.resume], width, ({ file, playbook }) => {
      const patch = { last_seen_at: seenAt };
      if (playbook.dropbox_path !== file.path_display) Object.assign(patch, { dropbox_path: file.path_display, file_name: file.name });
      return entities.Playbook.update(playbook.id, patch);
    });
    touch.forEach((r, i) => { if (!r.ok) errors.push(`${plan.unchanged.concat(plan.resume)[i].file.name}: ${shortError(r.error)}`); });
    counts.unchanged = plan.unchanged.length + plan.resume.length;

    // Index new and changed files.
    const toProcess = [];
    const index = await mapPool([...plan.add, ...plan.update], width, async ({ file, playbook, tooLarge }) => {
      const fields = { ...fileFields(file), last_seen_at: seenAt, status: tooLarge ? 'failed' : 'uploaded', error: tooLarge ? tooLargeMsg : '', progress: 0 };
      const rec = playbook
        ? await entities.Playbook.update(playbook.id, fields)
        : await entities.Playbook.create({ title: stripExt(file.name), ...fields });
      if (playbook) counts.updated++; else counts.added++;
      if (tooLarge) fail(file.name, tooLargeMsg);
      else toProcess.push(rec);
    });
    index.forEach((r, i) => { if (!r.ok) fail([...plan.add, ...plan.update][i].file.name, r.error); });
    for (const { playbook } of plan.resume) toProcess.push(playbook);

    // 3. Process: cache bytes (keyed by file id + rev) and extract, never more than `width` at once.
    const runExtract = toProcess.length && config.autoExtractOnSync ? await loadExtractor() : null;
    const processed = await mapPool(toProcess, width, async (playbook) => {
      await loadPlaybookBytes(playbook);
      if (runExtract) await runExtract(playbook.id);
    });
    for (const [i, r] of processed.entries()) {
      if (r.ok) continue;
      const p = toProcess[i];
      fail(p.file_name, r.error);
      await entities.Playbook.update(p.id, { status: 'failed', error: shortError(r.error) }).catch(() => {});
    }

    // 4. Archive — discovery succeeded end-to-end, so absence is real.
    const archived = await mapPool(plan.archive, width, (p) => entities.Playbook.update(p.id, { status: 'archived' }));
    archived.forEach((r, i) => {
      if (r.ok) counts.archived++;
      else errors.push(`Archive ${plan.archive[i].file_name}: ${shortError(r.error)}`);
    });

    status = counts.failed > 0 || errors.length > 0 ? 'partial' : 'success';
    return { id, status, counts };
  } catch (err) {
    status = 'failed';
    errors.push(shortError(err));
    return { id, status, counts };
  } finally {
    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;
    await finishSyncLog(id, { status, counts, errors, finishedAt: finishedAt.toISOString(), durationMs })
      .catch((err) => log.error('sync.log_write_failed', { id, error: shortError(err) }));
    log.info('sync.finished', { id, trigger, status, duration_ms: durationMs, ...counts });
  }
}

// Runs one synchronization unless another (in this or any instance) is already running.
export async function runSync({ trigger = 'manual' } = {}) {
  if (!(await loadConnection())) return { started: false, reason: 'Dropbox is not connected' };
  const { acquired, result } = await withLock(SYNC_LOCK, () => runLocked(trigger), { ttlMs: 6 * 3600 * 1000 });
  if (!acquired) return { started: false, reason: ALREADY_RUNNING };
  return { started: true, ...result };
}
