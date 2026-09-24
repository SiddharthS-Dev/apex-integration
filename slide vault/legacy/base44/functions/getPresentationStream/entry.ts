import { createClientFromRequest } from '@base44/sdk';
import { dbxContent, dbxRpc, json, errorResponse } from '../../shared/dropboxClient.ts';

/**
 * Returns a streamable PDF URL for a presentation.
 *
 * Office formats are rendered to PDF by Dropbox's preview endpoint; PDFs and
 * HTML come down through a temporary link. Either way the result is uploaded to
 * permanent storage once and cached on the entity, so the second reader never
 * pays the conversion cost.
 */

const OFFICE_TYPES = ['pptx', 'docx', 'xlsx', 'ppt', 'doc', 'xls'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const payload = await req.json().catch(() => ({}));
    const presentationId = payload.presentation_id;
    if (!presentationId) return json({ error: 'presentation_id is required.' }, 400);

    const presentation = await base44.asServiceRole.entities.Presentation.get(presentationId);
    if (!presentation) return json({ error: 'Presentation not found.' }, 404);

    // 1. Already converted and stored — hand the cached URL straight back.
    if (presentation.file_url) {
      return json({
        url: presentation.file_url,
        dropbox_rev: presentation.dropbox_rev,
        preview: false,
        cached: true,
      });
    }

    if (!presentation.dropbox_path) {
      return json({ error: 'This presentation has no Dropbox path to stream from.' }, 409);
    }

    const path = presentation.dropbox_path;
    const fileType = (presentation.file_type ?? 'pdf').toLowerCase();
    const isOffice = OFFICE_TYPES.includes(fileType);

    let blob: Blob;

    if (isOffice) {
      // 2. Office formats: Dropbox renders a PDF preview for us.
      const response = await dbxContent(base44, 'files/get_preview', { path });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Dropbox preview failed (${response.status}): ${detail.slice(0, 200)}`);
      }
      blob = await response.blob();
    } else {
      // 3. Everything else: fetch the original through a temporary link.
      const link = await dbxRpc(base44, 'files/get_temporary_link', { path });
      const response = await fetch(link.link);
      if (!response.ok) throw new Error(`Temporary link fetch failed (${response.status}).`);
      blob = await response.blob();
    }

    // 4. Store it permanently so the conversion happens exactly once.
    const safeName = `${(presentation.title ?? 'presentation').replace(/[^\w\s-]/g, '').slice(0, 80)}.pdf`;
    const file = new File([blob], safeName, { type: 'application/pdf' });
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    if (!file_url) throw new Error('Could not store the converted file.');

    // 5. Remember it on the entity.
    await base44.asServiceRole.entities.Presentation.update(presentationId, {
      file_url,
      last_synced: new Date().toISOString(),
    });

    return json({
      url: file_url,
      dropbox_rev: presentation.dropbox_rev,
      preview: isOffice,
      cached: false,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
