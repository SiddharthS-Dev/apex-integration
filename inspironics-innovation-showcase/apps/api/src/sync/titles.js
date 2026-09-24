/**
 * Title resolution — deciding what a file is called in the catalog.
 *
 * Candidates, best first:
 *   seed      curated metadata carried over from the original showcase corpus
 *   metadata  the title embedded in the document (pptx core.xml, PDF /Title, <title>)
 *   content   the first meaningful line of extracted text
 *   model     the classifier's reading of the text
 *   vision    the classifier's reading of the rendered image (image-only files)
 *   filename  the file name, tidied
 *
 * A candidate is rejected if it is no better than the filename: template
 * boilerplate ("PowerPoint Presentation", "Slide 1"), a restatement of the
 * filename, or too short to mean anything. Keeping the filename beats
 * accepting a bad title.
 */

const GENERIC = [
  /^(untitled|title|presentation|slide|document|new document|microsoft (word|powerpoint)|powerpoint presentation)\b/i,
  /^(click to (add|edit)|add title|slide \d+|page \d+)/i,
  /^(img|dsc|image|scan|screenshot)[\s_-]*\d*$/i,
  /^[\d\s._-]+$/,
  /\.(pptx?|pdf|html?|jpe?g|png|webp|docx?)$/i,
]

/** "IMG_0557.jpg" -> "IMG 0557"; "q3-grid_ops review.pptx" -> "Q3 Grid Ops Review" */
export function humaniseFilename(name) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '')
  const spaced = base.replace(/[_]+/g, ' ').replace(/(?<=[a-z])-(?=[a-z])/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!/[a-z]{3}/i.test(spaced) || /^[A-Za-z0-9_-]{16,}$/.test(base)) return spaced || base
  return spaced.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** True when `title` adds nothing over the filename. */
export function isNoBetterThanFilename(title, filename) {
  const t = String(title || '').trim()
  if (t.length < 4 || t.length > 160) return true
  if (!/[a-z]{3}/i.test(t)) return true
  if (GENERIC.some((re) => re.test(t))) return true
  const n = norm(t)
  const f = norm(String(filename).replace(/\.[a-z0-9]+$/i, ''))
  return n === f || (f.length > 6 && n.includes(f))
}

/** First line of body text that reads like a heading. */
export function firstMeaningfulLine(text) {
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\[Slide \d+\]$/, '').trim()
    if (line.length < 6 || line.length > 120) continue
    if (!/[a-z]{3}/i.test(line)) continue
    if (/^(confidential|draft|www\.|https?:|©|copyright)/i.test(line)) continue
    if (GENERIC.some((re) => re.test(line))) continue
    return line.replace(/\s+/g, ' ')
  }
  return ''
}

/**
 * @param {{ filename: string, seed?: string, metadata?: string, text?: string, model?: string, vision?: string }} c
 * @returns {{ title: string, source: string }}
 */
export function resolveTitle({ filename, seed, metadata, text, model, vision }) {
  const candidates = [
    ['seed', seed],
    ['metadata', metadata],
    ['content', firstMeaningfulLine(text)],
    ['model', model],
    ['vision', vision],
  ]
  for (const [source, title] of candidates) {
    if (title && !isNoBetterThanFilename(title, filename)) return { title: title.trim().slice(0, 160), source }
  }
  return { title: humaniseFilename(filename), source: 'filename' }
}
