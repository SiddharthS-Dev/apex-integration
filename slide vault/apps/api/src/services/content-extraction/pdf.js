/**
 * PDF extraction.
 *
 * Two tiers, in order of quality:
 *  1. pdfjs-dist, when it is installed — real first-page text.
 *  2. the document's /Title in the Info dictionary, scanned out of the raw
 *     bytes. Crude, but it costs nothing and rescues the common case of a
 *     deck exported from Keynote or PowerPoint, where the real title is in the
 *     metadata even though the filename is "Untitled (3).pdf".
 *
 * pdfjs is an optional dependency: a deployment that does not install it still
 * runs, it just falls back to tier 2 and then to the vision path.
 */

let pdfjsPromise;

/** Loads pdfjs once, or resolves null when it is not installed. */
async function loadPdfjs() {
  if (pdfjsPromise === undefined) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((module) => module)
      .catch(() => null);
  }
  return pdfjsPromise;
}

/** Test seam — lets the unit tests exercise both tiers without the package. */
export function __setPdfjsLoader(loader) {
  pdfjsPromise = loader ? loader() : undefined;
}

/**
 * PDF text strings marked with a BOM are UTF-16 **big**-endian; Node only
 * decodes little-endian, so the byte pairs are swapped first. Without this,
 * "Q3" comes back as "儀㌀".
 */
function decodeUtf16BE(bytes) {
  const body = bytes.subarray(2);
  // swap16 needs an even length and mutates in place, so work on a copy.
  const copy = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
  return copy.swap16().toString('utf16le').replace(/\0/g, '');
}

/**
 * Decodes a PDF string object: literal `(…)` with escapes, or hex `<…>`.
 * UTF-16BE is detected by its byte-order mark, which is how Acrobat writes
 * anything non-ASCII.
 */
export function decodePdfString(raw) {
  if (!raw) return '';

  if (raw.startsWith('<') && raw.endsWith('>')) {
    const hex = raw.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
    const bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16BE(bytes);
    return bytes.toString('latin1');
  }

  const body = raw.startsWith('(') ? raw.slice(1, -1) : raw;
  const unescaped = body
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(Number.parseInt(oct, 8)));

  const bytes = Buffer.from(unescaped, 'latin1');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16BE(bytes);
  return unescaped;
}

/** Scans the raw bytes for the document's /Title and /Author. */
export function scanDocumentInfo(buffer) {
  // Only the tail and head are searched: the Info dictionary lives near the
  // trailer, and scanning a 200 MB file end to end for a title is not worth it.
  const head = buffer.subarray(0, Math.min(buffer.length, 200_000)).toString('latin1');
  const tail = buffer.subarray(Math.max(0, buffer.length - 400_000)).toString('latin1');
  const haystack = `${head}\n${tail}`;

  const read = (key) => {
    const pattern = new RegExp(`/${key}\\s*(\\((?:[^()\\\\]|\\\\.)*\\)|<[0-9a-fA-F\\s]*>)`);
    const match = pattern.exec(haystack);
    return match ? decodePdfString(match[1]).trim() : '';
  };

  return { title: read('Title'), author: read('Author'), subject: read('Subject') };
}

/**
 * Extracts text from the first pages of a PDF.
 *
 * @param {Buffer} buffer
 * @param {{maxPages?: number}} [options]
 */
export async function extractPdf(buffer, { maxPages = 3 } = {}) {
  const info = scanDocumentInfo(buffer);
  const result = {
    pages: [],
    pageCount: 0,
    metadata: { title: info.title, author: info.author, subject: info.subject },
    extractor: 'metadata',
  };

  const pdfjs = await loadPdfjs();
  if (!pdfjs) return result;

  let document;
  try {
    document = await pdfjs.getDocument({
      // pdfjs mutates the buffer it is given; hand it a copy.
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch {
    // A password-protected or malformed PDF is not a sync failure — the
    // metadata tier above may still have produced a usable title.
    return result;
  }

  try {
    result.pageCount = document.numPages;
    result.extractor = 'pdfjs';

    for (let pageNumber = 1; pageNumber <= Math.min(maxPages, document.numPages); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean);
      result.pages.push({ index: pageNumber, lines: joinTextItems(items) });
      page.cleanup?.();
    }

    const metadata = await document.getMetadata().catch(() => null);
    if (metadata?.info?.Title && !result.metadata.title) result.metadata.title = String(metadata.info.Title).trim();
    if (metadata?.info?.Author && !result.metadata.author) result.metadata.author = String(metadata.info.Author).trim();
  } finally {
    await document.destroy?.().catch(() => {});
  }

  return result;
}

/**
 * pdfjs yields one item per text run, which for a title is often one item per
 * glyph group. Runs are joined, and a run that is clearly a separate line is
 * kept separate so the first *line* is identifiable.
 */
function joinTextItems(items) {
  const lines = [];
  let current = '';
  for (const item of items) {
    if (!item.trim()) {
      if (current.trim()) {
        lines.push(current.trim());
        current = '';
      }
      continue;
    }
    current += current && !current.endsWith(' ') && !item.startsWith(' ') ? ' ' : '';
    current += item;
  }
  if (current.trim()) lines.push(current.trim());
  return lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
