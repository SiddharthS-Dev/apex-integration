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
  if (ft.startsWith('text/') || ft === 'txt' || ft === 'md' || name.endsWith('.txt') || name.endsWith('.md')) return 'text';
  // Fall back to magic bytes.
  const b = buf ? buf.subarray(0, 4) : [];
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b) return 'docx'; // PK (zip)
  throw new HttpError(415, `Unsupported file type "${playbook.file_type || name}". Upload a PDF or DOCX file.`);
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

export async function extractDocx(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new HttpError(422, 'Invalid DOCX: the file is not a readable Word document');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new HttpError(422, 'Invalid DOCX: word/document.xml not found');
  const xml = await docFile.async('string');
  const body = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(?:br|cr)(?:\s[^>]*)?\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');

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

export async function extractText(playbook, buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  assertExtractSize(buf);
  const kind = detectFileType(playbook, buf);
  let out;
  if (kind === 'pdf') out = await extractPdf(buf);
  else if (kind === 'docx') out = await extractDocx(buf);
  else out = { text: normalizeText(new TextDecoder().decode(buf)), info: { title: '', author: '', organization: '', subject: '' } };
  return { kind, ...out };
}
