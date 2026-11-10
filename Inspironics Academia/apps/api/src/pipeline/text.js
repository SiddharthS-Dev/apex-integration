import JSZip from 'jszip';
// The package index runs a debug harness when imported directly — always use the lib entry.
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { createRequire } from 'node:module';
import { config } from '../config.js';

// pdf-parse require()s its pdf.js build lazily, on the first parse. Load it at startup instead: a
// module first loaded mid-run makes `node --watch` restart the server (killing that run on Windows),
// and it saves the first extraction the load time. Must match pdf-parse's default version.
createRequire(import.meta.url)('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
import { HttpError } from '../lib/errors.js';

// Text extraction for playbook source files (PDF / DOCX / plain text).
//   extractText(playbook, buffer) → { kind, text, info: { title, author, organization, subject } }

export function decodeXmlEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function normalizeText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function detectFileType(playbook = {}, buf) {
  const ft = String(playbook.file_type || '').toLowerCase();
  const name = String(playbook.file_name || playbook.file_url || '').toLowerCase().split('?')[0];
  if (ft.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (ft.includes('docx') || ft.includes('wordprocessingml') || ft.includes('msword') || name.endsWith('.docx')) return 'docx';
  if (ft.includes('pptx') || ft.includes('presentationml') || name.endsWith('.pptx')) return 'pptx';
  if (ft === 'csv' || ft === 'text/csv' || name.endsWith('.csv')) return 'text';
  if (ft.startsWith('text/') || ft === 'txt' || ft === 'md' || name.endsWith('.txt') || name.endsWith('.md')) return 'text';
  // Formats that need OCR or transcription, which are not configured: say so instead of failing silently.
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name)) throw new HttpError(415, 'Images need OCR to extract text, which is not configured. Use a PDF, Word, PowerPoint or text document.');
  if (/\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a)$/.test(name)) throw new HttpError(415, 'Audio and video need transcription, which is not configured. Use a document, or a meeting transcript (.docx/.vtt).');
  if (/\.(ppt|doc|xls|xlsx)$/.test(name)) throw new HttpError(415, 'Legacy Office formats (.ppt/.doc) and spreadsheets are not supported. Save the file as PDF, DOCX or PPTX.');
  // Fall back to magic bytes.
  const b = buf ? buf.subarray(0, 4) : [];
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b) return 'docx'; // PK (zip)
  throw new HttpError(415, `Unsupported file type "${playbook.file_type || name}". Use a PDF, DOCX, PPTX, TXT, MD or CSV file.`);
}

export function assertExtractSize(buf) {
  const limit = config.maxExtractMb * 1024 * 1024;
  if (buf.length > limit) {
    const mb = (buf.length / 1024 / 1024).toFixed(1);
    throw new HttpError(413, `File is ${mb} MB, which exceeds the extraction limit of ${config.maxExtractMb} MB (MAX_EXTRACT_MB).`);
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export async function extractPdf(buf) {
  const data = await pdf(buf);
  const info = data?.info || {};
  return {
    text: normalizeText(data?.text || ''),
    info: { title: str(info.Title), author: str(info.Author), organization: str(info.Company), subject: str(info.Subject) },
  };
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1].replace(/<[^>]+>/g, '')).trim() : '';
}

// ---- DOCX body ----------------------------------------------------------------------------
// Word stores more than the visible text: field instructions (`TOC \o "1-3" \h`, `PAGEREF _Toc… \h`)
// sit in <w:instrText>, tracked deletions in <w:del>, and the table of contents is a run of
// paragraphs that repeat every heading. Taking all text naively turns those into fake chapter
// titles, so they are dropped here, and each table row becomes one line ("cell | cell") so a lone
// cell such as "Part VII" cannot pass for a heading.

const TOC_STYLE = /^(?:TOC\d*|TOCHeading|TableofFigures|TableOfFigures)$/i;

/** Visible text of one paragraph's XML (field instructions and deleted text removed). */
function docxParagraphText(xml) {
  return xml
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)(?:\s[^>]*)?\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
}

/** A table-of-contents entry: a TOC paragraph style, or a link/page reference to a _Toc bookmark. */
function isDocxTocParagraph(xml) {
  const style = (xml.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';
  if (TOC_STYLE.test(style)) return true;
  const pointsAtToc = /<w:hyperlink\b[^>]*w:anchor="_Toc/.test(xml)
    || /<w:instrText\b[^>]*>[^<]*(?:PAGEREF|HYPERLINK\s+\\l)\s+"?_Toc/i.test(xml);
  // Body cross-references to a heading are longer prose; TOC entries are short lines.
  return pointsAtToc && docxParagraphText(xml).trim().length <= 200;
}

/** Paragraph XML chunks in document order (split at </w:p> so nested text boxes lose nothing). */
function docxParagraphs(xml) {
  return xml.split(/<\/w:p>/);
}

export function docxBodyText(documentXml) {
  let body = (documentXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/) || [null, documentXml])[1];
  body = body.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');
  body = body.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (row) => {
    if (/<w:tbl[ >]/.test(row)) return row; // nested table: keep its paragraphs as they are
    const cells = (row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || [])
      .map((cell) => docxParagraphs(cell)
        .filter((p) => !isDocxTocParagraph(p))
        .map((p) => docxParagraphText(p).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' '))
      .filter(Boolean);
    // The cell text is still XML-escaped here, so it can go straight into a text run.
    return cells.length ? `<w:p><w:r><w:t>${cells.join(' | ')}</w:t></w:r></w:p>` : '';
  });
  return docxParagraphs(body)
    .filter((p) => !isDocxTocParagraph(p))
    .map(docxParagraphText)
    .join('\n');
}

export async function extractDocx(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new HttpError(422, 'Invalid DOCX: the file is not a readable Word document');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new HttpError(422, 'Invalid DOCX: word/document.xml not found');
  const body = docxBodyText(await docFile.async('string'));

  const core = zip.file('docProps/core.xml') ? await zip.file('docProps/core.xml').async('string') : '';
  const app = zip.file('docProps/app.xml') ? await zip.file('docProps/app.xml').async('string') : '';
  return {
    text: normalizeText(decodeXmlEntities(body)),
    info: {
      title: core ? xmlTag(core, 'dc:title') : '',
      author: core ? xmlTag(core, 'dc:creator') : '',
      organization: app ? xmlTag(app, 'Company') : '',
      subject: core ? xmlTag(core, 'dc:subject') : '',
    },
  };
}

/** PowerPoint (PPTX): the text of every slide in order, with its speaker notes. */
export async function extractPptx(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new HttpError(422, 'Invalid PPTX: the file is not a readable PowerPoint presentation');
  }
  const order = (name) => Number(/(\d+)\.xml$/.exec(name)?.[1] || 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => order(a) - order(b));
  if (!slides.length) throw new HttpError(422, 'Invalid PPTX: no slides found');
  const textOf = (xml) => decodeXmlEntities(xml.replace(/<\/a:p>/g, '\n').replace(/<a:br\s*\/>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{2,}/g, '\n').trim();
  const parts = [];
  for (const [i, name] of slides.entries()) {
    const body = textOf(await zip.file(name).async('string'));
    const notesFile = zip.file(name.replace('slides/slide', 'notesSlides/notesSlide'));
    const notes = notesFile ? textOf(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    parts.push(`Slide ${i + 1}\n${body}${notes ? `\nNotes: ${notes}` : ''}`);
  }
  const core = zip.file('docProps/core.xml') ? await zip.file('docProps/core.xml').async('string') : '';
  return {
    text: normalizeText(parts.join('\n\n')),
    info: { title: core ? xmlTag(core, 'dc:title') : '', author: core ? xmlTag(core, 'dc:creator') : '', organization: '', subject: core ? xmlTag(core, 'dc:subject') : '' },
  };
}

export async function extractText(playbook, buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  assertExtractSize(buf);
  const kind = detectFileType(playbook, buf);
  let out;
  if (kind === 'pdf') out = await extractPdf(buf);
  else if (kind === 'docx') out = await extractDocx(buf);
  else if (kind === 'pptx') out = await extractPptx(buf);
  else out = { text: normalizeText(new TextDecoder().decode(buf)), info: { title: '', author: '', organization: '', subject: '' } };
  return { kind, ...out };
}
