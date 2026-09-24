/**
 * HTML extraction.
 *
 * Exported presentations (Gamma, reveal.js, Marp) are often a single HTML file.
 * What matters is the visible text in reading order, with the obvious title
 * candidates — <title>, og:title, the first <h1> — kept distinct so the title
 * resolver can prefer them over body copy.
 *
 * Hand-rolled rather than a DOM parser: the input is untrusted content from a
 * synced folder, and a regex scanner that only ever *reads* cannot be made to
 * execute anything.
 */

const decodeEntities = (value) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, '&');

const clean = (value) => decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim();

/**
 * Like clean(), but newlines survive.
 *
 * Block boundaries are turned into newlines before the tags are stripped, and
 * collapsing *all* whitespace would immediately undo that — running every
 * paragraph of a deck into one unbroken line, which is exactly what the title
 * resolver needs kept apart.
 */
const cleanPreservingLines = (value) =>
  decodeEntities(String(value ?? ''))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

/** Content of a meta tag matched by property or name. */
function metaContent(html, key) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
    'i'
  );
  const tag = pattern.exec(html)?.[0];
  if (!tag) return '';
  return clean(/content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '');
}

/**
 * @param {Buffer|string} input
 * @param {{maxTextLength?: number}} [options]
 */
export function extractHtml(input, { maxTextLength = 20_000 } = {}) {
  const html = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');

  // Strip the parts that are never visible to a reader before anything else,
  // otherwise a script body ends up in the "visible text".
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');

  const documentTitle = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const ogTitle = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  const description = metaContent(html, 'description') || metaContent(html, 'og:description');
  const author = metaContent(html, 'author');

  const headings = [];
  const headingPattern = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match = headingPattern.exec(stripped);
  while (match && headings.length < 20) {
    const text = clean(match[2].replace(/<[^>]+>/g, ' '));
    if (text) headings.push({ level: Number(match[1]), text });
    match = headingPattern.exec(stripped);
  }

  // Block-level tags become line breaks so sentences from different blocks do
  // not run together into one meaningless wall of text.
  const text = cleanPreservingLines(
    stripped
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).slice(0, maxTextLength);

  return {
    metadata: { title: ogTitle || documentTitle, documentTitle, ogTitle, description, author },
    headings,
    text,
    lines: text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}
