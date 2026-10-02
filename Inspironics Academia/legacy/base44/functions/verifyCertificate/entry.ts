// verifyCertificate — public certificate verification (used by the QR code on certificates).
//
// Payload: { certificate_id }   (no auth required)
// Returns: { valid: true, user_name, course_title, score, completion_date, certificate_id } or { valid: false }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let certificateId = '';
    if (req.method === 'GET') {
      certificateId = new URL(req.url).searchParams.get('certificate_id') || '';
    } else {
      const body = await req.json().catch(() => ({}));
      certificateId = String(body?.certificate_id || '');
    }
    certificateId = certificateId.trim();
    if (!certificateId || certificateId.length > 200) return Response.json({ valid: false });

    const matches = await base44.asServiceRole.entities.Certificate.filter({ certificate_id: certificateId });
    const cert = Array.isArray(matches) ? matches[0] : null;
    if (!cert) return Response.json({ valid: false });

    // Only expose non-sensitive fields.
    return Response.json({
      valid: true,
      user_name: cert.user_name || '',
      course_title: cert.course_title || '',
      score: cert.score ?? 0,
      completion_date: cert.completion_date || cert.created_date || null,
      certificate_id: cert.certificate_id,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('verifyCertificate failed:', message);
    return Response.json({ error: message }, { status: 500 });
  }
});
