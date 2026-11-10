import { config } from '../config.js';
import { deleteObject, getObject } from '../files/objectStore.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { getSetting, setSetting } from '../repo/settings.js';
import { DropboxError, dropboxContentHash, getFileMetadata, normalizePath, uploadFile } from './client.js';
import { loadConnection, withDropboxAccount } from './connection.js';

// Where rendered videos are kept: in APEX's media store (default) or uploaded to a Dropbox folder
// through the playbooks Dropbox connection (needs the files.content.write permission on that app).
// Each record uploads to one fixed path, so a re-render replaces its file instead of adding copies,
// and an upload is skipped when Dropbox already holds the same bytes (Dropbox content hash). With
// "keep local copy" off, the APEX copy is removed after a successful upload and the video streams
// back from Dropbox.

const KEY = 'storage.output';

export async function outputSettings() {
  const saved = (await getSetting(KEY, {})) || {};
  return {
    destination: saved.destination === 'dropbox' || saved.destination === 'apex' ? saved.destination : config.storage.videoOutput,
    folder: normalizePath(saved.folder ?? config.storage.dropboxOutputFolder) || '/APEX Generated Videos',
    keep_local: typeof saved.keep_local === 'boolean' ? saved.keep_local : config.storage.keepLocalCopy,
  };
}

export async function setOutputSettings(patch = {}) {
  const next = { ...(await outputSettings()) };
  if (patch.destination !== undefined) {
    if (!['apex', 'dropbox'].includes(patch.destination)) throw new HttpError(400, 'destination must be apex or dropbox');
    next.destination = patch.destination;
  }
  if (patch.folder !== undefined) {
    const folder = normalizePath(String(patch.folder || ''));
    if (!folder || folder.split('/').some((s) => s === '..')) throw new HttpError(400, 'Choose a Dropbox folder for generated videos (not the whole Dropbox)');
    next.folder = folder;
  }
  if (patch.keep_local !== undefined) next.keep_local = !!patch.keep_local;
  if (next.destination === 'dropbox' && !(await loadConnection())) throw new HttpError(409, 'Connect the playbooks Dropbox first (Integrations)');
  await setSetting(KEY, next);
  return next;
}

const safeName = (s) => String(s || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video';
const mediaKey = (url) => /\/api\/media\/([a-f0-9]{64})$/.exec(String(url || ''))?.[1] || null;

function toHttp(err) {
  if (!(err instanceof DropboxError)) return err;
  if (/missing_scope|required_scope|files\.content\.write/.test(`${err.summary} ${err.code} ${err.message}`) || err.status === 401) {
    return new HttpError(403, 'The Dropbox app is not allowed to write files: enable the files.content.write permission in the Dropbox App Console, then reconnect Dropbox in Integrations.');
  }
  if (err.code === 'reconnect_required') return new HttpError(409, err.message);
  if (err.status === 429) return new HttpError(429, 'Dropbox rate limit reached while uploading — retry shortly');
  return new HttpError(502, err.message);
}

/**
 * Uploads a rendered video to Dropbox when that is the configured destination.
 * Returns null (APEX destination), or { path, id, rev, uploaded, removed_local }.
 */
export async function publishVideo({ refType, refId, title, videoUrl }) {
  const settings = await outputSettings();
  if (settings.destination !== 'dropbox') return null;
  const key = mediaKey(videoUrl);
  if (!key) throw new HttpError(400, 'There is no rendered video to upload');
  const bytes = await getObject(key);
  if (!bytes) throw new HttpError(404, 'The rendered video is missing from APEX storage — render it again');
  const path = `${settings.folder}/${refType}s/${safeName(title)} (${String(refId).slice(0, 8)}).mp4`;
  try {
    return await withDropboxAccount('playbooks', async () => {
      if (!(await loadConnection())) throw new HttpError(409, 'Connect the playbooks Dropbox first (Integrations)');
      const existing = await getFileMetadata(path);
      let uploaded = false;
      let meta = existing;
      if (!existing || existing.content_hash !== dropboxContentHash(bytes)) {
        const r = await uploadFile(path, bytes, { mode: 'overwrite' });
        meta = { id: r.id, rev: r.rev, path_display: r.path_display };
        uploaded = true;
      }
      let removedLocal = false;
      if (!settings.keep_local) {
        await deleteObject(key);
        removedLocal = true;
      }
      log.info('dropbox.output_published', { ref_type: refType, ref_id: refId, uploaded, removed_local: removedLocal });
      return { path: meta.path_display || path, id: meta.id, rev: meta.rev, uploaded, removed_local: removedLocal };
    });
  } catch (err) {
    throw toHttp(err);
  }
}

/** The URL players use for a video kept only in Dropbox (streamed back through the API). */
export const dropboxVideoUrl = (refType, refId) => `/api/outputs/${refType}/${refId}/video`;
