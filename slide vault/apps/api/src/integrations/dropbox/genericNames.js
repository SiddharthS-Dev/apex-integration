/**
 * Generic-filename detection and title validation.
 *
 * Two questions, deliberately separate:
 *  - isGenericName(): does this filename carry no information, so the file
 *    deserves the expensive content-based title pipeline?
 *  - isAcceptableTitle(): is a *derived* title good enough to replace the
 *    filename, or would it be worse than what we already had?
 *
 * The second is the one that protects users: a hallucinated or empty title is
 * strictly worse than a boring filename, so the bar is "clearly better or
 * don't bother" (spec §37).
 */
import { stripExtension } from './paths.js';

/** Filenames that tools generate when nobody chose a name. */
const GENERIC_PATTERNS = [
  /^untitled\b/i,
  /^untitled\s*\(\d+\)$/i,
  /^new[\s_-]*(presentation|document|deck|file|slide[s]?)\b/i,
  /^presentation\s*\(?\d*\)?$/i,
  /^document\s*\(?\d*\)?$/i,
  /^deck\s*\(?\d*\)?$/i,
  /^slides?\s*\(?\d*\)?$/i,
  /^copy of\b/i,
  /^final\s*\(?\d*\)?$/i,
  /^draft\s*\(?\d*\)?$/i,
  /^\d{4}[-_.]?\d{2}[-_.]?\d{2}$/,            // a bare date
  /^(img|image|scan|export|download|file)[\s_-]*\d*$/i,
  /^[0-9a-f]{16,}$/i,                          // a hash or an id
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // a uuid
  /^gamma[\s_-]*\d*$/i,                        // Gamma's default export name
];

/** True when the filename tells a reader nothing about the content. */
export function isGenericName(name) {
  const base = stripExtension(String(name ?? '')).trim();
  if (!base) return true;
  if (base.length < 3) return true;
  // All digits, punctuation or separators — no words at all.
  if (!/[a-z]/i.test(base)) return true;
  return GENERIC_PATTERNS.some((pattern) => pattern.test(base));
}

/** Titles a model might produce that carry no more meaning than "Untitled". */
const REJECTED_TITLES = new Set([
  'untitled',
  'untitled presentation',
  'presentation',
  'presentation title',
  'slide',
  'slide 1',
  'slide one',
  'title slide',
  'unknown',
  'unknown title',
  'document',
  'no title',
  'none',
  'n/a',
  'na',
  'title',
  'the title',
  'deck',
  'slides',
  'image',
  'text',
  'untitled document',
]);

/** Phrases that mean the model failed but answered anyway. */
const REFUSAL_MARKERS = [
  /\bi (?:cannot|can't|am unable to|could not)\b/i,
  /\bno (?:visible |readable |discernible )?(?:title|text)\b/i,
  /\bunable to (?:determine|read|extract)\b/i,
  /\bas an ai\b/i,
  /\bthe image (?:shows|contains)\b/i,
  /\bbased on the (?:slide|image|document)\b/i,
];

/**
 * A title longer than this is a sentence, not a title — the model explained
 * the deck instead of naming it. Real deck titles run two to ten words; the
 * ceiling leaves room for a subtitle without admitting whole paragraphs.
 */
export const MAX_TITLE_WORDS = 14;

/**
 * Decides whether a derived title may replace the current name.
 *
 * @param {string} candidate
 * @param {{originalName?: string}} [context]
 * @returns {{ok: boolean, title?: string, reason?: string}}
 */
export function validateTitle(candidate, { originalName = '' } = {}) {
  const raw = String(candidate ?? '')
    // Models like to wrap a title in quotes or prefix it with "Title:".
    .replace(/^\s*(?:title|the title (?:is|would be))\s*[:\-—]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length < 4) return { ok: false, reason: 'too_short' };
  if (raw.length > 160) return { ok: false, reason: 'too_long' };
  // Checked before the generic test so a numeric string reports the precise
  // reason rather than the catch-all one.
  if (!/[a-z]/i.test(raw)) return { ok: false, reason: 'no_letters' };
  if (raw.split(/\s+/).length > MAX_TITLE_WORDS) return { ok: false, reason: 'too_long' };
  if (REJECTED_TITLES.has(raw.toLowerCase())) return { ok: false, reason: 'generic' };
  if (isGenericName(raw)) return { ok: false, reason: 'generic' };
  if (REFUSAL_MARKERS.some((pattern) => pattern.test(raw))) return { ok: false, reason: 'refusal' };

  // No improvement: identical to the filename we were trying to replace.
  if (originalName && raw.toLowerCase() === stripExtension(originalName).trim().toLowerCase()) {
    return { ok: false, reason: 'unchanged' };
  }

  return { ok: true, title: raw };
}

/**
 * Tidies a title that came from a filename — the fallback when nothing better
 * can be derived. Separators become spaces, but real words are left alone.
 */
export function titleFromFileName(name) {
  const base = stripExtension(String(name ?? '')).trim();
  if (!base) return 'Untitled';
  return base
    .replace(/[_]+/g, ' ')
    .replace(/(?<=\w)-(?=\w)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
