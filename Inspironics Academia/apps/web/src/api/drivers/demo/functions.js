import { FUNCTIONS } from '@academy/shared';
import { ApiError } from '@/api/drivers/http';
import { currentUser } from '@/api/drivers/demo/store';
import { forbidden, notFound, unauthorized } from '@/api/drivers/demo/records';
import { findOne, sleep } from '@/api/drivers/demo/service';
import { processPlaybookExtract, processPlaybookStructure } from '@/api/drivers/demo/pipeline';
import { generateAssessment, generateLessonContent } from '@/api/drivers/demo/generate';

// Backend functions for the demo driver — same names, auth rules and result shapes as POST /api/functions/:name.

const handlers = {
  processPlaybookExtract,
  processPlaybookStructure,
  generateLessonContent,
  generateAssessment,
  // Mirrors the API default (MEDIA_PROVIDER=none).
  async generateLessonMedia() {
    await sleep(200);
    throw new ApiError(503, 'Media generation is disabled (MEDIA_PROVIDER=none)');
  },
  async verifyCertificate({ certificate_id: certId } = {}) {
    const cert = certId ? findOne('Certificate', { certificate_id: String(certId) }) : null;
    if (!cert) return { valid: false };
    return {
      valid: true, user_name: cert.user_name, course_title: cert.course_title, score: cert.score,
      completion_date: cert.completion_date, certificate_id: cert.certificate_id,
    };
  },
};

export function createFunctions() {
  return {
    async invoke(name, payload = {}) {
      const spec = FUNCTIONS[name];
      const handler = handlers[name];
      if (!spec || !handler) throw notFound(`Unknown function ${name}`);
      const user = currentUser();
      if (!spec.public && !user) throw unauthorized();
      if (spec.admin && user?.role !== 'admin') throw forbidden('Administrator access required');
      return { data: await handler(payload || {}, { user }) };
    },
  };
}
