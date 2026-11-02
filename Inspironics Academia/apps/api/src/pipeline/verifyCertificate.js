import { certificateStatus } from '@academy/shared';
import { entities } from '../repo/entities.js';

// verifyCertificate — public certificate verification (used by the QR code on certificates).
//
// Payload: { certificate_id }   (no auth required)
// Returns: { valid: true, user_name, course_title, score, completion_date, certificate_id, status, expires_date,
//            superseded_by } or { valid: false }. `valid` means the id is genuine; `status` says whether the
// certificate is still current (valid · recert_required · expired · superseded).
export default async function verifyCertificate(payload = {}) {
  const certificateId = String(payload?.certificate_id || '').trim();
  if (!certificateId || certificateId.length > 200) return { valid: false };

  const cert = await entities.Certificate.findOne({ certificate_id: certificateId });
  if (!cert) return { valid: false };

  // Only expose non-sensitive fields.
  return {
    valid: true,
    user_name: cert.user_name || '',
    course_title: cert.course_title || '',
    score: cert.score ?? 0,
    completion_date: cert.completion_date || cert.created_date || null,
    certificate_id: cert.certificate_id,
    status: certificateStatus(cert),
    expires_date: cert.expires_date || null,
    superseded_by: cert.superseded_by || null,
  };
}
