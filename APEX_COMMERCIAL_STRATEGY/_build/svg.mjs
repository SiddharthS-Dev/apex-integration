// Writes each poster's editable source.svg and a small QA preview (rendered from the vector, 1/8 scale).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { POSTERS } from './posters.mjs'
import { WARN, beginPass } from './lib.mjs'
const require = createRequire(import.meta.url)
const { Resvg } = require('E:/apex/Inspironics Academia/node_modules/@resvg/resvg-js')
export const FONTS = ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf', 'seguisb.ttf', 'seguisbi.ttf', 'segoeuil.ttf', 'seguibl.ttf', 'arial.ttf', 'arialbd.ttf'].map((f) => 'C:/Windows/Fonts/' + f).filter((f) => fs.existsSync(f))
const ROOT = path.resolve(import.meta.dirname, '..')
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null
fs.mkdirSync(path.join(import.meta.dirname, 'previews'), { recursive: true })
for (const p of POSTERS) {
  if (only && !only.includes(p.n)) continue
  const before = WARN.length
  beginPass(1); p.build(); beginPass(2)
  const svg = p.build()
  fs.mkdirSync(path.join(ROOT, p.dir), { recursive: true })
  fs.writeFileSync(path.join(ROOT, p.dir, 'source.svg'), svg)
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1242 }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: 'Segoe UI' } })
  fs.writeFileSync(path.join(import.meta.dirname, 'previews', `${String(p.n).padStart(2, '0')}.png`), r.render().asPng())
  console.log(p.n, p.dir, 'svg', svg.length, WARN.slice(before).join(' | '))
}
