// Vector layout toolkit for A0 portrait posters. Canvas units are print pixels at 300 DPI:
// 9933 × 14043 px = 841 × 1189 mm. The SVG keeps width/height in millimetres for print editing.
import { PALETTE as P, META } from './content.mjs'

export const W = 9933, H = 14043
export const M = 470 // ≈ 40 mm print-safe margin
export const FONT = "'Segoe UI', Arial, sans-serif"
export const C = (k) => P[k] || k

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Approximate Segoe UI advance widths (em). Deliberately generous so that text never overflows.
const NARROW = new Set("il.,;:!|'’`()[]{}ıjtf·".split(''))
const WIDE = new Set('mwMW@%'.split(''))
export function textWidth(str, size, weight = 400) {
  let w = 0
  for (const ch of String(str)) {
    if (ch === ' ') w += 0.28
    else if (NARROW.has(ch)) w += 0.3
    else if (WIDE.has(ch)) w += 0.86
    else if (/[A-Z]/.test(ch)) w += 0.64
    else if (/[0-9]/.test(ch)) w += 0.56
    else if (ch === '—' || ch === '–') w += 0.7
    else w += 0.53
  }
  return w * size * (weight >= 600 ? 1.06 : 1)
}

export function wrap(str, size, maxW, weight = 400) {
  const out = []
  for (const para of String(str).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? line + ' ' + word : word
      if (!line || textWidth(cand, size, weight) <= maxW) line = cand
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

export function text(x, y, str, { size = 100, weight = 400, fill = 'ink', anchor = 'start', ls = 0, italic = false, opacity } = {}) {
  return `<text x="${r(x)}" y="${r(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${C(fill)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${ls ? ` letter-spacing="${ls}"` : ''}${italic ? ' font-style="italic"' : ''}${opacity != null ? ` fill-opacity="${opacity}"` : ''}>${esc(str)}</text>`
}
const r = (n) => Math.round(n * 10) / 10

// Paragraph: returns {svg, h}. y is the top of the block.
export function para(x, y, str, { size = 100, weight = 400, fill = 'ink2', maxW, lh = 1.32, anchor = 'start', italic = false } = {}) {
  const lines = wrap(str, size, maxW, weight)
  if (lines.some((l) => textWidth(l, size, weight) > maxW + 1)) STATE.over++
  const svg = lines.map((l, i) => text(x, y + size * 0.93 + i * size * lh, l, { size, weight, fill, anchor, italic })).join('')
  return { svg, h: lines.length ? (lines.length - 1) * size * lh + size * 1.2 : 0, lines: lines.length }
}

// Shrink a block's font size until it fits in maxH. render(size) -> {svg,h}
// Two-pass sizing: pass 1 finds the largest size that fits (allowed to grow up to 1.4× the design size);
// siblings created at the same call site share the smallest of their sizes in pass 2, so rows stay consistent.
export const STATE = { pass: 2, groups: {}, over: 0 }
export function beginPass(pass) { STATE.pass = pass; if (pass === 1) STATE.groups = {} }
function siteKey() {
  return (new Error().stack || '').split('\n').filter((l) => /(posters|lib)\.mjs:\d+/.test(l) && !/at (fit|siteKey) /.test(l)).map((l) => l.replace(/.*[\\/]/, '').replace(/\)$/, '')).join('>')
}
export function fit(render, maxH, start, min = 78) {
  const key = siteKey()
  let s = STATE.pass === 1 ? Math.min(200, Math.round((start * 1.8) / 4) * 4) : (STATE.groups[key] ?? start)
  let found = null
  for (; s >= min; s -= 4) { STATE.over = 0; const b = render(s); if (b.h <= maxH && !STATE.over) { found = { ...b, size: s }; break } }
  if (!found) {
    found = { ...render(min), size: min }
    if (found.h > maxH + 2 && STATE.pass === 2) WARN.push(`overflow ${Math.round(found.h)} > ${Math.round(maxH)} at min size [${key.slice(0, 80)}]`)
  }
  if (STATE.pass === 1) STATE.groups[key] = Math.min(STATE.groups[key] ?? Infinity, found.size)
  return found
}
export const WARN = []

export function bullets(x, y, items, { size = 96, maxW, fill = 'ink2', dot = 'cyan', gap = 0.42, lh = 1.3, weight = 400 } = {}) {
  let cy = y, svg = ''
  for (const it of items) {
    const p = para(x + size * 0.9, cy, it, { size, maxW: maxW - size * 0.9, fill, lh, weight })
    svg += `<circle cx="${r(x + size * 0.28)}" cy="${r(cy + size * 0.6)}" r="${r(size * 0.17)}" fill="${C(dot)}"/>` + p.svg
    cy += p.h + size * gap
  }
  return { svg, h: Math.max(0, cy - y - size * gap) }
}

export function rect(x, y, w, h, { fill = 'white', rx = 56, stroke, sw = 6, shadow = false, opacity } = {}) {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${rx}" fill="${fill.startsWith('url') ? fill : C(fill)}"${stroke ? ` stroke="${C(stroke)}" stroke-width="${sw}"` : ''}${shadow ? ' filter="url(#sh)"' : ''}${opacity != null ? ` fill-opacity="${opacity}"` : ''}/>`
}

// A card with a coloured header strip. Returns {svg, body:{x,y,w,h}}
export function card(x, y, w, h, { title, accent = 'cyan', icon, sub, titleSize = 118, pad = 110, tint = false } = {}) {
  let svg = rect(x, y, w, h, { fill: 'white', rx: 64, shadow: true })
  svg += `<path d="M${x} ${y + 64}a64 64 0 0 1 64 -64h${w - 128}a64 64 0 0 1 64 64v14h-${w}z" fill="${C(accent)}"/>`
  if (tint) svg += rect(x, y + 78, w, h - 78, { fill: C(accent), rx: 0, opacity: 0.04 })
  let ty = y + 78 + pad * 0.9
  let tx = x + pad
  if (icon) { svg += iconBadge(tx, ty - 10, 230, icon, accent); tx += 290 }
  if (title) {
    const t = para(tx, ty + (icon && !sub ? 30 : 0), title, { size: titleSize, weight: 700, fill: 'ink', maxW: x + w - pad - tx, lh: 1.15 })
    svg += t.svg
    let th = t.h
    if (sub) { const s = para(tx, ty + th + 22, sub, { size: titleSize * 0.66, weight: 600, fill: accent, maxW: x + w - pad - tx, lh: 1.2 }); svg += s.svg; th += s.h + 22 }
    ty += Math.max(th, icon ? 230 : 0) + pad * 0.55
  } else if (icon) ty += 230 + pad * 0.5
  return { svg, body: { x: x + pad, y: ty, w: w - pad * 2, h: y + h - pad * 0.8 - ty } }
}

export function pill(x, y, label, { size = 74, fill = 'cyan', color = 'white', padX = 46, h, outline = false } = {}) {
  const w = textWidth(label, size, 700) + padX * 2
  const hh = h || size * 1.75
  const svg = `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(hh)}" rx="${r(hh / 2)}" fill="${outline ? 'none' : C(fill)}"${outline ? ` stroke="${C(fill)}" stroke-width="7"` : ''}/>` +
    text(x + w / 2, y + hh / 2 + size * 0.36, label, { size, weight: 700, fill: outline ? fill : color, anchor: 'middle', ls: 2 })
  return { svg, w, h: hh }
}

export function arrow(x1, y1, x2, y2, { color = 'muted', sw = 16, head = 60, dash } = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const bx = x2 - Math.cos(a) * head, by = y2 - Math.sin(a) * head
  const p1 = [bx + Math.sin(a) * head * 0.6, by - Math.cos(a) * head * 0.6], p2 = [bx - Math.sin(a) * head * 0.6, by + Math.cos(a) * head * 0.6]
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(bx)}" y2="${r(by)}" stroke="${C(color)}" stroke-width="${sw}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
    `<path d="M${r(x2)} ${r(y2)}L${r(p1[0])} ${r(p1[1])}L${r(p2[0])} ${r(p2[1])}Z" fill="${C(color)}"/>`
}

// ---------------------------------------------------------------- icons (100×100 line glyphs) ----
const G = {
  shield: '<path d="M50 8 86 22v26c0 22-15 38-36 46C29 86 14 70 14 48V22Z"/><path d="m34 50 11 11 22-24"/>',
  spark: '<path d="M50 8v22M50 70v22M8 50h22M70 50h22M22 22l14 14M64 64l14 14M78 22 64 36M36 64 22 78"/><circle cx="50" cy="50" r="9"/>',
  deck: '<rect x="12" y="18" width="76" height="50" rx="5"/><path d="M50 68v16M34 90h32M26 54l14-14 10 10 18-18"/>',
  cap: '<path d="M6 40 50 20l44 20-44 20Z"/><path d="M24 50v20c8 8 44 8 52 0V50M88 43v26"/>',
  crown: '<path d="M14 72 8 28l24 18 18-28 18 28 24-18-6 44Z"/><path d="M16 84h68"/>',
  chart: '<path d="M12 88h78M22 76V52M42 76V34M62 76V44M82 76V18"/>',
  flow: '<rect x="8" y="12" width="30" height="22" rx="4"/><rect x="62" y="39" width="30" height="22" rx="4"/><rect x="8" y="66" width="30" height="22" rx="4"/><path d="M38 23h12v54H38M50 50h12"/>',
  chip: '<rect x="24" y="24" width="52" height="52" rx="6"/><rect x="38" y="38" width="24" height="24" rx="3"/><path d="M36 8v16M50 8v16M64 8v16M36 76v16M50 76v16M64 76v16M8 36h16M8 50h16M8 64h16M76 36h16M76 50h16M76 64h16"/>',
  users: '<circle cx="36" cy="34" r="14"/><path d="M10 84c0-16 12-26 26-26s26 10 26 26"/><circle cx="70" cy="30" r="11"/><path d="M66 54c14 0 24 10 24 26"/>',
  handshake: '<path d="M6 40 24 26l18 6 14-8 20 4 18 14"/><path d="M6 40v18l30 24c4 3 9 2 12-1l26-24M42 32 30 46c-3 4 2 9 6 6l14-10 20 16M94 42v14l-8 8"/>',
  gear: '<circle cx="50" cy="50" r="14"/><path d="M50 8v12M50 80v12M8 50h12M80 50h12M20 20l9 9M71 71l9 9M80 20l-9 9M29 71l-9 9"/><circle cx="50" cy="50" r="30"/>',
  network: '<circle cx="50" cy="20" r="10"/><circle cx="18" cy="78" r="10"/><circle cx="82" cy="78" r="10"/><circle cx="50" cy="56" r="8"/><path d="M50 30v18M44 61 26 72M56 61l18 11"/>',
  cloud: '<path d="M28 78h46c11 0 20-9 20-20s-9-20-20-20h-2C69 24 58 16 46 16 31 16 20 28 20 42 11 44 6 52 6 60c0 10 9 18 22 18Z"/>',
  lock: '<rect x="18" y="44" width="64" height="46" rx="6"/><path d="M30 44V30c0-11 9-20 20-20s20 9 20 20v14M50 60v14"/>',
  target: '<circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="24"/><circle cx="50" cy="50" r="8"/>',
  bulb: '<path d="M36 70c0-10-16-16-16-36a30 30 0 0 1 60 0c0 20-16 26-16 36Z"/><path d="M38 82h24M42 92h16"/>',
  doc: '<path d="M22 8h40l18 18v66H22Z"/><path d="M62 8v18h18M34 46h32M34 60h32M34 74h20"/>',
  play: '<rect x="8" y="16" width="84" height="68" rx="8"/><path d="m42 36 22 14-22 14Z"/>',
  check: '<circle cx="50" cy="50" r="40"/><path d="m32 50 12 12 24-26"/>',
  coin: '<circle cx="50" cy="50" r="40"/><path d="M62 34c-4-5-20-7-22 3-3 13 26 8 22 22-3 10-19 9-24 2M50 22v8M50 70v8"/>',
  search: '<circle cx="42" cy="42" r="28"/><path d="m62 62 26 26"/>',
  flag: '<path d="M18 92V10M18 14h60l-12 18 12 18H18"/>',
  route: '<circle cx="20" cy="80" r="10"/><circle cx="80" cy="20" r="10"/><path d="M30 80h30c14 0 14-22 0-22H40c-14 0-14-22 0-22h30"/>',
  scale: '<path d="M50 10v80M28 90h44M16 26h68M16 26 4 56h24ZM84 26 72 56h24Z"/>',
  mega: '<path d="M14 40v20h16l36 20V20L30 40Z"/><path d="M78 36c6 8 6 20 0 28M30 60l8 26"/>',
  star: '<path d="m50 8 12 28 30 3-23 20 7 30-26-16-26 16 7-30-23-20 30-3Z"/>',
}
export function icon(x, y, s, name, color = 'white', sw = 7) {
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s / 100 * 1000) / 1000})" fill="none" stroke="${C(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${G[name] || G.spark}</g>`
}
export function iconBadge(x, y, s, name, accent = 'cyan') {
  return rect(x, y, s, s, { fill: accent, rx: s * 0.22 }) + icon(x + s * 0.18, y + s * 0.18, s * 0.64, name, 'white', 8)
}

// Simple, professional persona illustration: abstract bust in a squared tile with an icon accent.
export function personaAvatar(x, y, s, accent, iconName) {
  const cx = x + s / 2
  return rect(x, y, s, s, { fill: accent, rx: s * 0.2 }) +
    `<circle cx="${r(cx)}" cy="${r(y + s * 0.38)}" r="${r(s * 0.17)}" fill="white" fill-opacity="0.95"/>` +
    `<path d="M${r(x + s * 0.18)} ${r(y + s * 0.92)}c0-${r(s * 0.24)} ${r(s * 0.14)}-${r(s * 0.34)} ${r(s * 0.32)}-${r(s * 0.34)}s${r(s * 0.32)} ${r(s * 0.1)} ${r(s * 0.32)} ${r(s * 0.34)}" fill="white" fill-opacity="0.95"/>` +
    rect(x + s * 0.66, y + s * 0.06, s * 0.28, s * 0.28, { fill: 'white', rx: s * 0.07 }) + icon(x + s * 0.69, y + s * 0.09, s * 0.22, iconName, accent, 9)
}

export function logo(x, y, s) {
  const k = s / 32
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(k * 100) / 100})"><path d="M16 2.5 29 27H3L16 2.5Z" stroke="url(#apexMark)" stroke-width="2.1" stroke-linejoin="round" fill="none"/><path d="M16 12.5 22 24H10l6-11.5Z" fill="url(#apexMark)" fill-opacity=".85"/></g>`
}

export function sectionHead(x, y, label, { color = 'navy', w = W - 2 * M, num } = {}) {
  let svg = ''
  let tx = x
  if (num != null) { svg += rect(x, y, 150, 150, { fill: color, rx: 36 }) + text(x + 75, y + 105, String(num), { size: 92, weight: 800, fill: 'white', anchor: 'middle' }); tx += 200 }
  svg += text(tx, y + 112, label.toUpperCase(), { size: 112, weight: 800, fill: color, ls: 8 })
  const lw = textWidth(label.toUpperCase(), 112, 800) + 8 * label.length + 60
  svg += `<line x1="${r(tx + lw)}" y1="${y + 75}" x2="${x + w}" y2="${y + 75}" stroke="${C('line')}" stroke-width="8"/>`
  return svg
}

const DEFS = `<defs>
<linearGradient id="apexMark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#00f0ff"/><stop offset="100%" stop-color="#c065f0"/></linearGradient>
<linearGradient id="hdr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1736"/><stop offset="0.6" stop-color="#13224A"/><stop offset="1" stop-color="#2A1A5E"/></linearGradient>
<linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#06B6D4"/><stop offset="1" stop-color="#7C3AED"/></linearGradient>
<filter id="sh" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="22" stdDeviation="30" flood-color="#0B1736" flood-opacity="0.13"/></filter>
</defs>`

// Full poster frame: header with number, title, summary; body produced by caller; takeaway + footer.
export function poster({ num, title, kicker, summary, body, takeaway, palette = 'cyan' }) {
  const hdrH = 2350
  let s = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="841mm" height="1189mm" viewBox="0 0 ${W} ${H}">
<title>${esc(`APEX ${String(num).padStart(2, '0')} — ${title}`)}</title>
${DEFS}
<rect width="${W}" height="${H}" fill="${P.paper}"/>
<rect width="${W}" height="${hdrH}" fill="url(#hdr)"/>
<g stroke-opacity="0.10" stroke="#9FE8FF" stroke-width="5" fill="none">${Array.from({ length: 9 }, (_, i) => `<circle cx="${W - 900}" cy="${700}" r="${300 + i * 260}"/>`).join('')}</g>
<g stroke-opacity="0.07" stroke="#ffffff" stroke-width="3">${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 430}" y1="0" x2="${i * 430}" y2="${hdrH}"/>`).join('')}</g>
<rect y="${hdrH - 34}" width="${W}" height="34" fill="url(#accentBar)"/>`
  s += logo(M, 300, 330)
  s += text(M + 420, 430, 'INSPIRONICS APEX', { size: 118, weight: 800, fill: 'white', ls: 14 })
  s += text(M + 420, 560, 'COMMERCIAL STRATEGY · A0 SERIES', { size: 78, weight: 600, fill: '#7DD3FC', ls: 10 })
  // poster number tile
  s += `<rect x="${W - M - 760}" y="300" width="760" height="300" rx="70" fill="white" fill-opacity="0.08" stroke="#7DD3FC" stroke-opacity="0.5" stroke-width="6"/>`
  s += text(W - M - 380, 410, 'POSTER', { size: 70, weight: 700, fill: '#7DD3FC', anchor: 'middle', ls: 12 })
  s += text(W - M - 380, 555, `${String(num).padStart(2, '0')} / 12`, { size: 132, weight: 800, fill: 'white', anchor: 'middle' })
  s += text(M, 1000, kicker.toUpperCase(), { size: 96, weight: 700, fill: '#5EEAD4', ls: 10 })
  let ts = 380
  while (ts > 300 && wrap(title, ts, W - 2 * M, 800).length > 1) ts -= 10
  const tl = wrap(title, ts, W - 2 * M, 800)
  if (tl.length > 1) { ts = 320; }
  const tl2 = wrap(title, ts, W - 2 * M, 800)
  tl2.forEach((l, i) => { s += text(M, 1390 + i * ts * 1.08, l, { size: ts, weight: 800, fill: 'white' }) })
  const sy = 1390 + (tl2.length - 1) * ts * 1.08 + 200
  const sm = fit((z) => para(M, sy, summary, { size: z, fill: '#CBD5E1', maxW: W - 2 * M - 300, lh: 1.3 }), hdrH - 150 - sy, 100, 84)
  s += sm.svg
  // body
  s += `<g id="body">${body}</g>`
  // takeaway band
  const ty = H - 1650
  s += rect(M, ty, W - 2 * M, 900, { fill: 'navy', rx: 80, shadow: true })
  s += rect(M, ty, 60, 900, { fill: 'cyan', rx: 30 })
  s += iconBadge(M + 230, ty + 235, 430, 'flag', 'cyan')
  s += text(M + 800, ty + 270, 'COMMERCIAL TAKEAWAY', { size: 92, weight: 800, fill: '#5EEAD4', ls: 10 })
  const tk = fit((z) => para(M + 800, ty + 340, takeaway, { size: z, weight: 600, fill: 'white', maxW: W - 2 * M - 1000, lh: 1.28 }), 500, 150, 110)
  s += tk.svg
  // footer
  const fy = H - 620
  s += `<line x1="${M}" y1="${fy}" x2="${W - M}" y2="${fy}" stroke="${P.line}" stroke-width="8"/>`
  let lx = M
  for (const [k, c] of [['LIVE', 'green'], ['IN PROGRESS', 'amber'], ['ROADMAP', 'slate']]) { const p = pill(lx, fy + 90, k, { size: 64, fill: c }); s += p.svg; lx += p.w + 40 }
  s += text(lx + 40, fy + 175, 'Capability status shown on the poster where relevant', { size: 72, fill: 'muted' })
  s += para(M, fy + 290, META.readiness, { size: 70, fill: 'muted', maxW: W - 2 * M - 2400 }).svg
  s += text(W - M, fy + 175, 'Inspironics APEX · Commercial Strategy', { size: 76, weight: 700, fill: 'ink', anchor: 'end' })
  s += text(W - M, fy + 290, 'November 2026 · Internal sales enablement · A0 841 × 1189 mm', { size: 70, fill: 'muted', anchor: 'end' })
  s += text(W - M, fy + 390, `APEX-CS-${String(num).padStart(2, '0')}`, { size: 70, weight: 700, fill: 'cyan', anchor: 'end', ls: 6 })
  s += '\n</svg>\n'
  return s
}

export const BODY_TOP = 2620
export const BODY_BOTTOM = H - 1650 - 160 // above the takeaway band
