import { config, dropboxConfigured } from '../config.js';
import { getObject, objectKey, putObject } from '../files/objectStore.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { extractText } from '../pipeline/text.js';
import { entities } from '../repo/entities.js';
import { recordGeneration } from '../usage/log.js';
import { DropboxError, downloadFile, getFileMetadata, listFolder } from './client.js';
import { loadConnection, meetingsAppConfigured, sourceAccount, sourceAppConfigured, withDropboxAccount } from './connection.js';

// On-demand processing of Dropbox documents (AI Studio): browse a connected Dropbox (metadata only,
// nothing downloaded), pick a document, and get its text. The text is extracted from the bytes held in
// memory — never written to disk — and cached per Dropbox file id + revision, so the same revision is
// never downloaded or extracted twice; a new revision is detected from its metadata and processed.

const PROCESSABLE = new Set(['pdf', 'docx', 'pptx', 'txt', 'md', 'csv']);
const extOf = (name) => String(name || '').split('.').pop().toLowerCase();

/** Dropbox connections an admin can browse: the playbooks app, the meetings app, category sources. */
export async function dropboxAccounts() {
  if (!dropboxConfigured()) return [];
  const out = [];
  const add = async (account, label) => {
    const conn = await withDropboxAccount(account, () => loadConnection()).catch(() => null);
    if (conn) out.push({ account, label, account_name: conn.account_name || conn.account_email || '' });
  };
  await add('playbooks', 'Playbooks Dropbox');
  if (meetingsAppConfigured()) await add('meetings', 'Meetings Dropbox');
  for (const key of Object.keys(config.dropbox.sources || {})) if (sourceAppConfigured(key)) await add(`source:${key}`, `${key[0].toUpperCase()}${key.slice(1)} source Dropbox`);
  return out;
}

export function checkAccount(account) {
  const a = String(account || 'playbooks');
  if (a === 'playbooks' || (a === 'meetings' && meetingsAppConfigured())) return a;
  const m = /^source:([a-z0-9-]+)$/.exec(a);
  if (m && Object.hasOwn(config.dropbox.sources || {}, m[1])) return sourceAccount(m[1]);
  throw badRequest('Unknown Dropbox connection');
}

const toHttp = (err) => {
  if (!(err instanceof DropboxError)) return err;
  if (err.code === 'reconnect_required' || err.code === 'not_connected') return new HttpError(409, err.message);
  if (err.status === 409 && /not_found/.test(err.summary || '')) return new HttpError(404, 'That Dropbox file or folder no longer exists (deleted or moved)');
  if (err.status === 429) return new HttpError(429, 'Dropbox rate limit reached — try again shortly');
  return new HttpError(502, err.message);
};

/** One folder: sub-folders, and files with type, size, modified date, revision and whether APEX tracks them. */
export async function browseDropbox(account, path = '') {
  if (String(path).split(/[\\/]/).some((seg) => seg === '..')) throw badRequest('Invalid path');
  const acct = checkAccount(account);
  let listing;
  try {
    listing = await withDropboxAccount(acct, () => listFolder(path));
  } catch (err) {
    throw toHttp(err);
  }
  const ids = listing.files.map((f) => f.id);
  const tracked = new Map();
  if (ids.length) {
    for (const p of await entities.Playbook.filter({ external_id: { $in: ids } }).catch(() => [])) tracked.set(p.external_id, { type: 'playbook', id: p.id, title: p.title, status: p.status, revision: p.revision, extracted_revision: p.extracted_revision });
    for (const m of await entities.Meeting.filter({ external_id: { $in: ids } }).catch(() => [])) tracked.set(m.external_id, { type: 'meeting', id: m.id, title: m.title, status: m.status, revision: m.revision });
  }
  return {
    path: path || '',
    folders: listing.folders,
    files: listing.files.map((f) => ({ ...f, ext: extOf(f.name), processable: PROCESSABLE.has(extOf(f.name)), tracked: tracked.get(f.id) || null })),
  };
}

const extractKey = (fileId, rev) => objectKey('extract', fileId, rev);

/**
 * Text of a Dropbox document at its current revision: { meta, text, info, reused }. Checks the file
 * still exists, reuses the extraction of the same revision unless `force`, else downloads it into
 * memory (size-checked), extracts it and caches the text for that revision.
 */
export async function dropboxDocumentText(account, fileIdOrPath, { force = false } = {}) {
  const acct = checkAccount(account);
  let meta;
  try {
    meta = await withDropboxAccount(acct, () => getFileMetadata(fileIdOrPath));
  } catch (err) {
    throw toHttp(err);
  }
  if (!meta) throw notFound('That Dropbox file no longer exists (deleted or moved)');
  if (!PROCESSABLE.has(extOf(meta.name))) {
    // Let the extractor explain why (OCR / transcription / legacy formats).
    await extractText({ file_name: meta.name }, Buffer.alloc(0)).catch((err) => { throw err.status ? err : badRequest(err.message); });
  }
  if (Number(meta.size) > config.maxExtractMb * 1024 * 1024) {
    throw new HttpError(413, `${meta.name} is ${(meta.size / 1048576).toFixed(1)} MB, over the ${config.maxExtractMb} MB extraction limit (MAX_EXTRACT_MB)`);
  }
  const key = extractKey(meta.id, meta.rev);
  if (!force) {
    const hit = await getObject(key).catch(() => null);
    if (hit) {
      const cached = JSON.parse(hit.toString('utf8'));
      await recordGeneration({ kind: 'process', provider: 'dropbox', model: 'extract', status: 'reused', ref_type: 'dropbox', ref_id: meta.id });
      return { meta, text: cached.text, info: cached.info || {}, reused: true };
    }
  }
  let bytes;
  try {
    bytes = await withDropboxAccount(acct, () => downloadFile(meta.id));
  } catch (err) {
    throw toHttp(err);
  }
  const { text, info } = await extractText({ file_name: meta.name }, bytes);
  bytes = null; // the original is not kept
  if (!text || text.trim().length < 40) throw new HttpError(422, `No usable text found in ${meta.name} (it may be scanned images)`);
  await putObject(key, Buffer.from(JSON.stringify({ text, info, name: meta.name, rev: meta.rev })), { source: 'extract-cache', file_id: meta.id, rev: meta.rev, name: meta.name });
  await recordGeneration({ kind: 'process', provider: 'dropbox', model: 'extract', status: 'ok', characters: text.length, ref_type: 'dropbox', ref_id: meta.id });
  return { meta, text, info, reused: false };
}
