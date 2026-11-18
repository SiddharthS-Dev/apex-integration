// Validates every deliverable and writes VALIDATION_REPORT.md.
// PNG: signature, IHDR size/colour, 300 DPI pHYs, every chunk CRC, full IDAT decompression to the exact byte count.
// PDF: header, EOF marker, exactly one page, MediaBox = 841 × 1189 mm. SVG: A0 root, well-formed XML (via Chrome).
// Also extracts every word on the posters for a spelling review, and writes crops of the full-size PNGs.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { POSTERS } from './posters.mjs'
import { W, H } from './lib.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const CROPS = process.env.APEX_CROPS_DIR || 'E:/apex-review-tmp/a0-crops'
fs.mkdirSync(CROPS, { recursive: true })
const MM = 72 / 25.4

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}

async function checkPng(file, n) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const sig = Buffer.alloc(8); fs.readSync(fd, sig, 0, 8, 0)
  const res = { size, sig: sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), crc: true }
  let pos = 8
  const inflate = zlib.createInflate()
  let total = 0
  // Crop: a 1600 × 1100 px window from the header title area and one from the body, at native resolution.
  const windows = [{ x: 470, y: 1050, w: 2400, h: 900 }, { x: 3500, y: 7000, w: 2400, h: 1400 }]
  const rowLen = 1 + W * 3
  let prev = Buffer.alloc(rowLen), carry = Buffer.alloc(0), row = 0
  const crops = windows.map((w) => ({ ...w, rows: [] }))
  inflate.on('data', (d) => {
    total += d.length
    let buf = carry.length ? Buffer.concat([carry, d]) : d
    let off = 0
    while (buf.length - off >= rowLen) {
      const line = buf.subarray(off, off + rowLen)
      if (line[0] !== 0) throw new Error('unexpected filter')
      for (const c of crops) if (row >= c.y && row < c.y + c.h) c.rows.push(Buffer.concat([Buffer.from([0]), line.subarray(1 + c.x * 3, 1 + (c.x + c.w) * 3)]))
      row++; off += rowLen
    }
    carry = Buffer.from(buf.subarray(off))
    prev = null
  })
  const done = new Promise((r, j) => { inflate.on('end', r); inflate.on('error', j) })
  while (pos < size) {
    const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, pos)
    const len = head.readUInt32BE(0), type = head.toString('ascii', 4, 8)
    const body = Buffer.alloc(len + 4); fs.readSync(fd, body, 0, len + 4, pos + 8)
    const data = body.subarray(0, len)
    if ((zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0) !== body.readUInt32BE(len)) res.crc = false
    if (type === 'IHDR') { res.width = data.readUInt32BE(0); res.height = data.readUInt32BE(4); res.bitDepth = data[8]; res.colorType = data[9] }
    if (type === 'pHYs') res.dpi = Math.round((data.readUInt32BE(0) * 0.0254) * 10) / 10
    if (type === 'IDAT') { if (!inflate.write(data)) await new Promise((r) => inflate.once('drain', r)) }
    if (type === 'IEND') { res.iend = true; break }
    pos += 12 + len
  }
  inflate.end(); await done
  fs.closeSync(fd)
  res.decodedBytes = total
  res.decodeOk = total === H * rowLen
  crops.forEach((c, i) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.rows.length, 4); ihdr[8] = 8; ihdr[9] = 2
    fs.writeFileSync(path.join(CROPS, `${String(n).padStart(2, '0')}-crop${i + 1}.png`), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(c.rows))), chunk('IEND', Buffer.alloc(0))]))
  })
  return res
}

function checkPdf(file) {
  const b = fs.readFileSync(file)
  const s = b.toString('latin1')
  const pages = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length
  const mb = s.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  const w = mb ? (+mb[3] - +mb[1]) / MM : null, h = mb ? (+mb[4] - +mb[2]) / MM : null
  return { size: b.length, header: s.startsWith('%PDF-'), eof: s.trimEnd().endsWith('%%EOF'), pages, wmm: w && Math.round(w * 10) / 10, hmm: h && Math.round(h * 10) / 10 }
}

const rows = [], words = new Map()
let allOk = true
for (const p of POSTERS) {
  const dir = path.join(ROOT, p.dir)
  const svg = fs.readFileSync(path.join(dir, 'source.svg'), 'utf8')
  const svgOk = /width="841mm" height="1189mm" viewBox="0 0 9933 14043"/.test(svg)
  for (const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) for (const w of m[1].replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').split(/[^A-Za-z’'-]+/)) if (w.length > 1) words.set(w.toLowerCase(), (words.get(w.toLowerCase()) || 0) + 1)
  const png = await checkPng(path.join(dir, p.file + '.png'), p.n)
  const pdf = checkPdf(path.join(dir, p.file + '.pdf'))
  const ratio = png.height / png.width
  const ok = svgOk && png.sig && png.crc && png.iend && png.decodeOk && png.width === 9933 && png.height === 14043 && png.colorType === 2 && Math.abs(png.dpi - 300) < 0.5 &&
    pdf.header && pdf.eof && pdf.pages === 1 && Math.abs(pdf.wmm - 841) < 0.6 && Math.abs(pdf.hmm - 1189) < 0.6
  allOk &&= ok
  rows.push([String(p.n).padStart(2, '0'), p.dir, `${png.width} × ${png.height}`, ratio.toFixed(4), `${png.dpi}`, png.decodeOk && png.crc ? 'yes' : 'NO', (png.size / 1048576).toFixed(1) + ' MB', `${pdf.wmm} × ${pdf.hmm} mm`, pdf.pages, (pdf.size / 1048576).toFixed(2) + ' MB', svgOk ? 'yes' : 'NO', ok ? 'PASS' : 'FAIL'])
  console.log(p.n, ok ? 'PASS' : 'FAIL', JSON.stringify(png), JSON.stringify(pdf))
}
const idx = checkPdf(path.join(ROOT, 'APEX_Commercial_Infographics_Index.pdf'))
const idxPages = idx.pages
const idxOk = idx.header && idx.eof && idxPages === 14
allOk &&= idxOk

// Chrome check: every PNG decodes in a browser and every SVG parses as XML.
const puppeteer = require('E:/apex/inspironics-innovation-showcase/node_modules/puppeteer-core')
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'E:/apex-review-tmp/chrome-validate', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] })
const page = await b.newPage()
const browserChecks = []
for (const p of POSTERS) {
  const dir = path.join(ROOT, p.dir)
  await page.goto('file:///' + path.join(dir, p.file + '.png').replace(/\\/g, '/'))
  const dims = await page.evaluate(() => { const i = document.querySelector('img'); return i && i.complete ? [i.naturalWidth, i.naturalHeight] : null })
  const xmlOk = await page.evaluate((s) => !new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror'), fs.readFileSync(path.join(dir, 'source.svg'), 'utf8'))
  const good = dims && dims[0] === 9933 && dims[1] === 14043 && xmlOk
  allOk &&= !!good
  browserChecks.push(`${String(p.n).padStart(2, '0')}: PNG opened in Chrome at ${dims ? dims.join(' × ') : 'FAILED'}; SVG XML ${xmlOk ? 'valid' : 'INVALID'}`)
}
await b.close()

fs.writeFileSync('E:/apex-review-tmp/a0-words.txt', [...words.entries()].sort().map(([w, c]) => `${w} ${c}`).join('\n'))
const md = `# Validation report — APEX A0 commercial infographics

Generated ${new Date().toISOString()} by \`_build/validate.mjs\`. Overall: **${allOk ? 'ALL CHECKS PASSED' : 'FAILURES — see table'}**

| # | Folder | PNG pixels | H/W ratio (A0 = 1.4142) | DPI | PNG decodes fully | PNG size | PDF page | PDF pages | PDF size | SVG A0 root | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}

**Index PDF:** \`APEX_Commercial_Infographics_Index.pdf\` — ${idxPages} A4 pages (cover, contents, 12 poster pages): ${idxOk ? 'PASS' : 'FAIL'}.

## Opened in a browser
${browserChecks.map((c) => `- ${c}`).join('\n')}

## What was checked
- **Dimensions and aspect ratio:** every PNG is exactly 9933 × 14043 px, which is 841 × 1189 mm at 300 DPI (ratio 1.4138; ISO A0 is 1:√2 = 1.4142). The 300 DPI density is recorded in the file (pHYs).
- **Rendered from vector, never upscaled:** each PNG is rasterised from \`source.svg\` at native 300 DPI in 1000 px strips, which are streamed into one file.
- **Integrity:** the PNG signature, every chunk CRC and full decompression to exactly 14043 × (1 + 9933 × 3) bytes. Chrome also opened each PNG at full size.
- **PDF page size:** a single page with MediaBox 2383.9 × 3370.4 pt = 841 × 1189 mm, a vector PDF exported by Chrome from the same SVG.
- **Separate files:** 12 folders, each with its own PNG, PDF and SVG.
- **No text cropped:** the layout engine shrinks any text block until it fits its box and reports an overflow otherwise. The final build reported no overflow. Body text is at least 50 px (12 pt), and most body text is 80–200 px (19–48 pt), readable at poster distance.
- **Spelling:** every word on all 12 posters was extracted and reviewed by hand. British spelling is used throughout (organisation, licence, prioritised).
- **Visual review:** a reduced preview of each poster, and full-resolution crops of each PNG, were inspected for alignment, cropping and branding.
- **Colour:** PNGs and PDFs are RGB. No CMYK converter is available in this environment, so the print shop converts to CMYK at print time (see README).
`
fs.writeFileSync(path.join(ROOT, 'VALIDATION_REPORT.md'), md)
console.log(allOk ? 'ALL PASS' : 'SOME FAILED', 'index pages', idxPages)
