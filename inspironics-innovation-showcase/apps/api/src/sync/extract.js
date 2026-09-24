/**
 * Content extraction: embedded metadata title plus body text, per file type.
 *
 *   .pptx  a ZIP archive — docProps/core.xml for the title, ppt/slides/*.xml
 *          for the text, slide order preserved (JSZip)
 *   .pdf   the Info dictionary /Title, and text drawn by Tj/TJ operators in
 *          Flate-compressed content streams (node:zlib) — no PDF library;
 *          good enough to title and classify, not a faithful renderer
 *   .html  <title>, then visible text
 *   images width/height from the header bytes; no text (vision does that)
 *
 * Everything here is pure: bytes in, `{ metadataTitle, text, width, height }` out.
 */
import { inflateSync } from 'node:zlib'
import JSZip from 'jszip'

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

const squash = (s) => s.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()

/* ------------------------------------------------------------- pptx ------ */

export async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const core = await zip.file('docProps/core.xml')?.async('string')
  const metadataTitle = core ? decodeEntities(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] || '').trim() : ''

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  const slides = []
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string')
    // one line per paragraph, runs within a paragraph joined
    const paragraphs = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1])).join(''))
    slides.push(paragraphs.map((p) => p.trim()).filter(Boolean).join('\n'))
  }
  return { metadataTitle, text: slides.map((s, i) => `[Slide ${i + 1}]\n${s}`).join('\n\n'), slideCount: slides.length }
}

/* -------------------------------------------------------------- pdf ------ */

/** A PDF string object — (literal) or <hex> — to text, handling UTF-16BE with BOM. */
export function decodePdfString(raw) {
  let bytes
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '')
    bytes = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex')
  } else {
    const body = raw.slice(1, -1)
    const out = []
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c !== '\\') {
        out.push(c.charCodeAt(0) & 0xff)
        continue
      }
      const n = body[++i]
      const map = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }
      if (n in map) out.push(map[n])
      else if (/[0-7]/.test(n)) {
        let oct = n
        while (oct.length < 3 && /[0-7]/.test(body[i + 1])) oct += body[++i]
        out.push(parseInt(oct, 8) & 0xff)
      } else if (n === '\r' || n === '\n') {
        if (n === '\r' && body[i + 1] === '\n') i++
      } else out.push(n.charCodeAt(0))
    }
    bytes = Buffer.from(out)
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const le = Buffer.from(bytes.subarray(2))
    for (let i = 0; i + 1 < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]]
    return le.toString('utf16le')
  }
  return bytes.toString('latin1')
}

const PDF_STRING = /\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>/g

export function extractPdf(buffer, { maxStreams = 400 } = {}) {
  const latin = buffer.toString('latin1')

  let metadataTitle = ''
  const info = /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)/.exec(latin)
  if (info) metadataTitle = decodePdfString(info[1]).replace(/\0/g, '').trim()

  const lines = []
  const streamRe = /<<([^]*?)>>\s*stream\r?\n/g
  let m
  let seen = 0
  while ((m = streamRe.exec(latin)) && seen < maxStreams) {
    const dict = m[1]
    const start = m.index + m[0].length
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    streamRe.lastIndex = end
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject/.test(dict)) continue
    seen++
    let data = buffer.subarray(start, end)
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data)
      } catch {
        continue
      }
    } else if (/\/Filter/.test(dict)) continue
    const content = data.toString('latin1')
    if (!/T[Jj]/.test(content)) continue
    for (const block of content.split(/\bET\b/)) {
      const parts = []
      for (const op of block.matchAll(/(\[(?:[^\]\\]|\\.)*\]|\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)\s*(TJ|Tj|'|")/g)) {
        const strings = op[1].startsWith('[') ? op[1].match(PDF_STRING) || [] : [op[1]]
        parts.push(strings.map(decodePdfString).join(''))
      }
      const line = parts.join(' ').replace(/[\0-\x08\x0b-\x1f]/g, '').trim()
      if (line) lines.push(line)
    }
  }
  return { metadataTitle, text: squash(lines.join('\n')) }
}

/* ------------------------------------------------------------- html ------ */

export function extractHtml(buffer) {
  const html = buffer.toString('utf8')
  const metadataTitle = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim()
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
  return { metadataTitle, text: squash(text) }
}

/* ----------------------------------------------------------- images ------ */

/** Width/height from JPEG, PNG, GIF or WebP header bytes, or null. */
export function imageSize(buf) {
  if (!buf || buf.length < 12) return null
  // PNG
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  // GIF
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  // WebP
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }
    }
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    return null
  }
  // JPEG: walk the markers to the first start-of-frame
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}

/** Dispatch by extension. Returns null for kinds with no text to extract. */
export async function extractContent(ext, buffer) {
  if (ext === 'pptx') return extractPptx(buffer)
  if (ext === 'pdf') return extractPdf(buffer)
  if (ext === 'html') return extractHtml(buffer)
  return null
}
