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
export async function extractPptx(buffer, { maxImageBytes = 5 * 1024 * 1024, maxSlides = 200 } = {}) {
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideOrder(a) - slideOrder(b))
    .slice(0, maxSlides);

  const slides = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    slides.push({ index: slides.length + 1, part: name, runs: textRunsFromSlideXml(xml) });
  }

  const core = zip.files['docProps/core.xml'] ? await zip.files['docProps/core.xml'].async('string') : '';
  const app = zip.files['docProps/app.xml'] ? await zip.files['docProps/app.xml'].async('string') : '';

  const images = slideNames.length
    ? await imagesForSlide(zip, slideNames[0], maxImageBytes)
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
async function imagesForSlide(zip, slidePart, maxImageBytes) {
  const relsPath = slidePart.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
  const relsFile = zip.files[relsPath];

  /** @type {string[]} */
  let targets = [];
  if (relsFile) {
    const rels = await relsFile.async('string');
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
    const data = await file.async('nodebuffer');
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
