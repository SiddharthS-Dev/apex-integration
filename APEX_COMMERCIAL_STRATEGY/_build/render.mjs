// Renders each poster's source.svg to a 9933 × 14043 px RGB PNG (300 DPI, A0) and to an A0 vector PDF.
// The PNG is rasterised directly from the vector in horizontal strips and streamed into one PNG file,
// so no image is ever upscaled and peak memory stays small (about 40 MB per strip).
// Usage: node render.mjs [png|pdf|all] [poster numbers, comma separated]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { POSTERS } from './posters.mjs'
import { W, H } from './lib.mjs'

const require = createRequire(import.meta.url)
const { Resvg } = require('E:/apex/Inspironics Academia/node_modules/@resvg/resvg-js')
const FONTS = ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf', 'seguisb.ttf', 'seguisbi.ttf', 'segoeuil.ttf', 'seguibl.ttf', 'arial.ttf', 'arialbd.ttf'].map((f) => 'C:/Windows/Fonts/' + f).filter((f) => fs.existsSync(f))
const ROOT = path.resolve(import.meta.dirname, '..')
const mode = process.argv[2] || 'all'
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null
const STRIP = 1000

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}

async function renderPng(svg, out) {
  const fd = fs.openSync(out + '.part', 'w')
  fs.writeSync(fd, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  fs.writeSync(fd, chunk('IHDR', ihdr))
  const phys = Buffer.alloc(9); phys.writeUInt32BE(11811, 0); phys.writeUInt32BE(11811, 4); phys[8] = 1 // 300 DPI
  fs.writeSync(fd, chunk('pHYs', phys))
  const deflate = zlib.createDeflate({ level: 6, memLevel: 8 })
  deflate.on('data', (d) => fs.writeSync(fd, chunk('IDAT', d)))
  const done = new Promise((res, rej) => { deflate.on('end', res); deflate.on('error', rej) })
  const rootRe = /width="841mm" height="1189mm" viewBox="0 0 9933 14043"/
  if (!rootRe.test(svg)) throw new Error('unexpected root element')
  for (let y = 0; y < H; y += STRIP) {
    const h = Math.min(STRIP, H - y)
    // resvg panics on a filter whose region lies wholly outside the canvas; such shadows are invisible in
    // this strip, so drop the filter there (keeping a 300 px margin for shadows that spill into the strip).
    const part = svg.replace(rootRe, `width="${W}" height="${h}" viewBox="0 ${y} ${W} ${h}"`)
      .replace(/<rect x="[\d.-]+" y="([\d.-]+)" width="[\d.-]+" height="([\d.-]+)"[^>]*? filter="url\(#sh\)"/g, (m, ry, rh) => (+ry + +rh + 300 < y || +ry - 300 > y + h ? m.replace(' filter="url(#sh)"', '') : m))
    const img = new Resvg(part, { fitTo: { mode: 'original' }, background: '#ffffff', font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: 'Segoe UI' } }).render()
    if (img.width !== W || img.height !== h) throw new Error(`strip size ${img.width}x${img.height}`)
    const px = img.pixels // RGBA, opaque because of the white background
    const rows = Buffer.alloc(h * (1 + W * 3))
    for (let r = 0; r < h; r++) {
      const o = r * (1 + W * 3), s = r * W * 4
      rows[o] = 0
      for (let c = 0; c < W; c++) { rows[o + 1 + c * 3] = px[s + c * 4]; rows[o + 2 + c * 3] = px[s + c * 4 + 1]; rows[o + 3 + c * 3] = px[s + c * 4 + 2] }
    }
    if (!deflate.write(rows)) await new Promise((r) => deflate.once('drain', r))
  }
  deflate.end()
  await done
  fs.writeSync(fd, chunk('IEND', Buffer.alloc(0)))
  fs.closeSync(fd)
  fs.renameSync(out + '.part', out)
}

async function browser() {
  const puppeteer = require('E:/apex/inspironics-innovation-showcase/node_modules/puppeteer-core')
  return puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: 'E:/apex-review-tmp/chrome-a0', args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] })
}
export async function svgToPdf(page, svg, out) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:841mm 1189mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:841mm;height:1189mm}</style></head><body>${svg.replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({ path: out, width: '841mm', height: '1189mm', printBackground: true, pageRanges: '1', preferCSSPageSize: true })
}

const list = POSTERS.filter((p) => !only || only.includes(p.n))
let b, page
if (mode !== 'png') { b = await browser(); page = await b.newPage() }
for (const p of list) {
  const dir = path.join(ROOT, p.dir)
  const svg = fs.readFileSync(path.join(dir, 'source.svg'), 'utf8')
  const t = Date.now()
  if (mode !== 'pdf') await renderPng(svg, path.join(dir, p.file + '.png'))
  if (mode !== 'png') await svgToPdf(page, svg, path.join(dir, p.file + '.pdf'))
  console.log(p.n, p.file, mode, ((Date.now() - t) / 1000).toFixed(1) + 's')
}
if (b) await b.close()
