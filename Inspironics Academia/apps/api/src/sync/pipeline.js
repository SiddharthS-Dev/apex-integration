import crypto from 'node:crypto';
import {
  SYNC_DEFAULT_CATEGORY, fileExtension, isMeetingFile, isPlaybookFile, meetingFromFileName, teamFromPath,
} from '@academy/shared';
import { config } from '../config.js';
import { withLock } from '../db/locks.js';
import { listFolderRecursive } from '../dropbox/client.js';
import { getSyncSettings, loadConnection, meetingsAccount, sourceAccount, withDropboxAccount } from '../dropbox/connection.js';
import { log } from '../lib/logger.js';
import { mapPool } from '../lib/pool.js';
import { entities } from '../repo/entities.js';
import { closeStaleRuns, finishSyncLog, insertSyncLog } from './log.js';
import { ignoredDropboxIds } from '../pipeline/deletePlaybooks.js';

// Dropbox → Playbook and Meeting synchronization.
//   1. Discovery   list the sync root recursively, keep .pdf/.docx; transcripts in the meetings folder
//                  (when one is set) are Meetings, never playbooks — see syncMeetings below
//   2. Compare     by Dropbox file id (external_id) + rev (revision) — pure, see planSync()
//   3. Process     new/changed files through a bounded pool: cache bytes, optionally extract
//   4. Archive     Dropbox playbooks not seen this run → 'archived' (never deleted), only after a
//                  fully successful discovery
//   5. Bookkeeping one sync_log row per run

export const SYNC_LOCK = 'sync:dropbox';
export const FOLDER_REQUIRED = 'Choose the playbooks folder in Integrations first. The whole Dropbox is never synced.';
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
// The same plan serves meetings: pass accept = isMeetingFile and stored Meeting records.
export function planSync(discovered, stored, { maxBytes = Infinity, accept = isPlaybookFile } = {}) {
  const byId = new Map();
  for (const p of stored) if (p.external_id && !byId.has(p.external_id)) byId.set(p.external_id, p);

  const plan = { add: [], update: [], unchanged: [], resume: [], archive: [], skipped: 0 };
  const seen = new Set();
  for (const file of discovered) {
    if (!file?.id || !accept(file.name)) { plan.skipped++; continue; }
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

async function loadRunner(name) {
  try {
    const mod = await import('../pipeline/index.js');
    return typeof mod[name] === 'function' ? mod[name] : null;
  } catch (err) {
    log.warn('sync.extractor_unavailable', { error: shortError(err) });
    return null;
  }
}

const lower = (p) => String(p || '').toLowerCase().replace(/\/+$/, '');
/** True when a Dropbox path is inside `folder` ('' = no folder, never inside). */
export function inFolder(pathLower, folder) {
  const f = lower(folder);
  return !!f && (pathLower === f || String(pathLower).startsWith(`${f}/`));
}

async function runLocked(trigger, plan) {
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
    const { root_path: root, meetings_path: meetingsPath } = await getSyncSettings();
    // Files an admin deleted and kept out of syncs are invisible to every pass.
    const ignored = await ignoredDropboxIds();
    const seenAt = startedAt.toISOString();

    // Playbooks (when their folder is set and Dropbox is connected).
    let listing = [];
    if (plan.playbooks) {
      // 1. Discovery — any failure here aborts before archiving.
      try {
        listing = (await listFolderRecursive(root)).filter((f) => !ignored.has(f.id));
      } catch (err) {
        errors.push(`Discovery failed: ${shortError(err)}`);
        status = 'failed';
        return { id, status, counts };
      }

      // 2–4. Files in the meetings folder are transcripts, and files in a category source's folder
      // read through this same app belong to that source: neither is a main-folder playbook.
      const settings = await getSyncSettings();
      const sharedSourceFolders = Object.entries(settings.sources)
        .filter(([key, folder]) => folder && folder !== '/' && sourceAccount(key) === 'playbooks')
        .map(([, folder]) => folder);
      const files = listing.filter((f) => !inFolder(f.path_lower, meetingsPath) && !sharedSourceFolders.some((d) => inFolder(f.path_lower, d)));
      const stored = (await entities.Playbook.filter({ source: 'dropbox' }, undefined, 10000)).filter((p) => !p.dropbox_source);
      await syncPlaybookFolder({ files, stored, category: SYNC_DEFAULT_CATEGORY, source: '', seenAt, counts, errors, fail });
    }

    // 4b. Category sources: each category's own Dropbox folder (and app, when it has one).
    for (const key of plan.sources || []) {
      await withDropboxAccount(sourceAccount(key), async () => {
        const folder = (await getSyncSettings()).sources[key];
        let files;
        try {
          files = (await listFolderRecursive(folder === '/' ? '' : folder)).filter((f) => !ignored.has(f.id));
        } catch (err) {
          errors.push(`${key} discovery failed: ${shortError(err)}`);
          return; // nothing is archived on a failed discovery
        }
        const stored = await entities.Playbook.filter({ source: 'dropbox', dropbox_source: key }, undefined, 10000);
        await syncPlaybookFolder({ files, stored, category: key, source: key, seenAt, counts, errors, fail });
      });
    }

    // 5. Meetings — their own discovery (through their own Dropbox app when one is set up).
    if (plan.meetings) await syncMeetings({ root, meetingsPath, listing, seenAt, counts, errors, fail, ignored });

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

// One playbook folder: compare files with the playbooks it owns, refresh unchanged ones, index new
// and changed ones (new ones get `category`; an existing one keeps its category, so a manual choice
// survives), extract them, and archive the ones that are gone. `source` is '' for the main folder or
// the category key of a category source.
export async function syncPlaybookFolder({ files, stored, category, source, seenAt, counts, errors, fail }) {
  const limitMb = config.maxExtractMb;
  const tooLargeMsg = `File exceeds the ${limitMb} MB extraction limit`;
  const plan = planSync(files, stored, { maxBytes: limitMb * 1024 * 1024 });
  counts.discovered += plan.add.length + plan.update.length + plan.unchanged.length + plan.resume.length;
  const width = config.syncConcurrency;

  // Unchanged: only refresh last_seen_at (plus path/name if the file was moved or renamed).
  const touch = await mapPool([...plan.unchanged, ...plan.resume], width, ({ file, playbook }) => {
    const patch = { last_seen_at: seenAt };
    if (playbook.dropbox_path !== file.path_display) Object.assign(patch, { dropbox_path: file.path_display, file_name: file.name });
    return entities.Playbook.update(playbook.id, patch);
  });
  touch.forEach((r, i) => { if (!r.ok) errors.push(`${plan.unchanged.concat(plan.resume)[i].file.name}: ${shortError(r.error)}`); });
  counts.unchanged += plan.unchanged.length + plan.resume.length;

  // Index new and changed files.
  const toProcess = [];
  const index = await mapPool([...plan.add, ...plan.update], width, async ({ file, playbook, tooLarge }) => {
    const fields = { ...fileFields(file), last_seen_at: seenAt, status: tooLarge ? 'failed' : 'uploaded', error: tooLarge ? tooLargeMsg : '', progress: 0 };
    const rec = playbook
      ? await entities.Playbook.update(playbook.id, fields)
      : await entities.Playbook.create({
        title: stripExt(file.name), category, category_source: 'default', dropbox_source: source || undefined, ...fields,
      });
    if (playbook) counts.updated++; else counts.added++;
    if (tooLarge) fail(file.name, tooLargeMsg);
    else toProcess.push(rec);
  });
  index.forEach((r, i) => { if (!r.ok) fail([...plan.add, ...plan.update][i].file.name, r.error); });
  for (const { playbook } of plan.resume) toProcess.push(playbook);

  // Extract (when AUTO_EXTRACT_ON_SYNC is on), never more than `width` at once. The file bytes are
  // fetched by the extraction itself; with extraction off, the sync is metadata-only (nothing is
  // downloaded) and documents are processed on demand.
  const runExtract = toProcess.length && config.autoExtractOnSync ? await loadRunner('runExtract') : null;
  const processed = runExtract ? await mapPool(toProcess, width, (playbook) => runExtract(playbook.id)) : [];
  for (const [i, r] of processed.entries()) {
    if (r.ok) continue;
    const p = toProcess[i];
    fail(p.file_name, r.error);
    await entities.Playbook.update(p.id, { status: 'failed', error: shortError(r.error) }).catch(() => {});
  }

  // Archive — discovery succeeded end-to-end, so absence is real.
  const archived = await mapPool(plan.archive, width, (p) => entities.Playbook.update(p.id, { status: 'archived' }));
  archived.forEach((r, i) => {
    if (r.ok) counts.archived++;
    else errors.push(`Archive ${plan.archive[i].file_name}: ${shortError(r.error)}`);
  });
}

// Transcripts in the meetings folder → Meeting records, processed into meeting notes. Counts add to
// the run's totals. A discovery failure skips the meeting pass (nothing is archived on a guess).
// A meetings app of its own is listed separately; '/' there means the whole app (an App folder app).
function syncMeetings(args) {
  return withDropboxAccount(meetingsAccount(), () => syncMeetingsIn(args));
}

async function syncMeetingsIn({ root, meetingsPath: rawPath, listing, seenAt, counts, errors, fail, ignored }) {
  const separate = meetingsAccount() === 'meetings';
  const meetingsPath = rawPath === '/' ? '' : rawPath;
  let files;
  try {
    files = !separate && inFolder(lower(meetingsPath), root)
      ? listing.filter((f) => inFolder(f.path_lower, meetingsPath))
      : (await listFolderRecursive(meetingsPath)).filter((f) => !ignored.has(f.id));
  } catch (err) {
    errors.push(`Meetings discovery failed: ${shortError(err)}`);
    return;
  }
  const limitMb = config.maxExtractMb;
  const stored = await entities.Meeting.filter({ source: 'dropbox' }, undefined, 10000);
  const plan = planSync(files, stored, { maxBytes: limitMb * 1024 * 1024, accept: isMeetingFile });
  counts.discovered += plan.add.length + plan.update.length + plan.unchanged.length + plan.resume.length;
  const width = config.syncConcurrency;

  // The team is the sub-folder a transcript is filed in; a team an admin set is kept.
  const teamOf = (file) => teamFromPath(file.path_display, meetingsPath);
  await mapPool([...plan.unchanged, ...plan.resume], width, ({ file, playbook: meeting }) => entities.Meeting.update(meeting.id, {
    last_seen_at: seenAt,
    ...(meeting.dropbox_path !== file.path_display ? { dropbox_path: file.path_display, file_name: file.name } : {}),
    ...(!meeting.team && teamOf(file) ? { team: teamOf(file) } : {}),
  }));
  counts.unchanged += plan.unchanged.length + plan.resume.length;

  const toProcess = [...plan.resume.map((r) => r.playbook)];
  const indexed = await mapPool([...plan.add, ...plan.update], width, async ({ file, playbook: meeting, tooLarge }) => {
    const fields = {
      ...fileFields(file),
      last_seen_at: seenAt,
      status: tooLarge ? 'failed' : 'uploaded',
      error: tooLarge ? `File exceeds the ${limitMb} MB extraction limit` : '',
      progress: 0,
    };
    const { title, date } = meetingFromFileName(file.name);
    const rec = meeting
      ? await entities.Meeting.update(meeting.id, { ...fields, ...(!meeting.team && teamOf(file) ? { team: teamOf(file) } : {}) })
      : await entities.Meeting.create({ title, meeting_date: date || undefined, team: teamOf(file) || undefined, ...fields });
    if (meeting) counts.updated++; else counts.added++;
    if (tooLarge) fail(file.name, fields.error);
    else toProcess.push(rec);
  });
  indexed.forEach((r, i) => { if (!r.ok) fail([...plan.add, ...plan.update][i].file.name, r.error); });

  // One at a time: each analysis is a long model call.
  const runMeeting = toProcess.length && config.autoExtractOnSync ? await loadRunner('runMeeting') : null;
  const processed = runMeeting ? await mapPool(toProcess, 1, (meeting) => runMeeting(meeting.id)) : [];
  processed.forEach((r, i) => { if (!r.ok) fail(toProcess[i].file_name, r.error); });

  const archived = await mapPool(plan.archive, width, (m) => entities.Meeting.update(m.id, { status: 'archived' }));
  archived.forEach((r, i) => {
    if (r.ok) counts.archived++;
    else errors.push(`Archive ${plan.archive[i].file_name}: ${shortError(r.error)}`);
  });
}

/**
 * What a sync would do: { playbooks, meetings, connected }. Playbooks need their folder and the
 * playbooks connection; meetings need their folder and the connection they are read through.
 * The whole Dropbox is never synced: it would turn every PDF and Word file in it into a playbook.
 */
export async function syncPlan() {
  const { root_path: root, meetings_path: meetings } = await getSyncSettings();
  const playbooksConnected = !!(await loadConnection());
  const meetingsConnected = !!(await withDropboxAccount(meetingsAccount(), () => loadConnection()));
  // Category sources with a folder chosen and a connected account.
  const { sources: folders } = await getSyncSettings();
  const sources = [];
  for (const [key, folder] of Object.entries(folders)) {
    if (folder && (await withDropboxAccount(sourceAccount(key), () => loadConnection()))) sources.push(key);
  }
  return {
    playbooks: playbooksConnected && !!root,
    meetings: meetingsConnected && !!meetings,
    sources,
    connected: playbooksConnected || meetingsConnected || sources.length > 0,
  };
}

// Runs one synchronization unless another (in this or any instance) is already running.
export async function runSync({ trigger = 'manual' } = {}) {
  const plan = await syncPlan();
  if (!plan.connected) return { started: false, reason: 'Dropbox is not connected' };
  if (!plan.playbooks && !plan.meetings && !plan.sources.length) return { started: false, reason: FOLDER_REQUIRED };
  const { acquired, result } = await withLock(SYNC_LOCK, () => runLocked(trigger, plan), { ttlMs: 6 * 3600 * 1000 });
  if (!acquired) return { started: false, reason: ALREADY_RUNNING };
  return { started: true, ...result };
}
