import { createClientFromRequest } from '@base44/sdk';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import {
  dbxRpc, dbxContent, listAllFiles, normalizeRootFolder, readConfig, isSupported,
  isGenericName, extensionOf, requireAdmin, json, errorResponse,
} from '../../shared/dropboxClient.ts';

/**
 * Admin utility: renames generically-named files in Dropbox ("Untitled.pptx",
 * "New Presentation (3).pptx", …) to a descriptive name derived from the deck's
 * own title slide, then updates the matching Presentation record.
 *
 * Supports dry_run so an admin can review the proposed names first.
 */

async function download(base44: any, path: string): Promise<ArrayBuffer> {
  const response = await dbxContent(base44, 'files/download', { path });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return response.arrayBuffer();
}

async function firstSlideText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort()
    .slice(0, 3);

  const chunks: string[] = [];
  for (const name of names) {
    const xml = await zip.files[name].async('string');
    chunks.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' '));
  }
  return chunks.join('\n').replace(/\s+/g, ' ').trim();
}

async function titleSlideImage(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const rels = zip.files['ppt/slides/_rels/slide1.xml.rels'];
  if (!rels) return null;
  const xml = await rels.async('string');
  const target = [...xml.matchAll(/Target="([^"]*media\/[^"]+)"/g)][0]?.[1];
  if (!target) return null;
  const media = zip.files[`ppt/${target.replace(/^\.\.\//, '')}`];
  if (!media) return null;
  return { bytes: await media.async('uint8array'), name: target.split('/').pop() ?? 'slide1.png' };
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    await requireAdmin(base44);

    const payload = await req.json().catch(() => ({}));
    const dryRun = payload.dry_run !== false;
    const limit = Number(payload.limit ?? 25);

    const config = await readConfig(base44);
    if (!config?.refresh_token) return json({ error: 'Dropbox is not connected.' }, 400);

    const root = normalizeRootFolder(config.root_folder);
    const files = (await listAllFiles(base44, root))
      .filter((f) => isSupported(f.name) && isGenericName(f.name))
      .slice(0, limit);

    const renamed: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const ext = extensionOf(file.name);
        const buffer = await download(base44, file.path_lower);

        let context = '';
        let fileUrls: string[] | undefined;

        if (ext === 'pptx') {
          context = await firstSlideText(buffer);
          if (context.length < 12) {
            // Image-only deck: upload the title slide and let vision read it.
            const image = await titleSlideImage(buffer);
            if (image) {
              const upload = await base44.integrations.Core.UploadFile({
                file: new File([image.bytes], image.name, { type: 'image/png' }),
              });
              if (upload?.file_url) fileUrls = [upload.file_url];
            }
          }
        } else if (ext === 'html') {
          const html = new TextDecoder().decode(buffer);
          context = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);
        }

        if (!context && !fileUrls) {
          errors.push(`${file.name}: no readable title content.`);
          continue;
        }

        const result = await base44.integrations.Core.InvokeLLM({
          prompt: [
            'Suggest a short descriptive filename for this business presentation.',
            '3 to 8 words, Title Case, no file extension, no quotes, no punctuation at the end.',
            context ? `\nSlide text:\n${context.slice(0, 3000)}` : '\nRead the title from the attached title slide image.',
          ].join('\n'),
          ...(fileUrls ? { file_urls: fileUrls } : {}),
          response_json_schema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        });

        const title = sanitizeFilename((result?.title ?? '').toString());
        if (title.length < 3) {
          errors.push(`${file.name}: the model returned no usable title.`);
          continue;
        }

        const newPath = `${file.path_display.slice(0, file.path_display.lastIndexOf('/'))}/${title}.${ext}`;
        const entry: Record<string, unknown> = {
          from: file.path_display,
          to: newPath,
          title,
          applied: false,
        };

        if (!dryRun) {
          const moved = await dbxRpc(base44, 'files/move_v2', {
            from_path: file.path_lower,
            to_path: newPath,
            autorename: true,
          });

          const [record] = await base44.asServiceRole.entities.Presentation.filter({
            dropbox_id: file.id,
          });
          if (record) {
            await base44.asServiceRole.entities.Presentation.update(record.id, {
              title,
              dropbox_path: moved?.metadata?.path_display ?? newPath,
              dropbox_rev: moved?.metadata?.rev ?? record.dropbox_rev,
            });
          }
          entry.applied = true;
          entry.to = moved?.metadata?.path_display ?? newPath;
        }

        renamed.push(entry);
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    return json({ dry_run: dryRun, candidates: files.length, renamed, errors });
  } catch (err) {
    return errorResponse(err);
  }
});
