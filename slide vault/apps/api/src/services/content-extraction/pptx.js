/**
 * PPTX extraction.
 *
 * A .pptx is a ZIP of XML parts. Two things are pulled out:
 *  - the text runs (`<a:t>`) of each slide, in slide order;
 *  - the images embedded in the first slide, which is the fallback when a deck
 *    has no text at all.
 *
 * That second path is not an edge case. Gamma, Canva and "export as picture"
 * produce decks whose slides are a single full-bleed image with no text runs
 * whatsoever, and those are exactly the decks with useless filenames. Assuming
 * `pptx XML = slide content` would leave them permanently untitled (spec §35).
 */
import JSZip from 'jszip';

/** Slide parts sort numerically: slide2 must not come after slide10. */
const slideOrder = (name) => {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const decodeXmlEntities = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');

/** Text of every `<a:t>` run in a slide part, in document order. */
export function textRunsFromSlideXml(xml) {
  const runs = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match = pattern.exec(xml);
  while (match) {
    const text = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (text) runs.push(text);
    match = pattern.exec(xml);
  }
  return runs;
}

/** A single tag's text content, e.g. `<dc:title>`. */
function tagText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml || '');
  return match ? decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Zip-bomb limits. A real deck has a few hundred parts and inflates to a small
 * multiple of its size; a 150 MB file (the sync's size cap) declaring more than
 * this is not a presentation. PPTX_MAX_ZIP_ENTRIES / PPTX_MAX_UNZIP_MB override.
 */
export const DEFAULT_ZIP_LIMITS = Object.freeze({ maxEntries: 5000, maxUncompressedBytes: 300 * 1024 * 1024 });

/** A file refused before or during decompression; the message names the limit. */
export class ExtractionLimitError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExtractionLimitError';
    this.code = code;
  }
}

/**
 * Reads the ZIP central directory without inflating anything and refuses an
 * archive whose entry count or total declared uncompressed size is over the
 * limits. ZIP64 archives are refused outright: no deck under the sync's size
 * cap needs one, and its sizes would need another parser to trust.
 */
export function inspectZip(buffer, { maxEntries, maxUncompressedBytes }) {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const min = Math.max(0, buffer.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExtractionLimitError('Not a ZIP archive (no end of central directory).', 'NOT_ZIP');

  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ExtractionLimitError('ZIP64 archives are not accepted.', 'ZIP64');
  }
  if (entries > maxEntries) {
    throw new ExtractionLimitError(`Archive has ${entries} entries (limit ${maxEntries}).`, 'TOO_MANY_ENTRIES');
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new ExtractionLimitError('Corrupt ZIP central directory.', 'CORRUPT');
  }

  let total = 0;
  let pos = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CEN) {
      throw new ExtractionLimitError('Corrupt ZIP central directory.', 'CORRUPT');
    }
    const size = buffer.readUInt32LE(pos + 24);
    if (size === 0xffffffff) throw new ExtractionLimitError('ZIP64 archives are not accepted.', 'ZIP64');
    total += size;
    if (total > maxUncompressedBytes) {
      throw new ExtractionLimitError(
        `Archive declares more than ${maxUncompressedBytes} uncompressed bytes.`,
        'TOO_LARGE_UNCOMPRESSED'
      );
    }
    pos += 46 + buffer.readUInt16LE(pos + 28) + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }
  return { entries, uncompressedBytes: total };
}

/**
 * Inflates one ZIP part as a stream, stopping as soon as it passes `partCap`
 * (PART_TOO_LARGE) or the shared `budget` (TOO_LARGE_UNCOMPRESSED).
 */
export function readCapped(file, budget, partCap = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const helper = file.internalStream('uint8array');
    const fail = (error) => {
      if (done) return;
      done = true;
      try {
        helper.pause();
      } catch {
        /* already stopped */
      }
      reject(error);
    };
    helper
      .on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        budget.remaining -= chunk.length;
        if (size > partCap) return fail(new ExtractionLimitError('Part exceeds its size limit.', 'PART_TOO_LARGE'));
        if (budget.remaining < 0) {
          return fail(new ExtractionLimitError('Archive inflates past the uncompressed-size limit.', 'TOO_LARGE_UNCOMPRESSED'));
        }
        chunks.push(Buffer.from(chunk));
      })
      .on('error', fail)
      .on('end', () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks, size));
      })
      .resume();
  });
}

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Extracts slide text, core properties and the first slide's images.
 *
 * @param {Buffer} buffer
 * @param {{maxImageBytes?: number, maxSlides?: number}} [options]
 */
export async function extractPptx(
  buffer,
  {
    maxImageBytes = 5 * 1024 * 1024,
    maxSlides = 200,
    maxEntries = DEFAULT_ZIP_LIMITS.maxEntries,
    maxUncompressedBytes = DEFAULT_ZIP_LIMITS.maxUncompressedBytes,
  } = {}
) {
  // Zip-bomb defence, before anything is inflated: the central directory's
  // entry count and declared sizes must be within bounds...
  inspectZip(buffer, { maxEntries, maxUncompressedBytes });
  const zip = await JSZip.loadAsync(buffer);
  // ...and, because declared sizes can lie, every part read below draws on one
  // budget of actually inflated bytes and stops the moment it is spent.
  const budget = { remaining: maxUncompressedBytes };
  const readText = async (file) => new TextDecoder().decode(await readCapped(file, budget));

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideOrder(a) - slideOrder(b))
    .slice(0, maxSlides);

  const slides = [];
  for (const name of slideNames) {
    const xml = await readText(zip.files[name]);
    slides.push({ index: slides.length + 1, part: name, runs: textRunsFromSlideXml(xml) });
  }

  const core = zip.files['docProps/core.xml'] ? await readText(zip.files['docProps/core.xml']) : '';
  const app = zip.files['docProps/app.xml'] ? await readText(zip.files['docProps/app.xml']) : '';

  const images = slideNames.length
    ? await imagesForSlide(zip, slideNames[0], maxImageBytes, budget, readText)
    : [];

  return {
    slides,
    slideCount: slideNames.length,
    metadata: {
      title: tagText(core, 'dc:title'),
      author: tagText(core, 'dc:creator') || tagText(app, 'Company'),
      subject: tagText(core, 'dc:subject'),
      keywords: tagText(core, 'cp:keywords'),
      lastModifiedBy: tagText(core, 'cp:lastModifiedBy'),
      created: tagText(core, 'dcterms:created'),
    },
    images,
  };
}

/**
 * The images a given slide references, largest first.
 *
 * Largest first because a title slide typically carries one big rendered image
 * plus small logos or bullets; the big one is the slide.
 */
async function imagesForSlide(zip, slidePart, maxImageBytes, budget, readText) {
  const relsPath = slidePart.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
  const relsFile = zip.files[relsPath];

  /** @type {string[]} */
  let targets = [];
  if (relsFile) {
    const rels = await readText(relsFile);
    const pattern = /Target="([^"]+)"/g;
    let match = pattern.exec(rels);
    while (match) {
      if (/\.(png|jpe?g|gif|webp)$/i.test(match[1])) targets.push(match[1]);
      match = pattern.exec(rels);
    }
  }

  // Relationship targets are relative to ppt/slides/ — "../media/image1.png".
  const resolved = targets
    .map((target) => `ppt/${target.replace(/^\.\.\//, '')}`)
    .filter((path) => zip.files[path]);

  // No relationships parsed (an unusual package layout): fall back to the
  // media folder so an image-only deck is still recoverable.
  const candidates = resolved.length
    ? resolved
    : Object.keys(zip.files).filter((name) => /^ppt\/media\/image\d+\.(png|jpe?g|gif|webp)$/i.test(name));

  const images = [];
  for (const path of candidates) {
    const file = zip.files[path];
    if (!file) continue;
    // Inflate at most one byte past the image limit: an oversized image is
    // skipped without ever being fully decompressed.
    let data;
    try {
      data = await readCapped(file, budget, maxImageBytes + 1);
    } catch (error) {
      if (error instanceof ExtractionLimitError && error.code === 'PART_TOO_LARGE') continue;
      throw error;
    }
    if (!data.length || data.length > maxImageBytes) continue;
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    images.push({
      path,
      mediaType: IMAGE_TYPES[extension] ?? 'application/octet-stream',
      size: data.length,
      data,
    });
  }

  return images.sort((a, b) => b.size - a.size).slice(0, 3);
}
