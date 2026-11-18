import { PLAYBOOK_FILE_TYPES } from '@academy/shared';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { getObject, objectKey, objectMeta, objectStream, putObject } from './objectStore.js';
import { currentAccount, sourceAccount, withDropboxAccount } from '../dropbox/connection.js';

// Playbook.file_url (and Meeting.file_url) is a server-side reference, never a public URL:
//   upload:<objectKey>          → uploaded through the API (the only copy: kept in the object store)
//   dropbox:<dropboxFileId>     → lives in Dropbox (the primary store); APEX keeps its id, revision,
//                                 path, size and content hash
//
// Dropbox bytes are fetched only when a step needs them (extraction, a download). With
// DROPBOX_SOURCE_CACHE=temporary (default) they are not kept: processing holds them in memory and the
// admin "view source" streams straight from Dropbox. With =permanent a copy per revision is kept in the
// object store (the previous behaviour). A copy kept earlier is still used while it exists.

export function parseFileRef(ref = '') {
  const idx = ref.indexOf(':');
  if (idx < 0) return { kind: 'unknown', id: ref };
  return { kind: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

export const dropboxSourceKey = (fileId, rev) => objectKey('dropbox', fileId, rev, 'source');

const accountFor = (record) => (record.dropbox_source ? sourceAccount(record.dropbox_source) : currentAccount());

/** The record's file bytes (Buffer). Dropbox files are downloaded through the API's own authorization. */
export async function loadPlaybookBytes(record, { keep } = {}) {
  const ref = parseFileRef(record.file_url);
  if (ref.kind === 'upload') {
    const buf = await getObject(ref.id);
    if (!buf) throw new Error('Uploaded file is missing from the object store');
    return buf;
  }
  if (ref.kind === 'dropbox') {
    const key = dropboxSourceKey(ref.id, record.revision || '');
    const cached = await getObject(key);
    if (cached) return cached;
    const { downloadFile } = await import('../dropbox/client.js');
    const buf = await withDropboxAccount(accountFor(record), () => downloadFile(ref.id));
    if (keep ?? config.storage.dropboxSourceCache === 'permanent') {
      await putObject(key, buf, { source: 'dropbox', file_id: ref.id, rev: record.revision, name: record.file_name });
    }
    return buf;
  }
  throw new Error(`Unsupported file reference: ${record.file_url}`);
}

/**
 * Sends the record's file to an HTTP response without writing it to disk: from the object store when
 * it is an upload (or a copy exists), otherwise streamed from Dropbox. Supports Range requests.
 */
export async function streamPlaybookSource(record, req, res, { contentType, fileName, attachment = false }) {
  const ref = parseFileRef(record.file_url);
  const disposition = `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  const key = ref.kind === 'upload' ? ref.id : ref.kind === 'dropbox' ? dropboxSourceKey(ref.id, record.revision || '') : null;
  const meta = key ? await objectMeta(key) : null;
  if (meta) {
    res.setHeader('Content-Length', meta.size);
    objectStream(key).pipe(res);
    return 'stored';
  }
  if (ref.kind !== 'dropbox') throw new Error('Uploaded file is missing from the object store');
  const { openDownload } = await import('../dropbox/client.js');
  const range = /^bytes=\d*-\d*$/.test(req.get('range') || '') ? req.get('range') : undefined;
  const up = await withDropboxAccount(accountFor(record), () => openDownload(ref.id, { range }));
  res.status(up.status === 206 ? 206 : 200);
  for (const h of ['content-length', 'content-range']) if (up.headers.get(h)) res.setHeader(h, up.headers.get(h));
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(up.body);
    body.on('error', reject);
    res.on('close', resolve);
    body.pipe(res);
  });
  return 'streamed';
}

export function contentTypeFor(fileType) {
  return PLAYBOOK_FILE_TYPES[fileType]?.mime || 'application/octet-stream';
}
