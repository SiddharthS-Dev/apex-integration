import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { deleteObject } from '../files/objectStore.js';
import { dropboxSourceKey, parseFileRef } from '../files/playbookSource.js';
import { cleanupAbandonedTemp, inspectTempStorage } from '../files/tempStore.js';
import { log } from '../lib/logger.js';

// What APEX (Academia) stores on its own disk, measured from the object store itself, and a safe
// clean-up. Dropbox is never touched: originals stay there. Clean-up removes only data that can be
// fetched or generated again and that no record uses:
//   dropbox-orphan   copies of Dropbox files whose playbook/meeting is gone, or an older revision
//   dropbox-cache    copies of current revisions, when DROPBOX_SOURCE_CACHE=temporary (fetched again on demand)
//   ai-cache / tts-cache / scene-cache / extract-cache   older than their retention period
//   temp             abandoned temporary processing directories
// Never removed: uploaded originals (the only copy), generated media a record references (lesson and
// meeting narration, rendered videos, subtitles, thumbnails), the database.

const DAY = 86_400_000;
const mediaKey = (u) => { const m = /\/api\/media\/([a-f0-9]{64})/.exec(String(u || '')); return m && m[1]; };
const parse = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

async function listObjects() {
  const root = config.objectDir;
  const out = [];
  for (const shard of await fsp.readdir(root).catch(() => [])) {
    const dir = path.join(root, shard);
    let files;
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (f.endsWith('.json')) continue;
      const p = path.join(dir, f);
      const st = await fsp.stat(p).catch(() => null);
      if (!st?.isFile()) continue;
      if (f.includes('.tmp')) { out.push({ key: f, size: st.size, mtime: st.mtimeMs, meta: { source: 'tmp' }, file: p }); continue; }
      let meta = {};
      try { meta = JSON.parse(await fsp.readFile(`${p}.json`, 'utf8')); } catch { /* no sidecar */ }
      out.push({ key: f, size: st.size, mtime: st.mtimeMs, meta, file: p });
    }
  }
  return out;
}

/** Keys the database still uses, and the source copies that are current. */
async function references() {
  const used = new Set();
  const currentSource = new Set();
  const trackedFiles = new Set();
  const addRecordSource = (r) => {
    const ref = parseFileRef(r.file_url || '');
    if (ref.kind === 'upload') used.add(ref.id);
    if (ref.kind === 'dropbox' && r.status !== 'archived') {
      trackedFiles.add(ref.id);
      currentSource.add(dropboxSourceKey(ref.id, r.revision || ''));
    }
  };
  const rows = (sql) => db().query(sql).catch(() => []);
  for (const p of await rows('SELECT file_url, revision, status FROM e_playbook')) addRecordSource(p);
  for (const m of await rows('SELECT * FROM e_meeting')) {
    addRecordSource(m);
    for (const f of ['briefing_audio_url', 'briefing_video_url', 'briefing_thumbnail_url', 'briefing_subtitles_url', 'briefing_srt_url']) { const k = mediaKey(m[f]); if (k) used.add(k); }
  }
  for (const l of await rows('SELECT * FROM e_lesson')) {
    for (const f of ['audio_url', 'video_url', 'rendered_video_url', 'rendered_thumbnail_url', 'rendered_subtitles_url', 'rendered_srt_url']) { const k = mediaKey(l[f]); if (k) used.add(k); }
    for (const s of parse(l.video_scenes)) { const k = mediaKey(s.video_url); if (k) used.add(k); }
  }
  for (const p of await rows('SELECT * FROM e_video_project')) {
    for (const f of ['video_url', 'thumbnail_url', 'subtitles_url', 'srt_url']) { const k = mediaKey(p[f]); if (k) used.add(k); }
    for (const s of parse(p.scenes)) if (s.image_key) used.add(s.image_key);
  }
  return { used, currentSource, trackedFiles };
}

function classify(o, refs) {
  const s = o.meta.source;
  if (s === 'tmp') return 'leftover-tmp';
  if (s === 'dropbox') return refs.currentSource.has(o.key) ? 'dropbox-current' : 'dropbox-orphan';
  if (s === 'upload') return refs.used.has(o.key) ? 'upload' : 'upload-unreferenced';
  if (s === 'ai-cache') return 'ai-cache';
  if (s === 'extract-cache') return 'extract-cache';
  if (s === 'render-scene') return 'scene-cache';
  if (s === 'studio-image') return refs.used.has(o.key) ? 'studio-image' : 'studio-image-unused';
  if (s === 'media') {
    const kind = o.meta.kind || '';
    const used = refs.used.has(o.key);
    if (kind === 'video' || o.meta.content_type === 'video/mp4') return used ? 'video' : 'video-superseded';
    if (kind === 'thumbnail') return used ? 'thumbnail' : 'thumbnail-superseded';
    if (kind === 'srt' || kind === 'vtt') return used ? 'subtitles' : 'subtitles-superseded';
    if (kind === 'audio') return used ? 'audio' : o.meta.provider ? 'tts-cache' : 'audio-superseded';
    return used ? 'media-other' : 'media-other-unreferenced';
  }
  return 'other';
}

export const CATEGORY_LABELS = {
  'dropbox-current': 'Copies of current Dropbox files',
  'dropbox-orphan': 'Copies of Dropbox files no longer tracked (or old revisions)',
  upload: 'Uploaded originals (only copy)',
  'upload-unreferenced': 'Uploaded originals of deleted records',
  audio: 'Narration in use (lessons, briefings)',
  'audio-superseded': 'Old narration no longer used',
  'tts-cache': 'Voice-over cache (per text and voice)',
  video: 'Rendered videos in use',
  'video-superseded': 'Older rendered videos',
  thumbnail: 'Thumbnails in use',
  'thumbnail-superseded': 'Older thumbnails',
  subtitles: 'Subtitles in use',
  'subtitles-superseded': 'Older subtitles',
  'scene-cache': 'Scene render cache',
  'ai-cache': 'AI content cache',
  'extract-cache': 'Extracted-text cache (Dropbox documents)',
  'studio-image': 'Studio slide images in use',
  'studio-image-unused': 'Studio slide images no longer used',
  'leftover-tmp': 'Leftover partial writes (.tmp)',
  'media-other': 'Other media in use',
  'media-other-unreferenced': 'Other unreferenced media',
  other: 'Other',
};

const RETENTION_DAYS = () => ({
  'ai-cache': config.storage.aiCacheDays,
  'tts-cache': config.storage.ttsCacheDays,
  'scene-cache': config.storage.sceneCacheDays,
  'extract-cache': config.storage.extractCacheDays,
});

/** Which objects the clean-up would remove, and why. */
function cleanupPlan(objects, { includeSuperseded = false } = {}) {
  const now = Date.now();
  const days = RETENTION_DAYS();
  const plan = [];
  for (const o of objects) {
    const c = o.category;
    let reason = null;
    if (c === 'dropbox-orphan') reason = 'Copy of a Dropbox file that is no longer tracked (or an older revision); the original stays in Dropbox';
    else if (c === 'dropbox-current' && config.storage.dropboxSourceCache === 'temporary') reason = 'Copy of a Dropbox file (DROPBOX_SOURCE_CACHE=temporary): fetched again from Dropbox when needed';
    else if (c === 'leftover-tmp' && now - o.mtime > DAY) reason = 'Partial write left behind by an interrupted upload';
    else if (days[c] > 0 && now - o.mtime > days[c] * DAY) reason = `Cache entry older than ${days[c]} days (regenerated on demand)`;
    else if (includeSuperseded && ['video-superseded', 'thumbnail-superseded', 'subtitles-superseded', 'audio-superseded', 'studio-image-unused'].includes(c)) reason = 'Generated media no record uses any more (an older version)';
    if (reason) plan.push({ ...o, reason });
  }
  return plan;
}

let lastReport = null;

/** Full storage report (measured, not estimated). Cached for 60 s unless `fresh`. */
export async function storageReport({ fresh = false } = {}) {
  if (!fresh && lastReport && Date.now() - lastReport.at < 60_000) return lastReport.data;
  const [objects, refs, temp] = await Promise.all([listObjects(), references(), inspectTempStorage()]);
  for (const o of objects) o.category = classify(o, refs);
  const cats = {};
  for (const o of objects) {
    const c = (cats[o.category] ||= { category: o.category, label: CATEGORY_LABELS[o.category] || o.category, count: 0, bytes: 0 });
    c.count++;
    c.bytes += o.size;
  }
  const safe = cleanupPlan(objects);
  const withSuperseded = cleanupPlan(objects, { includeSuperseded: true });
  const dbFile = config.sqlitePath;
  const dbBytes = ['', '-wal', '-shm'].reduce((n, sfx) => n + (fs.existsSync(dbFile + sfx) ? fs.statSync(dbFile + sfx).size : 0), 0);
  const data = {
    measured_at: new Date().toISOString(),
    object_store: { root: config.objectDir, count: objects.length, bytes: objects.reduce((n, o) => n + o.size, 0) },
    categories: Object.values(cats).sort((a, b) => b.bytes - a.bytes),
    temp: { root: temp.root, dirs: temp.dirs.length, bytes: temp.bytes, abandoned: temp.dirs.filter((d) => d.abandoned).length, in_use: temp.dirs.filter((d) => d.in_use).length },
    database: { dialect: db().dialect, bytes: db().dialect === 'sqlite' ? dbBytes : null },
    reclaimable: {
      safe: { count: safe.length, bytes: safe.reduce((n, o) => n + o.size, 0) },
      including_superseded_media: { count: withSuperseded.length, bytes: withSuperseded.reduce((n, o) => n + o.size, 0) },
      temp: { dirs: temp.dirs.filter((d) => d.abandoned).length, bytes: temp.dirs.filter((d) => d.abandoned).reduce((n, d) => n + d.bytes, 0) },
    },
    policy: {
      dropbox_source_cache: config.storage.dropboxSourceCache,
      retention_days: RETENTION_DAYS(),
      temp_max_age_hours: config.storage.tempMaxAgeHours,
      auto_cleanup: config.storage.autoCleanup,
      video_output: config.storage.videoOutput,
    },
  };
  lastReport = { at: Date.now(), data };
  return data;
}

/**
 * Removes the safe categories (see the top of this file). dryRun lists what would go without
 * deleting; includeSuperseded also removes generated media no record uses any more.
 */
export async function cleanupStorage({ dryRun = true, includeSuperseded = false } = {}) {
  const [objects, refs] = await Promise.all([listObjects(), references()]);
  for (const o of objects) o.category = classify(o, refs);
  const plan = cleanupPlan(objects, { includeSuperseded });
  const byReason = {};
  for (const o of plan) {
    const r = (byReason[o.category] ||= { category: o.category, label: CATEGORY_LABELS[o.category] || o.category, count: 0, bytes: 0 });
    r.count++;
    r.bytes += o.size;
  }
  let removed = 0;
  let failed = 0;
  if (!dryRun) {
    for (const o of plan) {
      try {
        if (o.category === 'leftover-tmp') await fsp.rm(o.file, { force: true });
        else await deleteObject(o.key);
        removed++;
      } catch (err) {
        failed++;
        log.warn('storage.cleanup_failed', { key: o.key, error: err.message });
      }
    }
  }
  const temp = await cleanupAbandonedTemp({ dryRun });
  lastReport = null;
  const result = {
    dry_run: dryRun, include_superseded: includeSuperseded,
    objects: { count: plan.length, bytes: plan.reduce((n, o) => n + o.size, 0), removed, failed },
    temp, by_category: Object.values(byReason).sort((a, b) => b.bytes - a.bytes),
  };
  if (!dryRun) log.info('storage.cleanup', { removed, failed, bytes: result.objects.bytes, temp_dirs: temp.removed });
  return result;
}

let timer = null;
/** Daily clean-up of the safe categories when STORAGE_AUTO_CLEANUP=true; abandoned temp dirs always. */
export function startStorageMaintenance() {
  if (timer) return;
  const run = async () => {
    try {
      if (config.storage.autoCleanup) await cleanupStorage({ dryRun: false });
      else await cleanupAbandonedTemp({ dryRun: false });
    } catch (err) {
      log.error('storage.maintenance_failed', { error: err.message });
    }
  };
  setTimeout(run, 30_000).unref();
  timer = setInterval(run, DAY);
  timer.unref();
}

export function stopStorageMaintenance() {
  clearInterval(timer);
  timer = null;
}
