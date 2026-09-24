import { createClientFromRequest } from '@base44/sdk';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import {
  dbxRpc, dbxContent, listAllFiles, normalizeRootFolder, readConfig, writeConfig,
  forceRefresh, isSupported, isGenericName, extensionOf, json, errorResponse,
} from '../../shared/dropboxClient.ts';

/**
 * Discovers every supported file in the configured Dropbox folder, derives a
 * title for untitled decks, classifies each one with the LLM, generates a
 * thumbnail, and reconciles the Presentation entity with what Dropbox holds.
 */

const TAXONOMY = `
1. Engineering -> [Architecture, Backend, Frontend, DevOps, AI]
2. Products -> [FleetExplorer, Discipline Engine, Insight Flow, SlidesVault, ESG, CK]
3. Business -> [Operations, Sales, Marketing, Finance, Customer Success]
4. Human Resources -> [Onboarding, Policies, Training, Performance, Recruitment]
5. Research & Innovation -> [AI Research, IoT, Knowledge Base, Sustainability, Future Concepts]
`.trim();

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    primary_domain: {
      type: 'string',
      enum: ['Engineering', 'Products', 'Business', 'Human Resources', 'Research & Innovation'],
    },
    sub_domain: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } },
    ai_summary: { type: 'string' },
    learning_objectives: { type: 'array', items: { type: 'string' } },
    ai_confidence: { type: 'number' },
  },
  required: ['primary_domain', 'sub_domain', 'category', 'tags', 'ai_summary'],
};

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Downloads a Dropbox file as an ArrayBuffer. */
async function downloadFile(base44: any, path: string): Promise<ArrayBuffer> {
  const response = await dbxContent(base44, 'files/download', { path });
  if (!response.ok) {
    throw new Error(`Download failed for ${path} (${response.status})`);
  }
  return response.arrayBuffer();
}

/** Pulls the text of the first slides out of a PPTX via its slide XML. */
async function extractPptxText(buffer: ArrayBuffer, maxSlides = 6): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, maxSlides);

  const chunks: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    if (runs.length > 0) chunks.push(runs.join(' '));
  }
  return chunks.join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * Gamma-style exports have image-only slides. This pulls the first slide's
 * embedded image so a vision model can read the title off it.
 */
async function extractTitleSlideImage(
  buffer: ArrayBuffer
): Promise<{ bytes: Uint8Array; name: string } | null> {
  const zip = await JSZip.loadAsync(buffer);
  const relsFile = zip.files['ppt/slides/_rels/slide1.xml.rels'];
  if (!relsFile) return null;

  const rels = await relsFile.async('string');
  const target = [...rels.matchAll(/Target="([^"]*media\/[^"]+)"/g)][0]?.[1];
  if (!target) return null;

  const mediaPath = `ppt/${target.replace(/^\.\.\//, '')}`;
  const media = zip.files[mediaPath];
  if (!media) return null;

  return { bytes: await media.async('uint8array'), name: mediaPath.split('/').pop() ?? 'slide1.png' };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Asks the LLM for a human title given whatever text we could extract. */
async function deriveTitleFromText(base44: any, text: string, filename: string): Promise<string | null> {
  if (!text || text.length < 12) return null;
  const result = await base44.integrations.Core.InvokeLLM({
    prompt: [
      'You are naming a business presentation from the text on its opening slides.',
      'Return a single descriptive title of at most 12 words in Title Case.',
      'No quotes, no file extension, no trailing punctuation.',
      `Original filename: ${filename}`,
      '',
      'Slide text:',
      text.slice(0, 4000),
    ].join('\n'),
    response_json_schema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  });
  const title = (result?.title ?? '').toString().trim();
  return title.length > 2 ? title : null;
}

/** Vision fallback: upload the title slide image and ask the model to read it. */
async function deriveTitleFromImage(
  base44: any,
  image: { bytes: Uint8Array; name: string }
): Promise<string | null> {
  try {
    const file = new File([image.bytes], image.name, { type: 'image/png' });
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    if (!file_url) return null;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt:
        'This is the title slide of a business presentation. Read the title text and return it, at most 12 words, Title Case, no quotes.',
      file_urls: [file_url],
      response_json_schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
    });
    const title = (result?.title ?? '').toString().trim();
    return title.length > 2 ? title : null;
  } catch (err) {
    console.warn('[syncDropbox] vision title failed', err);
    return null;
  }
}

async function deriveTitle(base44: any, path: string, ext: string, filename: string): Promise<string> {
  const fallback = titleFromFilename(filename);
  try {
    const buffer = await downloadFile(base44, path);

    if (ext === 'pptx') {
      const text = await extractPptxText(buffer);
      const fromText = await deriveTitleFromText(base44, text, filename);
      if (fromText) return fromText;

      // No text at all: the deck is image-based, so read the title slide.
      const image = await extractTitleSlideImage(buffer);
      if (image) {
        const fromImage = await deriveTitleFromImage(base44, image);
        if (fromImage) return fromImage;
      }
    }

    if (ext === 'html') {
      const html = new TextDecoder().decode(buffer);
      const tagTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
      if (tagTitle && !isGenericName(tagTitle)) return tagTitle;
      const fromText = await deriveTitleFromText(base44, stripHtml(html), filename);
      if (fromText) return fromText;
    }
  } catch (err) {
    console.warn(`[syncDropbox] title derivation failed for ${path}`, err);
  }
  return fallback;
}

/** Classifies a presentation into the taxonomy. */
async function classify(base44: any, title: string, filename: string) {
  try {
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: [
        'Classify this business presentation into the Inspironics taxonomy.',
        'Pick exactly one primary_domain and one sub_domain from its list.',
        '',
        TAXONOMY,
        '',
        'Also return: category (1-3 words), tags (3-6 short tags), keywords (5-10),',
        'ai_summary (exactly 2 sentences), learning_objectives (2-4), ai_confidence (0-1).',
        '',
        `Title: ${title}`,
        `Filename: ${filename}`,
      ].join('\n'),
      response_json_schema: CLASSIFY_SCHEMA,
    });

    return {
      primary_domain: result?.primary_domain ?? 'Business',
      sub_domain: result?.sub_domain ?? '',
      category: result?.category ?? '',
      tags: Array.isArray(result?.tags) ? result.tags.slice(0, 6) : [],
      keywords: Array.isArray(result?.keywords) ? result.keywords.slice(0, 10) : [],
      ai_summary: result?.ai_summary ?? '',
      learning_objectives: Array.isArray(result?.learning_objectives)
        ? result.learning_objectives.slice(0, 4)
        : [],
      ai_confidence: typeof result?.ai_confidence === 'number' ? result.ai_confidence : 0.6,
    };
  } catch (err) {
    console.warn('[syncDropbox] classification failed', err);
    return { primary_domain: 'Business', sub_domain: '', category: '', tags: [], keywords: [], ai_summary: '', learning_objectives: [], ai_confidence: 0 };
  }
}

/** Renders a thumbnail through Dropbox and stores it permanently. */
async function generateThumbnail(base44: any, path: string, ext: string): Promise<string> {
  if (ext !== 'pdf' && ext !== 'pptx') return '';
  try {
    const response = await dbxContent(base44, 'files/get_thumbnail_v2', {
      resource: { '.tag': 'path', path },
      format: 'jpeg',
      size: 'w640h480',
      mode: 'strict',
    });
    if (!response.ok) return '';

    const blob = await response.blob();
    const file = new File([blob], `${baseName(path)}.jpg`, { type: 'image/jpeg' });
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    return file_url ?? '';
  } catch (err) {
    console.warn(`[syncDropbox] thumbnail failed for ${path}`, err);
    return '';
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const started = new Date().toISOString();

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const trigger = payload.trigger ?? 'manual';
  const limit = Number(payload.limit ?? 50);

  const errors: string[] = [];
  let syncLogId: string | null = null;
  let config: any = null;

  try {
    config = await readConfig(base44);
    if (!config?.refresh_token) {
      return json({ status: 'error', error: 'Dropbox is not connected.' }, 400);
    }

    const root = normalizeRootFolder(config.root_folder);

    const log = await base44.asServiceRole.entities.SyncLog.create({
      started_at: started,
      status: 'running',
      trigger,
    });
    syncLogId = log.id;
    await writeConfig(base44, config.id, { sync_status: 'running', last_error: '' });

    // Always mint a fresh token for a sync run: these are long and token expiry
    // mid-run is the most common failure mode.
    await forceRefresh(base44);

    const files = (await listAllFiles(base44, root)).filter((f) => isSupported(f.name));
    const existing = await base44.asServiceRole.entities.Presentation.list('-created_date', 5000);
    const byDropboxId = new Map<string, any>(existing.map((p: any) => [p.dropbox_id, p]));
    const seenIds = new Set<string>();

    let created = 0;
    let updated = 0;
    let indexed = 0;

    for (const file of files) {
      if (indexed >= limit) break;
      seenIds.add(file.id);

      try {
        const record = byDropboxId.get(file.id);
        const ext = extensionOf(file.name);
        const filenameIsGeneric = isGenericName(file.name);
        const titleIsGeneric = record ? isGenericName(record.title ?? '') : true;
        const unchanged = record && record.dropbox_rev === file.rev;

        if (unchanged && !titleIsGeneric && record.status === 'active') {
          await base44.asServiceRole.entities.Presentation.update(record.id, {
            last_synced: new Date().toISOString(),
            dropbox_path: file.path_display,
          });
          continue;
        }

        indexed += 1;

        const title = filenameIsGeneric
          ? await deriveTitle(base44, file.path_lower, ext, file.name)
          : titleFromFilename(file.name);

        const classification = await classify(base44, title, file.name);
        const thumbnail = await generateThumbnail(base44, file.path_lower, ext);

        const fields = {
          title,
          description: classification.ai_summary.slice(0, 200),
          dropbox_id: file.id,
          dropbox_path: file.path_display,
          dropbox_rev: file.rev,
          file_type: ext,
          file_size: file.size ?? 0,
          modified_date: file.server_modified,
          last_synced: new Date().toISOString(),
          sync_status: 'synced',
          status: 'active',
          ...classification,
          ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
        };

        if (record) {
          // The cached PDF is keyed to a revision; drop it when the file moved on.
          const fileUrlPatch = record.dropbox_rev !== file.rev ? { file_url: '' } : {};
          await base44.asServiceRole.entities.Presentation.update(record.id, { ...fields, ...fileUrlPatch });
          updated += 1;
        } else {
          await base44.asServiceRole.entities.Presentation.create({ ...fields, view_count: 0, trend_score: 0, slide_count: 0 });
          created += 1;
        }
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    // Anything we hold that Dropbox no longer lists is archived, never deleted.
    let archived = 0;
    for (const record of existing) {
      if (record.status === 'archived') continue;
      if (!record.dropbox_id || seenIds.has(record.dropbox_id)) continue;
      if (files.some((f) => f.id === record.dropbox_id)) continue;
      await base44.asServiceRole.entities.Presentation.update(record.id, { status: 'archived' });
      archived += 1;
    }

    const remaining = Math.max(0, files.length - indexed);
    const completedAt = new Date().toISOString();

    await base44.asServiceRole.entities.SyncLog.update(syncLogId, {
      completed_at: completedAt,
      status: errors.length > 0 && created + updated === 0 ? 'error' : 'success',
      new_count: created,
      updated_count: updated,
      deleted_count: archived,
      total_files: files.length,
      error: errors[0] ?? '',
      details: JSON.stringify({ root_folder: root, discovered: files.length, indexed, remaining, errors }),
    });

    await writeConfig(base44, config.id, {
      sync_status: 'success',
      last_sync: completedAt,
      connection_status: 'connected',
      last_error: errors[0] ?? '',
    });

    return json({
      status: 'success',
      root_folder: root,
      discovered: files.length,
      indexed,
      new: created,
      updated,
      deleted: archived,
      remaining,
      errors,
    });
  } catch (err: any) {
    if (syncLogId) {
      await base44.asServiceRole.entities.SyncLog.update(syncLogId, {
        completed_at: new Date().toISOString(),
        status: 'error',
        error: err.message,
      }).catch(() => {});
    }
    if (config?.id) {
      await writeConfig(base44, config.id, { sync_status: 'error', last_error: err.message }).catch(() => {});
    }
    return errorResponse(err);
  }
});
