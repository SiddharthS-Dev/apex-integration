import crypto from 'node:crypto';
import {
  ONBOARDING_DOCUMENT_MAX_BYTES, ONBOARDING_DOCUMENT_TYPES, ONBOARDING_DOCUMENT_KINDS, cleanFileName, onboardingDocument, roleDocumentKinds, sniffDocumentType,
} from '@academy/shared';
import { configuredKeys, decryptWithIndex, encrypt } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';

// Optional supporting documents on an access request (migration 012; the intern mark sheet).
//
// - Only a role that lists the kind may attach it (shared catalogue), and only while the request is a
//   verified draft (service.js checks the state). Always optional.
// - The file's type is proven by its first bytes (PDF, JPEG, PNG); the browser's claimed type and the
//   file name are never trusted. The name is cleaned for display and for a download header.
// - The bytes are encrypted at rest (AES-256-GCM, TOKEN_ENCRYPTION_KEY, rotatable: rewrapSecrets.js) and
//   carry a SHA-256 that is checked when a reviewer opens the file.
// - Without a valid encryption key, uploads are switched off (the assistant then does not offer them):
//   a file is never stored in the clear.
// - The content never goes into logs, audit details, AI prompts or the applicant's own views.

/** Upload size cap in base64 characters (4 per 3 bytes, plus padding). */
const MAX_BASE64 = Math.ceil(ONBOARDING_DOCUMENT_MAX_BYTES / 3) * 4;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_MB = ONBOARDING_DOCUMENT_MAX_BYTES / (1024 * 1024);

/** True when an encryption key is configured, so a document can be stored. */
export function documentsAvailable() {
  try {
    configuredKeys();
    return true;
  } catch {
    return false;
  }
}

/** What the assistant needs to offer an upload (no secrets). */
export function documentsConfig() {
  return {
    enabled: documentsAvailable(),
    max_bytes: ONBOARDING_DOCUMENT_MAX_BYTES,
    types: ONBOARDING_DOCUMENT_TYPES,
    kinds: ONBOARDING_DOCUMENT_KINDS.map((k) => onboardingDocument(k)),
  };
}

const invalid = (field, message) => badRequest(message, { code: 'INVALID', fields: { [field]: message } });

/**
 * Validates an upload body { kind, file_name, data_base64 } for a role. Returns
 * { kind, bytes, contentType, fileName } or throws a 400 with a field message.
 */
export function parseUpload(body, roleCode) {
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  if (!onboardingDocument(kind)) throw invalid('kind', 'Unknown document type.');
  if (!roleDocumentKinds(roleCode).includes(kind)) throw invalid('kind', 'This document is not asked for your role.');
  const data = typeof body?.data_base64 === 'string' ? body.data_base64 : '';
  if (!data) throw invalid('file', 'Choose a file to upload.');
  if (data.length > MAX_BASE64) throw invalid('file', `The file is larger than ${MAX_MB} MB. Upload a smaller file.`);
  if (data.length % 4 !== 0 || !BASE64_RE.test(data)) throw invalid('file', 'The file could not be read. Choose it again.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) throw invalid('file', 'The file is empty.');
  if (bytes.length > ONBOARDING_DOCUMENT_MAX_BYTES) throw invalid('file', `The file is larger than ${MAX_MB} MB. Upload a smaller file.`);
  const contentType = sniffDocumentType(bytes);
  if (!contentType) throw invalid('file', 'Upload a PDF, JPG or PNG file.');
  return { kind, bytes, contentType, fileName: cleanFileName(body.file_name, contentType) };
}

const metaOf = (r) => ({ kind: r.kind, label: onboardingDocument(r.kind)?.label || r.kind, file_name: r.file_name, content_type: r.content_type, size_bytes: Number(r.size_bytes), uploaded_at: r.created_at });

/** The documents attached to a request: metadata only, never the content. */
export async function documentsFor(q, requestId) {
  const rows = await q.query(
    'SELECT kind, file_name, content_type, size_bytes, created_at FROM registration_documents WHERE request_id = ? ORDER BY kind',
    [requestId],
  );
  return rows.map(metaOf);
}

/** Stores (or replaces) one document of a request, encrypted. Call inside a transaction. */
export async function storeDocument(tx, requestId, { kind, bytes, contentType, fileName }, at = new Date().toISOString()) {
  await tx.run('DELETE FROM registration_documents WHERE request_id = ? AND kind = ?', [requestId, kind]);
  await tx.run(
    `INSERT INTO registration_documents (id, request_id, kind, file_name, content_type, size_bytes, sha256, content_encrypted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), requestId, kind, fileName, contentType, bytes.length, crypto.createHash('sha256').update(bytes).digest('hex'), encrypt(bytes.toString('base64')), at],
  );
}

/** Removes the documents a role may no longer attach (after the applicant changes role). */
export async function dropDocumentsNotFor(tx, requestId, roleCode) {
  const keep = roleDocumentKinds(roleCode);
  const r = keep.length
    ? await tx.run(`DELETE FROM registration_documents WHERE request_id = ? AND kind NOT IN (${keep.map(() => '?').join(', ')})`, [requestId, ...keep])
    : await tx.run('DELETE FROM registration_documents WHERE request_id = ?', [requestId]);
  return r.changes;
}

/**
 * One document with its decrypted bytes, or null. Throws if the stored file fails authentication or its
 * checksum (tampered data or a missing key): it is never served in that case.
 */
export async function readDocument(q, requestId, kind) {
  const [r] = await q.query('SELECT * FROM registration_documents WHERE request_id = ? AND kind = ?', [requestId, kind]);
  if (!r) return null;
  const bytes = Buffer.from(decryptWithIndex(r.content_encrypted).plaintext, 'base64');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== r.sha256) throw new Error('Stored document failed its checksum');
  return { ...metaOf(r), bytes };
}
