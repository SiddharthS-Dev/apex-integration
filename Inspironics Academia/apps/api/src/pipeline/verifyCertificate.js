import { entities } from '../repo/entities.js';

// verifyCertificate — public certificate verification (used by the QR code on certificates).
//
// Payload: { certificate_id }   (no auth required)
// Returns: { valid: true, user_name, course_title, score, completion_date, certificate_id } or { valid: false }
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
  };
}
