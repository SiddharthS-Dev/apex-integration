import { PLAYBOOK_FILE_TYPES } from '@academy/shared';
import { getObject, objectKey, putObject } from './objectStore.js';

// Playbook.file_url is a server-side reference, never a public URL:
//   upload:<objectKey>          → uploaded through POST /api/files
//   dropbox:<dropboxFileId>     → synced from Dropbox (bytes cached per revision in the object store)

export function parseFileRef(ref = '') {
  const idx = ref.indexOf(':');
  if (idx < 0) return { kind: 'unknown', id: ref };
  return { kind: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

export const dropboxSourceKey = (fileId, rev) => objectKey('dropbox', fileId, rev, 'source');

// Returns the playbook's file bytes (Buffer). Dropbox files are fetched through the API's own
// authorization and cached; the browser never sees a Dropbox URL.
export async function loadPlaybookBytes(playbook) {
  const ref = parseFileRef(playbook.file_url);
  if (ref.kind === 'upload') {
    const buf = await getObject(ref.id);
    if (!buf) throw new Error('Uploaded file is missing from the object store');
    return buf;
  }
  if (ref.kind === 'dropbox') {
    const key = dropboxSourceKey(ref.id, playbook.revision || '');
    const cached = await getObject(key);
    if (cached) return cached;
    const { downloadFile } = await import('../dropbox/client.js');
    const buf = await downloadFile(ref.id);
    await putObject(key, buf, { source: 'dropbox', file_id: ref.id, rev: playbook.revision, name: playbook.file_name });
    return buf;
  }
  throw new Error(`Unsupported file reference: ${playbook.file_url}`);
}

export function contentTypeFor(fileType) {
  return PLAYBOOK_FILE_TYPES[fileType]?.mime || 'application/octet-stream';
}
