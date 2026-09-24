import { createClientFromRequest } from '@base44/sdk';
import { dbxRpc, requireAdmin, json, errorResponse } from '../../shared/dropboxClient.ts';

/**
 * Admin-only utility that mints temporary Dropbox download links (valid for
 * roughly four hours) for one or more presentations. Used for bulk export and
 * support work — regular readers stream through getPresentationStream instead,
 * which never hands out a direct file link.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    await requireAdmin(base44);

    const payload = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(payload.presentation_ids) ? payload.presentation_ids : [];
    const limit = Number(payload.limit ?? 50);

    const presentations = ids.length
      ? await Promise.all(
          ids.map((id) => base44.asServiceRole.entities.Presentation.get(id).catch(() => null))
        )
      : await base44.asServiceRole.entities.Presentation.filter({ status: 'active' }, '-created_date', limit);

    const links: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (const presentation of presentations.filter(Boolean) as any[]) {
      if (!presentation.dropbox_path) {
        errors.push(`${presentation.title}: no Dropbox path on record.`);
        continue;
      }
      try {
        const result = await dbxRpc(base44, 'files/get_temporary_link', {
          path: presentation.dropbox_path,
        });
        links.push({
          id: presentation.id,
          title: presentation.title,
          file_type: presentation.file_type,
          file_size: presentation.file_size,
          path: presentation.dropbox_path,
          link: result.link,
          // Dropbox temporary links live about four hours.
          expires_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        });
      } catch (err: any) {
        errors.push(`${presentation.title}: ${err.message}`);
      }
    }

    return json({ count: links.length, links, errors });
  } catch (err) {
    return errorResponse(err);
  }
});
