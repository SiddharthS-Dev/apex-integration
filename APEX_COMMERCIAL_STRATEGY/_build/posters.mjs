// The 12 A0 posters. Each returns an SVG string built from content.mjs.
import * as K from './content.mjs'
import { W, M, C, text, para, fit, bullets, rect, card, pill, arrow, icon, iconBadge, personaAvatar, sectionHead, poster, textWidth, wrap, BODY_TOP, BODY_BOTTOM } from './lib.mjs'

const IW = W - 2 * M
const PBY = Object.fromEntries(K.PERSONAS.map((p) => [p.id, p]))
const MAT_COLOR = { LIVE: 'green', 'IN PROGRESS': 'amber', ROADMAP: 'slate' }

function chip(x, y, id, s = 150) {
  const p = PBY[id]
  if (!p) return { svg: rect(x, y, s * 2.6, s, { fill: 'slate', rx: s * 0.22 }) + text(x + s * 1.3, y + s * 0.68, 'GOV', { size: s * 0.5, weight: 800, fill: 'white', anchor: 'middle' }), w: s * 2.6 }
  return { svg: rect(x, y, s, s, { fill: p.color, rx: s * 0.22 }) + text(x + s / 2, y + s * 0.7, id, { size: s * 0.56, weight: 800, fill: 'white', anchor: 'middle' }), w: s }
}
function chips(x, y, ids, s = 150) {
  let svg = '', cx = x
  for (const id of ids) { const c = chip(cx, y, id, s); svg += c.svg; cx += c.w + s * 0.25 }
  return { svg, w: cx - x }
}
function labelled(x, y, label, value, { w, color = 'cyan', size = 92, lsize = 66, list = false } = {}) {
  let svg = text(x, y + lsize, label.toUpperCase(), { size: lsize, weight: 800, fill: color, ls: 5 })
  const b = list ? bullets(x, y + lsize + 40, value, { size, maxW: w, dot: color }) : para(x, y + lsize + 30, value, { size, maxW: w, fill: 'ink2' })
  return { svg: svg + b.svg, h: lsize + 40 + b.h }
}
function stack(x, y, w, items, gap, size, lsize) {
  let svg = '', cy = y
  for (const it of items) { const b = labelled(x, cy, it[0], it[1], { w, color: it[2] || 'cyan', size, lsize, list: Array.isArray(it[1]) }); svg += b.svg; cy += b.h + gap }
  return { svg, h: cy - y - gap }
}
function fitStack(x, y, w, h, items, start = 96) {
  return fit((z) => stack(x, y, w, items, z * 0.55, z, Math.max(58, z * 0.72)), h, start, 70)
}

// ---------------------------------------------------------------- 01 ----
function p01() {
  let b = ''
  let y = BODY_TOP
  // positioning statement
  b += rect(M, y, IW, 1250, { fill: 'white', rx: 80, shadow: true }) + rect(M, y, 40, 1250, { fill: 'violet', rx: 20 })
  b += text(M + 200, y + 330, '“', { size: 460, weight: 800, fill: 'violet', opacity: 0.35 })
  b += text(M + 520, y + 210, 'POSITIONING STATEMENT', { size: 84, weight: 800, fill: 'violet', ls: 8 })
  b += fit((z) => para(M + 520, y + 270, K.POSITIONING.statement, { size: z, weight: 600, fill: 'ink', maxW: IW - 720, lh: 1.3 }), 900, 140).svg
  y += 1450
  b += sectionHead(M, y, 'What we sell, to whom, and why', { num: 1, color: 'navy' })
  y += 260
  const q = [
    ['What APEX is', 'spark', 'cyan', K.PRODUCT.oneLiner],
    ['What we sell', 'coin', 'violet', K.POSITIONING.selling],
    ['Who buys', 'target', 'teal', K.POSITIONING.whoBuys],
    ['Why they buy', 'check', 'blue', K.POSITIONING.whyBuy],
  ]
  const cw = (IW - 3 * 150) / 4
  q.forEach(([t, ic, col, v], i) => {
    const c = card(M + i * (cw + 150), y, cw, 2500, { title: t, icon: ic, accent: col })
    b += c.svg
    b += fit((z) => Array.isArray(v) ? bullets(c.body.x, c.body.y, v, { size: z, maxW: c.body.w, dot: col }) : para(c.body.x, c.body.y, v, { size: z, maxW: c.body.w }), c.body.h, 104).svg
  })
  y += 2750
  b += sectionHead(M, y, 'The product, as built today', { num: 2, color: 'navy' })
  y += 260
  K.PRODUCT.modules.forEach((m, i) => {
    const c = card(M + i * (cw + 150), y, cw, 2050, { title: m.name, icon: m.icon, accent: m.color, titleSize: 108 })
    b += c.svg
    const pl = pill(c.body.x, c.body.y, m.maturity, { fill: MAT_COLOR[m.maturity], size: 64 })
    b += pl.svg
    b += fit((z) => para(c.body.x, c.body.y + pl.h + 50, m.what, { size: z, maxW: c.body.w }), c.body.h - pl.h - 50, 96).svg
  })
  y += 2300
  b += sectionHead(M, y, 'Problems we solve · How we differ', { num: 3, color: 'navy' })
  y += 260
  const lw = 3700, rw = IW - lw - 150, hh = BODY_BOTTOM - y
  const c1 = card(M, y, lw, hh, { title: 'Business problems that justify a purchase', accent: 'rose', icon: 'bulb', titleSize: 104 })
  b += c1.svg
  b += fit((z) => stack(c1.body.x, c1.body.y, c1.body.w, K.PRODUCT.problems.map((p) => [p.title, p.text, 'rose']), z * 0.5, z, z * 0.78), c1.body.h, 100).svg
  const c2 = card(M + lw + 150, y, rw, hh, { title: 'Versus the alternatives', accent: 'teal', icon: 'scale', titleSize: 104 })
  b += c2.svg
  const rowH = c2.body.h / 4
  K.POSITIONING.vsAlternatives.forEach((a, i) => {
    const ry = c2.body.y + i * rowH
    if (i) b += `<line x1="${c2.body.x}" y1="${ry - 20}" x2="${c2.body.x + c2.body.w}" y2="${ry - 20}" stroke="${C('line')}" stroke-width="6"/>`
    b += fit((z) => para(c2.body.x, ry + 10, a.alt, { size: z, weight: 700, fill: 'ink', maxW: 1150 }), rowH - 40, 100).svg
    b += arrow(c2.body.x + 1200, ry + 90, c2.body.x + 1450, ry + 90, { color: 'teal', sw: 14, head: 50 })
    b += fit((z) => para(c2.body.x + 1530, ry + 10, a.apex, { size: z, maxW: c2.body.w - 1530 }), rowH - 40, 96).svg
  })
  return poster({ num: 1, kicker: 'Commercial business positioning', title: 'APEX: from scattered know-how to proven capability', summary: 'APEX is one secure, self-hosted front door to a firm’s solution portfolio, sales presentations and engineering learning. We sell it as an annual organisation licence with an implementation package, entered through a paid pilot.', body: b, takeaway: 'Lead with the business problem — expertise trapped in people and folders — and position APEX as the self-hosted way to make it findable, teachable and provable. Sell the pilot first; earn the licence with evidence.' })
}

// ---------------------------------------------------------------- 02 ----
function p02() {
  let b = '', y = BODY_TOP
  b += sectionHead(M, y, 'Industry segments', { num: 1 })
  y += 260
  const cw = (IW - 2 * 150) / 3, ch = 1580
  const PR = { Primary: 'cyan', Secondary: 'violet', Future: 'slate' }
  K.SEGMENTS.industries.forEach((s, i) => {
    const x = M + (i % 3) * (cw + 150), yy = y + Math.floor(i / 3) * (ch + 150)
    const c = card(x, yy, cw, ch, { title: s.name, icon: s.icon, accent: PR[s.priority], titleSize: 108 })
    b += c.svg
    const pl = pill(c.body.x, c.body.y, s.priority.toUpperCase(), { fill: PR[s.priority], size: 62 })
    b += pl.svg
    b += fit((z) => para(c.body.x, c.body.y + pl.h + 40, s.why, { size: z, maxW: c.body.w }), c.body.h - pl.h - 40, 96).svg
  })
  y += 2 * ch + 150 + 260
  b += sectionHead(M, y, 'Where to aim first', { num: 2 })
  y += 260
  // target rings
  const rh = 3000, cx = M + 1600, cy = y + rh / 2
  ;[[1480, 'slate', 0.10], [1080, 'violet', 0.16], [660, 'cyan', 0.9]].forEach(([rr, col, op]) => { b += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${C(col)}" fill-opacity="${op}" stroke="${C(col)}" stroke-width="8"/>` })
  b += text(cx, cy - 40, 'PRIMARY', { size: 110, weight: 800, fill: 'white', anchor: 'middle', ls: 6 })
  b += text(cx, cy + 90, 'Eng. services · SIs', { size: 84, weight: 600, fill: 'white', anchor: 'middle' })
  b += text(cx, cy + 190, '· B2B pre-sales', { size: 84, weight: 600, fill: 'white', anchor: 'middle' })
  b += text(cx, cy - 820, 'SECONDARY', { size: 84, weight: 800, fill: 'violet', anchor: 'middle', ls: 6 })
  b += text(cx, cy - 1220, 'FUTURE', { size: 84, weight: 800, fill: 'slate', anchor: 'middle', ls: 6 })
  b += text(cx, cy + 880, 'Dropbox-standardised · Self-hosting', { size: 72, weight: 600, fill: 'violet', anchor: 'middle' })
  b += text(cx, cy + 1290, 'Training & academic partners', { size: 72, weight: 600, fill: 'slate', anchor: 'middle' })
  const ox = M + 3400, ow = IW - 3400
  const oh = (rh - 3 * 100) / 4
  K.SEGMENTS.orgTypes.forEach((o, i) => {
    const yy = y + i * (oh + 100)
    b += rect(ox, yy, ow, oh, { fill: 'white', rx: 56, shadow: true }) + rect(ox, yy, 30, oh, { fill: i === 0 ? 'cyan' : i === 3 ? 'amber' : 'violet', rx: 15 })
    b += iconBadge(ox + 110, yy + (oh - 300) / 2, 300, ['chart', 'network', 'users', 'handshake'][i], i === 0 ? 'cyan' : i === 3 ? 'amber' : 'violet')
    b += text(ox + 520, yy + 210, o.name, { size: 112, weight: 700, fill: 'ink' })
    b += fit((z) => para(ox + 520, yy + 260, o.note, { size: z, maxW: ow - 640 }), oh - 300, 96).svg
  })
  y += rh + 260
  b += sectionHead(M, y, 'Commercial opportunities', { num: 3 })
  y += 260
  const n = K.SEGMENTS.opportunities.length, gw = 260, ow2 = (IW - (n - 1) * gw) / n, oh2 = BODY_BOTTOM - y - 260
  const steps = ['LAND', 'EXPAND', 'SERVICES', 'CHANNEL']
  K.SEGMENTS.opportunities.forEach((t, i) => {
    const x = M + i * (ow2 + gw)
    const c = card(x, y, ow2, oh2, { title: steps[i], accent: ['cyan', 'blue', 'violet', 'amber'][i], icon: ['flag', 'chart', 'gear', 'handshake'][i], titleSize: 116 })
    b += c.svg + fit((z) => para(c.body.x, c.body.y, t, { size: z, maxW: c.body.w }), c.body.h, 100).svg
    if (i < n - 1) b += arrow(x + ow2 + 40, y + oh2 / 2, x + ow2 + gw - 40, y + oh2 / 2, { color: 'muted', sw: 18, head: 70 })
  })
  b += text(M, BODY_BOTTOM - 70, 'Note: ' + K.SEGMENTS.note, { size: 84, weight: 600, fill: 'muted', italic: true })
  return poster({ num: 2, kicker: 'Target customer segmentation', title: 'Who APEX is for — and where we start', summary: 'APEX fits organisations whose value is expert know-how held in playbooks, decks and blueprints. We start with engineering services, solution integrators and B2B pre-sales teams, then widen to Dropbox-standardised and self-hosting organisations.', body: b, takeaway: 'Focus the first sales effort on mid-sized engineering, integration and pre-sales organisations already on Dropbox. Validate these segments in ten discovery conversations before widening the target.' })
}

// ---------------------------------------------------------------- 03 ----
function personaBox(x, y, w, h, p) {
  let s = rect(x, y, w, h, { fill: 'white', rx: 64, shadow: true }) + rect(x, y, w, 26, { fill: p.color, rx: 13 })
  const av = Math.min(560, h - 260)
  s += personaAvatar(x + 110, y + 130, av, p.color, p.icon)
  const tx = x + 110 + av + 110, tw = w - (tx - x) - 110
  s += text(tx, y + 250, `PERSONA ${p.id}`, { size: 74, weight: 800, fill: p.color, ls: 8 })
  s += text(tx, y + 390, p.name, { size: textWidth(p.name, 124, 700) > tw ? 104 : 124, weight: 700, fill: 'ink' })
  const pl = pill(tx, y + 450, p.role.toUpperCase(), { fill: p.color, size: 60 })
  s += pl.svg
  s += fit((z) => stack(tx, y + 450 + pl.h + 40, tw, [['Authority', p.authority, p.color], ['Typical titles', p.titles.join(' · '), p.color]], 26, z, 58), h - 450 - pl.h - 160 - 120, 88).svg
  // influence meter
  const lvl = { 'Very high': 5, 'High': 4, 'High (can block)': 4, 'Medium–high': 3, 'Medium–high (reach)': 3, 'Medium (adoption)': 2 }[p.influence] || 3
  const my = y + h - 150
  s += text(tx, my + 50, 'INFLUENCE', { size: 60, weight: 800, fill: 'muted', ls: 5 })
  for (let i = 0; i < 5; i++) s += rect(tx + 420 + i * 150, my, 120, 70, { fill: i < lvl ? p.color : 'line', rx: 14 })
  s += text(tx + 420 + 5 * 150 + 30, my + 55, p.influence, { size: 66, weight: 600, fill: 'ink2' })
  return s
}
function p03() {
  let b = '', y = BODY_TOP
  const pw = 6350, cx = M + pw / 2
  const top = y, base = y + 7700
  b += `<path d="M${cx} ${top} L${M + pw} ${base} L${M} ${base} Z" fill="${C('navy')}" fill-opacity="0.05" stroke="${C('navy')}" stroke-opacity="0.12" stroke-width="8"/>`
  const th = 1750, g = 230
  const tiers = [[['A'], 3700], [['B', 'D'], 3060], [['C', 'F'], 3060], [['E'], 5200]]
  const tierLbl = ['TIER 1 · DECIDES', 'TIER 2 · OWNS & VETOES', 'TIER 3 · SHAPES & RECOMMENDS', 'TIER 4 · USES']
  tiers.forEach(([ids, bw], i) => {
    const ty = top + 150 + i * (th + g)
    const total = ids.length * bw + (ids.length - 1) * 150
    ids.forEach((id, j) => { b += personaBox(cx - total / 2 + j * (bw + 150), ty, bw, th, PBY[id]) })
  })
  const rx = M + pw + 160, rw = W - M - rx
  const c1 = card(rx, top, rw, 4750, { title: 'Who plays which buying role', accent: 'navy', icon: 'users', titleSize: 104 })
  b += c1.svg
  const rowH = (c1.body.h) / K.BUYING_ROLES.length
  K.BUYING_ROLES.forEach((br, i) => {
    const ry = c1.body.y + i * rowH
    b += text(c1.body.x, ry + 90, br.role, { size: 90, weight: 700, fill: 'ink' })
    b += fit((z) => para(c1.body.x, ry + 120, br.who, { size: z, maxW: c1.body.w }), rowH - 160, 84).svg
  })
  const G = K.GOVERNANCE_STAKEHOLDER
  const c2 = card(rx, top + 4900, rw, base - top - 4900, { title: G.name, accent: 'slate', icon: 'lock', titleSize: 104, sub: 'Gatekeeper at every stage' })
  b += c2.svg
  b += fitStack(c2.body.x, c2.body.y, c2.body.w, c2.body.h, [['Concerns', G.concerns, 'slate'], ['Be honest about', G.honest, 'rose']], 86).svg
  y = base + 240
  b += sectionHead(M, y, 'Who must say yes, in order', { num: 1 })
  y += 280
  const gates = [['Sponsor', 'A names an executive sponsor', 'navy'], ['Business case', 'B owns and presents it', 'blue'], ['Technical sign-off', 'D approves or vetoes', 'violet'], ['Champion & users', 'C and E prove adoption in the pilot', 'teal'], ['Governance', 'Procurement, security, legal', 'slate'], ['Signature', 'A signs the contract', 'navy']]
  const gw = (IW - 5 * 120) / 6, gh = BODY_BOTTOM - y
  gates.forEach(([t, d, col], i) => {
    const x = M + i * (gw + 120)
    b += rect(x, y, gw, gh, { fill: col, rx: 60, shadow: true })
    b += text(x + 80, y + 170, String(i + 1).padStart(2, '0'), { size: 110, weight: 800, fill: 'white', opacity: 0.55 })
    b += fit((z) => para(x + 80, y + 230, t, { size: z, weight: 700, fill: 'white', maxW: gw - 160, lh: 1.15 }), 300, 104).svg
    b += fit((z) => para(x + 80, y + 560, d, { size: z, fill: '#E2E8F0', maxW: gw - 160 }), gh - 620, 84).svg
    if (i < 5) b += arrow(x + gw + 10, y + gh / 2, x + gw + 110, y + gh / 2, { color: 'muted', sw: 12, head: 44 })
  })
  return poster({ num: 3, kicker: 'Customer persona hierarchy', title: 'Six personas, one buying group', summary: 'An APEX sale is a group decision. Executives decide and fund, senior managers own the business case, technology leaders can veto, operations leaders champion the pilot, users decide adoption — and partners can open the door.', body: b, takeaway: 'Map every account to all six personas plus governance before the first demo. Never rely on one champion: a deal needs a sponsor (A), a business owner (B), technical sign-off (D) and governance approval.' })
}

// ---------------------------------------------------------------- 04 ----
function p04() {
  let b = '', y = BODY_TOP
  b += sectionHead(M, y, 'Three problems, three answers', { num: 1 })
  y += 260
  const answers = ['One searchable, presentable, measured library — files stay in Dropbox.', 'Playbooks become courses with graded tests, certificates and recertification.', 'One sign-in, scoped roles and an audit trail across products.']
  const cw = (IW - 2 * 150) / 3
  K.PRODUCT.problems.forEach((p, i) => {
    const x = M + i * (cw + 150)
    b += rect(x, y, cw, 1500, { fill: 'white', rx: 60, shadow: true })
    b += rect(x, y, cw, 640, { fill: 'rose', rx: 60, opacity: 0.08 })
    b += text(x + 110, y + 170, 'PROBLEM', { size: 66, weight: 800, fill: 'rose', ls: 6 })
    b += fit((z) => para(x + 110, y + 210, p.title, { size: z, weight: 700, fill: 'ink', maxW: cw - 220 }), 400, 112).svg
    b += arrow(x + cw / 2, y + 650, x + cw / 2, y + 820, { color: 'teal', sw: 16, head: 60 })
    b += text(x + 110, y + 940, 'APEX ANSWER', { size: 66, weight: 800, fill: 'teal', ls: 6 })
    b += fit((z) => para(x + 110, y + 980, answers[i], { size: z, maxW: cw - 220 }), 460, 98).svg
  })
  y += 1500 + 220
  b += sectionHead(M, y, 'By persona: pain → capability → value', { num: 2 })
  y += 250
  const cols = [['PERSONA', 1750, 'navy'], ['PAIN POINTS & CHALLENGES', 2500, 'rose'], ['RELEVANT APEX CAPABILITIES', 2500, 'violet'], ['EXPECTED BUSINESS VALUE', IW - 1750 - 5000 - 3 * 80, 'teal']]
  let cx = M
  const colX = cols.map(([l, w, col]) => { const x = cx; b += text(x + 20, y + 80, l, { size: 70, weight: 800, fill: col, ls: 5 }); cx += w + 80; return x })
  y += 150
  const rh = (BODY_BOTTOM - y - 5 * 60) / 6
  K.PERSONAS.forEach((p, i) => {
    const ry = y + i * (rh + 60)
    b += rect(M, ry, IW, rh, { fill: 'white', rx: 50, shadow: true })
    b += rect(colX[1] - 40, ry, 2500 + 80, rh, { fill: 'rose', rx: 0, opacity: 0.045 })
    b += rect(colX[3] - 40, ry, cols[3][1] + 40, rh, { fill: 'teal', rx: 50, opacity: 0.06 })
    b += personaAvatar(M + 70, ry + (rh - 380) / 2, 380, p.color, p.icon)
    b += text(M + 500, ry + rh / 2 - 60, `PERSONA ${p.id}`, { size: 64, weight: 800, fill: p.color, ls: 5 })
    b += fit((z) => para(M + 500, ry + rh / 2 - 20, p.short, { size: z, weight: 700, fill: 'ink', maxW: 1200 }), rh / 2, 100).svg
    b += fit((z) => bullets(colX[1], ry + 70, [...p.pains, ...p.challenges.slice(0, 1)], { size: z, maxW: 2500, dot: 'rose', gap: 0.25 }), rh - 120, 84).svg
    b += fit((z) => bullets(colX[2], ry + 70, p.features, { size: z, maxW: 2500, dot: 'violet', gap: 0.25 }), rh - 120, 84).svg
    b += fit((z) => para(colX[3], ry + 70, p.value, { size: z, weight: 600, fill: 'ink', maxW: cols[3][1] - 60 }), rh - 120, 92).svg
  })
  return poster({ num: 4, kicker: 'Persona pain points vs business value', title: 'Every persona feels the problem differently', summary: 'The same three problems show up as different pains for each persona. Match each pain to a capability that exists today, and describe the value in that persona’s own terms — never with unproven figures.', body: b, takeaway: 'Open every conversation with the persona’s own pain, show only the capability that answers it, and state the value as an outcome to be measured in the pilot — not as a promised number.' })
}

// ---------------------------------------------------------------- 05 ----
function p05() {
  let b = '', y = BODY_TOP
  const cw = (IW - 150) / 2, gh = 140
  const ch = (BODY_BOTTOM - y - 2 * gh) / 3
  K.PERSONAS.forEach((p, i) => {
    const x = M + (i % 2) * (cw + 150), yy = y + Math.floor(i / 2) * (ch + gh)
    b += rect(x, yy, cw, ch, { fill: 'white', rx: 64, shadow: true }) + rect(x, yy, cw, 26, { fill: p.color, rx: 13 })
    b += personaAvatar(x + 100, yy + 120, 380, p.color, p.icon)
    b += text(x + 560, yy + 230, `PERSONA ${p.id}`, { size: 70, weight: 800, fill: p.color, ls: 6 })
    b += text(x + 560, yy + 360, p.name, { size: textWidth(p.name, 118, 700) > cw - 700 ? 100 : 118, weight: 700, fill: 'ink' })
    b += fit((z) => para(x + 560, yy + 400, `“${p.message}”`, { size: z, italic: true, fill: p.color, weight: 600, maxW: cw - 680 }), 200, 84).svg
    const by = yy + 640, bh = ch - 640 - 90, iw = (cw - 200 - 120) / 2
    b += fitStack(x + 100, by, iw, bh, [['Teach them', p.teach.teach, p.color], ['Problem to highlight', p.teach.problem, 'rose'], ['Capability to show', p.teach.capability, 'violet'], ['Value to communicate', p.value, 'green']], 86).svg
    b += `<line x1="${x + 100 + iw + 60}" y1="${by}" x2="${x + 100 + iw + 60}" y2="${by + bh}" stroke="${C('line')}" stroke-width="6"/>`
    b += fitStack(x + 100 + iw + 120, by, iw, bh, [['Information they need', p.materials.join(' · '), 'slate'], ['Infographic · Video', `${p.teach.infographic}; ${p.teach.video}`, 'blue'], ['They should understand', p.teach.understand, 'teal'], ['Next action', p.teach.next, 'amber']], 86).svg
  })
  return poster({ num: 5, kicker: 'What we should teach each persona', title: 'Educate each persona on what matters to them', summary: 'Customer education is persona-specific. Each card shows what to teach, the problem to highlight, the capability to show, the material to use, what the persona should understand afterwards and the next action we want.', body: b, takeaway: 'Never send the same material to everyone. Executives get business value, managers get accountability, operations get workflow, technology gets architecture and security, users get daily time savings, partners get revenue.' })
}

// ---------------------------------------------------------------- 06 ----
function p06() {
  let b = '', y = BODY_TOP
  const mw = 2700, pw = 2000, colW = (IW - mw - pw) / 6
  // header row with persona tiles
  b += text(M, y + 330, 'MATERIAL', { size: 76, weight: 800, fill: 'navy', ls: 6 })
  b += text(M + mw, y + 330, 'PURPOSE', { size: 76, weight: 800, fill: 'navy', ls: 6 })
  K.PERSONAS.forEach((p, i) => {
    const x = M + mw + pw + i * colW
    b += personaAvatar(x + (colW - 300) / 2, y, 300, p.color, p.icon)
    b += text(x + colW / 2, y + 420, p.id, { size: 90, weight: 800, fill: p.color, anchor: 'middle' })
    b += text(x + colW / 2, y + 520, p.short, { size: 66, weight: 600, fill: 'ink2', anchor: 'middle' })
  })
  y += 640
  const n = K.MATERIALS.length
  const rh = (BODY_BOTTOM - y - 820) / n
  K.MATERIALS.forEach((m, i) => {
    const ry = y + i * rh
    if (i % 2 === 0) b += rect(M - 40, ry, IW + 80, rh, { fill: 'white', rx: 30 })
    b += text(M, ry + rh / 2 + 34, m.name, { size: textWidth(m.name, 92, 700) > mw - 80 ? 80 : 92, weight: 700, fill: 'ink' })
    b += text(M + mw, ry + rh / 2 + 30, m.purpose, { size: textWidth(m.purpose, 80) > pw - 60 ? 70 : 80, fill: 'ink2' })
    K.PERSONAS.forEach((p, j) => {
      const v = m.personas[p.id] || 0
      const cx = M + mw + pw + j * colW + colW / 2, cy = ry + rh / 2
      if (v === 2) b += `<circle cx="${cx}" cy="${cy}" r="${rh * 0.3}" fill="${C(p.color)}"/>` + `<path d="M${cx - rh * 0.12} ${cy}l${rh * 0.08} ${rh * 0.08} ${rh * 0.16}-${rh * 0.17}" fill="none" stroke="white" stroke-width="${rh * 0.06}" stroke-linecap="round" stroke-linejoin="round"/>`
      else if (v === 1) b += `<circle cx="${cx}" cy="${cy}" r="${rh * 0.22}" fill="none" stroke="${C(p.color)}" stroke-width="${rh * 0.07}"/>`
      else b += `<circle cx="${cx}" cy="${cy}" r="${rh * 0.06}" fill="${C('line')}"/>`
    })
  })
  y += n * rh + 120
  // legend + note
  b += `<circle cx="${M + 80}" cy="${y + 90}" r="80" fill="${C('navy')}"/>` + text(M + 220, y + 120, 'Primary material for this persona', { size: 86, weight: 600, fill: 'ink' })
  b += `<circle cx="${M + 2900}" cy="${y + 90}" r="60" fill="none" stroke="${C('navy')}" stroke-width="22"/>` + text(M + 3040, y + 120, 'Supporting material', { size: 86, weight: 600, fill: 'ink' })
  b += `<circle cx="${M + 4650}" cy="${y + 90}" r="22" fill="${C('line')}"/>` + text(M + 4740, y + 120, 'Not needed', { size: 86, weight: 600, fill: 'ink' })
  b += fit((z) => para(M, y + 260, 'Honesty rules: case studies are created only after a pilot report the customer agrees to publish. The ROI calculator uses the customer’s own baselines and shows no default results. Interactive demos use the built-in demo modes with sample data, labelled as illustrative.', { size: z, fill: 'muted', italic: true, maxW: IW }), 420, 84).svg
  return poster({ num: 6, kicker: 'Persona-based educational material matrix', title: 'Which material, for which persona', summary: 'Sixteen pieces of sales and education material, mapped to the six personas. A filled mark means the material is built for that persona; a ring means it supports the conversation. Build primary materials first.', body: b, takeaway: 'Build first: product overview, executive infographic, business value presentation, persona demo videos, technical overview with security brief, and the pilot proposal. These cover every persona at the first three funnel stages.' })
}

// ---------------------------------------------------------------- 07 ----
function p07() {
  let b = '', y = BODY_TOP
  const fx = M + 260, fw = 2750, n = K.FUNNEL.length
  const cols = [['OBJECTIVE · CUSTOMER EXPECTATION', 1550], ['REQUIRED MATERIAL', 1200], ['SALES ACTIVITY', 1050], ['EXPECTED OUTCOME', 1050], ['CONVERSION METRIC', 0]]
  let cx = fx + fw + 160
  const colX = cols.map(([l, w], i) => { const x = cx; cx += w + 70; return x })
  cols[4][1] = W - M - colX[4]
  cols.forEach(([l], i) => { b += fit((z) => para(colX[i], y, l, { size: z, weight: 800, fill: 'navy', maxW: cols[i][1] }), 190, 62, 50).svg })
  y += 230
  const rh = (BODY_BOTTOM - y) / n
  const phases = [[0, 5, 'MARKETING', 'cyan'], [5, 12, 'SALES', 'violet'], [12, 15, 'CUSTOMER SUCCESS', 'teal']]
  phases.forEach(([a, z, l, col]) => {
    const y1 = y + a * rh + 10, y2 = y + z * rh - 20
    b += rect(M, y1, 170, y2 - y1, { fill: col, rx: 40 })
    b += `<text transform="translate(${M + 115} ${(y1 + y2) / 2}) rotate(-90)" font-family="'Segoe UI', Arial, sans-serif" font-size="88" font-weight="800" fill="white" text-anchor="middle" letter-spacing="10">${l}</text>`
  })
  const wTop = fw, wBot = 1450
  K.FUNNEL.forEach((s, i) => {
    const ry = y + i * rh
    const w1 = wTop - (wTop - wBot) * (i / n), w2 = wTop - (wTop - wBot) * ((i + 1) / n)
    const mid = fx + fw / 2
    const col = i < 5 ? 'cyan' : i < 12 ? 'violet' : 'teal'
    const op = 0.72 + 0.28 * ((i % 5) / 5)
    b += `<path d="M${mid - w1 / 2} ${ry + 6}H${mid + w1 / 2}L${mid + w2 / 2} ${ry + rh - 14}H${mid - w2 / 2}Z" fill="${C(col)}" fill-opacity="${op.toFixed(2)}"/>`
    b += text(mid - w2 / 2 + 70, ry + rh / 2 + 34, String(i + 1).padStart(2, '0'), { size: 96, weight: 800, fill: 'white', opacity: 0.7 })
    b += fit((z) => { const p = para(mid - w2 / 2 + 250, 0, s.stage, { size: z, weight: 700, fill: 'white', maxW: w2 - 300, lh: 1.1 }); return { ...p, ...para(mid - w2 / 2 + 250, ry + (rh - p.h) / 2 - 6, s.stage, { size: z, weight: 700, fill: 'white', maxW: w2 - 300, lh: 1.1 }) } }, rh - 50, 88, 60).svg
    if (i) b += `<line x1="${colX[0]}" y1="${ry}" x2="${W - M}" y2="${ry}" stroke="${C('line')}" stroke-width="5"/>`
    const vals = [null, s.material, s.activity, s.outcome, s.metric]
    b += fit((z) => { const a = para(colX[0], ry + 30, s.objective, { size: z, weight: 700, fill: 'ink', maxW: cols[0][1] }); const e = s.expectation === '—' ? { svg: '', h: 0 } : para(colX[0], ry + 30 + a.h + 6, 'Expects: ' + s.expectation, { size: z * 0.86, italic: true, fill: 'muted', maxW: cols[0][1] }); return { svg: a.svg + e.svg, h: a.h + 6 + e.h } }, rh - 50, 78, 58).svg
    for (let k = 1; k < 5; k++) b += fit((z) => para(colX[k], ry + 30, vals[k], { size: z, weight: k === 4 ? 700 : 400, fill: k === 4 ? col : 'ink2', maxW: cols[k][1] }), rh - 50, 78, 58).svg
  })
  return poster({ num: 7, kicker: 'APEX enterprise sales funnel', title: 'Fifteen stages from awareness to expansion', summary: 'The enterprise funnel runs from market awareness to contract closure and on into onboarding, retention and expansion. Each stage has one objective, the material it needs, the sales activity, the outcome and the metric we track.', body: b, takeaway: 'The pivot of the funnel is the paid pilot (stage 9): everything before it earns the right to a pilot; everything after it converts pilot evidence into a contract. Track conversion at every stage from the first deal.' })
}

// ---------------------------------------------------------------- 08 ----
function p08() {
  let b = '', y = BODY_TOP
  const per = 5, gw = 150, cw = (IW - (per - 1) * gw) / per, ch = 2600
  const rowY = [y + 120, y + 120 + ch + 700]
  // road
  const r1 = rowY[0] + ch / 2, r2 = rowY[1] + ch / 2
  b += `<path d="M${M - 60} ${r1}H${W - M - 200}a${(r2 - r1) / 2} ${(r2 - r1) / 2} 0 0 1 0 ${r2 - r1}H${M - 60}" fill="none" stroke="${C('navy')}" stroke-opacity="0.12" stroke-width="260" stroke-linecap="round"/>`
  b += `<path d="M${M - 60} ${r1}H${W - M - 200}a${(r2 - r1) / 2} ${(r2 - r1) / 2} 0 0 1 0 ${r2 - r1}H${M - 60}" fill="none" stroke="white" stroke-width="22" stroke-dasharray="90 70"/>`
  const feelCol = ['slate', 'blue', 'cyan', 'violet', 'amber', 'navy', 'teal', 'green', 'blue', 'violet']
  K.JOURNEY.forEach((j, i) => {
    const row = Math.floor(i / per), k = i % per
    const x = row === 0 ? M + k * (cw + gw) : M + (per - 1 - k) * (cw + gw)
    const yy = rowY[row]
    const col = feelCol[i]
    b += rect(x, yy, cw, ch, { fill: 'white', rx: 60, shadow: true }) + rect(x, yy, cw, 26, { fill: col, rx: 13 })
    b += `<circle cx="${x + 200}" cy="${yy + 270}" r="130" fill="${C(col)}"/>` + text(x + 200, yy + 310, String(i + 1), { size: 120, weight: 800, fill: 'white', anchor: 'middle' })
    b += text(x + 380, yy + 310, j.phase.toUpperCase(), { size: 112, weight: 800, fill: 'ink', ls: 4 })
    b += fitStack(x + 100, yy + 500, cw - 200, ch - 600, [['Touchpoint', j.touch, col], ['Customer feels', j.feel, 'muted'], ['What we do', j.our, 'teal']], 88).svg
  })
  y = rowY[1] + ch + 260
  b += sectionHead(M, y, 'First touch, by persona: channel and call to action', { num: 1 })
  y += 260
  const cw2 = (IW - 2 * 150) / 3, ch2 = (BODY_BOTTOM - y - 150) / 2
  K.PERSONAS.forEach((p, i) => {
    const x = M + (i % 3) * (cw2 + 150), yy = y + Math.floor(i / 3) * (ch2 + 150)
    b += rect(x, yy, cw2, ch2, { fill: 'white', rx: 56, shadow: true })
    b += personaAvatar(x + 90, yy + 90, 300, p.color, p.icon)
    b += text(x + 450, yy + 190, `PERSONA ${p.id}`, { size: 64, weight: 800, fill: p.color, ls: 5 })
    b += text(x + 450, yy + 320, p.short, { size: 108, weight: 700, fill: 'ink' })
    b += fitStack(x + 90, yy + 460, cw2 - 180, ch2 - 520, [['Channels', p.channels.join(' · '), p.color], ['Call to action', p.cta, 'amber']], 86).svg
  })
  return poster({ num: 8, kicker: 'APEX customer acquisition journey', title: 'From first touch to lasting advocate', summary: 'The customer journey has ten steps, from discovering APEX to advocating for it. At each step we know the touchpoint, how the customer feels and what we must do — and each persona has its own first channel and call to action.', body: b, takeaway: 'Design for the hand-offs: content must lead to a conversation, the demo to a pilot, the pilot to a contract and onboarding to weekly use. Advocacy (case studies) comes only from customers who saw real value.' })
}

// ---------------------------------------------------------------- 09 ----
function p09() {
  let b = '', y = BODY_TOP
  const hubH = 3900, cx = W / 2, cy = y + hubH / 2
  const mw = 3200, mh = 1650
  const pos = [[M, y], [W - M - mw, y], [M, y + hubH - mh], [W - M - mw, y + hubH - mh]]
  pos.forEach(([x, yy]) => { b += `<line x1="${x + mw / 2}" y1="${yy + mh / 2}" x2="${cx}" y2="${cy}" stroke="${C('line')}" stroke-width="22"/>` })
  b += `<circle cx="${cx}" cy="${cy}" r="1150" fill="url(#hdr)"/><circle cx="${cx}" cy="${cy}" r="1230" fill="none" stroke="url(#accentBar)" stroke-width="30"/>`
  b += `<g transform="translate(${cx - 230} ${cy - 900}) scale(14.4)"><path d="M16 2.5 29 27H3L16 2.5Z" stroke="url(#apexMark)" stroke-width="2.1" stroke-linejoin="round" fill="none"/><path d="M16 12.5 22 24H10l6-11.5Z" fill="url(#apexMark)" fill-opacity=".85"/></g>`
  b += text(cx, cy - 330, 'ONE FRONT DOOR', { size: 116, weight: 800, fill: 'white', anchor: 'middle', ls: 6 })
  const hl = ['Find what you need.', 'Present it with confidence.', 'Prove your team knows it.']
  hl.forEach((l, i) => { b += text(cx, cy - 120 + i * 170, l, { size: 112, weight: 600, fill: '#CBD5E1', anchor: 'middle' }) })
  b += text(cx, cy + 520, 'Self-hosted · your Dropbox · AI optional', { size: 84, weight: 600, fill: '#5EEAD4', anchor: 'middle' })
  K.PRODUCT.modules.forEach((m, i) => {
    const [x, yy] = pos[i]
    const c = card(x, yy, mw, mh, { title: m.name, icon: m.icon, accent: m.color, titleSize: 104 })
    b += c.svg + fit((z) => para(c.body.x, c.body.y, m.what, { size: z, maxW: c.body.w }), c.body.h, 90).svg
  })
  y += hubH + 230
  b += sectionHead(M, y, 'The value, in each persona’s words', { num: 1 })
  y += 260
  const cw = (IW - 2 * 150) / 3, ch = 1550
  K.PERSONAS.forEach((p, i) => {
    const x = M + (i % 3) * (cw + 150), yy = y + Math.floor(i / 3) * (ch + 150)
    b += rect(x, yy, cw, ch, { fill: 'white', rx: 56, shadow: true }) + rect(x, yy, 26, ch, { fill: p.color, rx: 13 })
    b += text(x + 120, yy + 180, `${p.id} · ${p.short.toUpperCase()}`, { size: 76, weight: 800, fill: p.color, ls: 5 })
    b += fit((z) => { const a = para(x + 120, yy + 240, p.message, { size: z, weight: 700, fill: 'ink', maxW: cw - 240 }); const v = para(x + 120, yy + 270 + a.h, p.value, { size: z * 0.82, fill: 'ink2', maxW: cw - 240 }); return { svg: a.svg + v.svg, h: a.h + 30 + v.h } }, ch - 320, 104).svg
  })
  y += 2 * ch + 150 + 230
  const lw = (IW - 150) / 2, hh = BODY_BOTTOM - y
  ;[[M, 'Differentiators that exist today', 'green', 'check', K.PRODUCT.differentiators], [M + lw + 150, 'On the roadmap — say so plainly', 'slate', 'route', K.PRODUCT.roadmap]].forEach(([x, t, col, ic, items]) => {
    const c = card(x, y, lw, hh, { title: t, accent: col, icon: ic, titleSize: 100 })
    b += c.svg + fit((z) => bullets(c.body.x, c.body.y, items, { size: z, maxW: c.body.w, dot: col, gap: 0.3 }), c.body.h, 90).svg
  })
  return poster({ num: 9, kicker: 'APEX product value proposition', title: 'What APEX does — and what it is worth', summary: 'Four built and tested products behind one secure front door: a solution showcase, a presentation library and an academy that turns playbooks into certified capability. The value differs by persona, so we state it in their words.', body: b, takeaway: 'Sell the combination no single tool gives: portfolio, sales library and certified learning, self-hosted on the customer’s own storage. Be explicit that hosting, SSO and live Dropbox are still on the roadmap.' })
}

// ---------------------------------------------------------------- 10 ----
function p10() {
  let b = '', y = BODY_TOP
  b += sectionHead(M, y, 'Approach by segment', { num: 1 })
  y += 250
  const cols = [['SEGMENT', 1900], ['ENTRY PERSONA', 1650], ['LEAD WITH', 1500], ['OPENING MESSAGE', 2150], ['FIRST OFFER', 0]]
  let cx = M
  const colX = cols.map(([, w]) => { const x = cx; cx += w + 60; return x })
  cols[4][1] = W - M - colX[4]
  cols.forEach(([l], i) => { b += text(colX[i] + 40, y + 80, l, { size: 68, weight: 800, fill: 'navy', ls: 5 }) })
  y += 140
  const rh = 570
  K.ENGAGEMENT.forEach((e, i) => {
    const ry = y + i * (rh + 40)
    b += rect(M, ry, IW, rh, { fill: 'white', rx: 46, shadow: true })
    b += rect(M, ry, 26, rh, { fill: ['cyan', 'violet', 'blue', 'navy', 'amber'][i], rx: 13 })
    const vals = [e.segment, e.entry, e.lead, `“${e.message}”`, e.offer]
    vals.forEach((v, k) => { b += fit((z) => para(colX[k] + 40, ry + (rh - wrap(v, z, cols[k][1] - 80, k === 0 ? 700 : 400).length * z * 1.32) / 2 - 10, v, { size: z, weight: k === 0 ? 700 : k === 4 ? 600 : 400, fill: k === 0 ? 'ink' : k === 4 ? 'teal' : 'ink2', italic: k === 3, maxW: cols[k][1] - 80 }), rh - 60, 92).svg })
  })
  y += 5 * (rh + 40) + 200
  b += sectionHead(M, y, 'Four ways into an account', { num: 2 })
  y += 260
  const pw = (IW - 3 * 150) / 4, ph = 1380
  K.ENGAGEMENT_PLAYS.forEach((p, i) => {
    const c = card(M + i * (pw + 150), y, pw, ph, { title: p.name, accent: ['navy', 'blue', 'violet', 'amber'][i], icon: ['crown', 'chart', 'chip', 'handshake'][i], titleSize: 112 })
    b += c.svg + fit((z) => para(c.body.x, c.body.y, p.text, { size: z, maxW: c.body.w }), c.body.h, 96).svg
  })
  y += ph + 230
  b += sectionHead(M, y, 'Pricing framework (no prices set yet)', { num: 3 })
  y += 260
  const lw = 5600, hh = BODY_BOTTOM - y
  const c1 = card(M, y, lw, hh, { title: 'Commercial models to offer', accent: 'teal', icon: 'coin', titleSize: 100 })
  b += c1.svg
  const rr = c1.body.h / K.POSITIONING.pricingModels.length
  K.POSITIONING.pricingModels.forEach((m, i) => {
    const ry = c1.body.y + i * rr
    if (i) b += `<line x1="${c1.body.x}" y1="${ry - 35}" x2="${c1.body.x + c1.body.w}" y2="${ry - 35}" stroke="${C('line')}" stroke-width="5"/>`
    b += fit((z) => para(c1.body.x, ry, m.model, { size: z, weight: 700, fill: 'ink', maxW: 1900 }), rr - 70, 84).svg
    b += fit((z) => para(c1.body.x + 2000, ry, m.fit, { size: z, maxW: c1.body.w - 2000 }), rr - 70, 82).svg
  })
  const c2 = card(M + lw + 150, y, IW - lw - 150, hh, { title: 'Information needed to set prices', accent: 'amber', icon: 'search', titleSize: 100 })
  b += c2.svg + fit((z) => bullets(c2.body.x, c2.body.y, K.POSITIONING.pricingInputs, { size: z, maxW: c2.body.w, dot: 'amber', gap: 0.3 }), c2.body.h, 90).svg
  return poster({ num: 10, kicker: 'APEX commercial engagement strategy', title: 'How we approach each segment and decision maker', summary: 'Each segment has a natural entry persona, a lead module and a first offer. We choose one of four plays per account, and we offer a clear pricing framework — models, not invented numbers — until delivery costs and pilot findings set the prices.', body: b, takeaway: 'Enter where the pain is sharpest with one module and a paid pilot, then expand to the full front door. Publish prices only after delivery costs and pilot value are known; until then, sell the framework and the pilot.' })
}

// ---------------------------------------------------------------- 11 ----
function p11() {
  let b = '', y = BODY_TOP
  const steps = [['Prepare', 'Research the account; load their scenario in a demo mode', 'doc'], ['Open with the problem', 'State their pain in their words', 'bulb'], ['Show', 'Only the capabilities that answer it — live, not slides', 'play'], ['Prove', 'One verifiable proof point', 'check'], ['Agree next step', 'One clear action with a date', 'flag']]
  const sw = (IW - 4 * 170) / 5, sh = 1500
  steps.forEach(([t, d, ic], i) => {
    const x = M + i * (sw + 170)
    b += rect(x, y, sw, sh, { fill: 'navy', rx: 60, shadow: true })
    b += iconBadge(x + 90, y + 100, 260, ic, ['slate', 'rose', 'violet', 'green', 'amber'][i])
    b += text(x + 400, y + 210, `STEP ${i + 1}`, { size: 70, weight: 800, fill: '#7DD3FC', ls: 6 })
    b += fit((z) => para(x + 90, y + 420, t, { size: z, weight: 700, fill: 'white', maxW: sw - 180, lh: 1.15 }), 300, 108).svg
    b += fit((z) => para(x + 90, y + 760, d, { size: z, fill: '#CBD5E1', maxW: sw - 180 }), sh - 820, 88).svg
    if (i < 4) b += arrow(x + sw + 20, y + sh / 2, x + sw + 150, y + sh / 2, { color: 'cyan', sw: 16, head: 54 })
  })
  y += sh + 230
  b += sectionHead(M, y, 'Persona-specific demonstrations', { num: 1 })
  y += 260
  const cw = (IW - 2 * 150) / 3, ch = 3300
  K.DEMOS.forEach((d, i) => {
    const p = PBY[d.persona]
    const x = M + (i % 3) * (cw + 150), yy = y + Math.floor(i / 3) * (ch + 150)
    b += rect(x, yy, cw, ch, { fill: 'white', rx: 60, shadow: true }) + rect(x, yy, cw, 26, { fill: p.color, rx: 13 })
    b += personaAvatar(x + 90, yy + 110, 300, p.color, p.icon)
    b += text(x + 450, yy + 210, `PERSONA ${p.id}`, { size: 64, weight: 800, fill: p.color, ls: 5 })
    b += text(x + 450, yy + 330, p.short, { size: 104, weight: 700, fill: 'ink' })
    b += pill(x + cw - 90 - textWidth(d.length, 66, 700) - 92, yy + 110, d.length, { fill: p.color, size: 66 }).svg
    b += fitStack(x + 90, yy + 500, cw - 180, ch - 580, [['Show', d.show, 'violet'], ['Proof point', d.proof, 'green'], ['Avoid', d.avoid, 'rose'], ['Close on', d.close, 'amber']], 90).svg
  })
  y += 2 * ch + 150 + 230
  const rh = BODY_BOTTOM - y
  b += rect(M, y, IW, rh, { fill: 'white', rx: 60, stroke: 'rose', sw: 8 })
  b += text(M + 120, y + 190, 'DEMO RULES — NON-NEGOTIABLE', { size: 84, weight: 800, fill: 'rose', ls: 6 })
  const hw = (IW - 360) / 2
  b += fit((z) => bullets(M + 120, y + 270, K.DEMO_RULES.slice(0, 2), { size: z, maxW: hw, dot: 'rose', gap: 0.3 }), rh - 330, 90).svg
  b += fit((z) => bullets(M + 240 + hw, y + 270, K.DEMO_RULES.slice(2), { size: z, maxW: hw, dot: 'rose', gap: 0.3 }), rh - 330, 90).svg
  return poster({ num: 11, kicker: 'APEX product demonstration strategy', title: 'Demonstrate the right thing to the right person', summary: 'A demonstration is not a product tour. It follows five steps, is tailored to one persona, shows only live capabilities that answer that persona’s problem, ends on one proof point and one next step, and uses the built-in demo modes with sample data.', body: b, takeaway: 'Short for executives, deep for operations and technology, hands-on for users and partners. A demo succeeds when the persona agrees a dated next step — a sponsor, pilot teams, a champion, technical sign-off or a partner talk.' })
}

// ---------------------------------------------------------------- 12 ----
function p12() {
  let b = '', y = BODY_TOP
  const n = K.BUYING_STAGES.length
  const lineX = M + 520
  const cols = [['STAGE', 2100], ['STAKEHOLDERS', 1400], ['TYPICAL OBJECTION', 2300], ['APPROVAL GATE', 0]]
  let cx = lineX + 300
  const colX = cols.map(([, w]) => { const x = cx; cx += w + 80; return x })
  cols[3][1] = W - M - colX[3]
  cols.forEach(([l], i) => { b += text(colX[i], y + 80, l, { size: 70, weight: 800, fill: 'navy', ls: 5 }) })
  y += 170
  const rh = 840, gap = 60
  b += `<rect x="${lineX - 20}" y="${y + rh / 2}" width="40" height="${(n - 1) * (rh + gap)}" rx="20" fill="url(#vbar)"/>`
  b += `<defs><linearGradient id="vbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06B6D4"/><stop offset="1" stop-color="#7C3AED"/></linearGradient></defs>`
  K.BUYING_STAGES.forEach((s, i) => {
    const ry = y + i * (rh + gap)
    b += rect(lineX + 200, ry, W - M - lineX - 200, rh, { fill: 'white', rx: 50, shadow: true })
    b += `<circle cx="${lineX}" cy="${ry + rh / 2}" r="180" fill="${C('navy')}" stroke="white" stroke-width="22"/>` + text(lineX, ry + rh / 2 + 50, String(i + 1), { size: 150, weight: 800, fill: 'white', anchor: 'middle' })
    b += fit((z) => para(colX[0], ry + (rh - z * 1.3 * wrap(s.stage, z, cols[0][1], 700).length) / 2, s.stage, { size: z, weight: 700, fill: 'ink', maxW: cols[0][1] }), rh - 80, 116).svg
    const ids = s.who.split(',').map((t) => t.trim()).map((t) => (t === 'Governance' ? 'GOV' : t))
    b += chips(colX[1], ry + (rh - 190) / 2, ids, 190).svg
    b += fit((z) => para(colX[2], ry + (rh - z * 1.3 * wrap(s.objection, z, cols[2][1], 400).length) / 2, s.objection, { size: z, italic: true, fill: 'rose', weight: 600, maxW: cols[2][1] }), rh - 80, 100).svg
    b += icon(colX[3], ry + rh / 2 - 90, 180, 'check', 'green', 9)
    b += fit((z) => para(colX[3] + 240, ry + (rh - z * 1.3 * wrap(s.approval, z, cols[3][1] - 240, 600).length) / 2, s.approval, { size: z, weight: 600, fill: 'ink', maxW: cols[3][1] - 240 }), rh - 80, 100).svg
  })
  // legend for persona chips (left column)
  y += n * (rh + gap) + 140
  const hh = BODY_BOTTOM - y
  const lw = 4300
  const c1 = card(M, y, lw, hh, { title: 'Stakeholder key', accent: 'navy', icon: 'users', titleSize: 100 })
  b += c1.svg
  const items = [...K.PERSONAS.map((p) => [p.id, `${p.short} — ${p.role}`]), ['GOV', 'Procurement, security, legal, finance']]
  const rr = c1.body.h / 4
  items.forEach(([id, t], i) => {
    const x = c1.body.x + (i % 2) * (c1.body.w / 2), yy = c1.body.y + Math.floor(i / 2) * rr
    const c = chip(x, yy, id, 140)
    b += c.svg + fit((z) => para(x + c.w + 50, yy + 10, t, { size: z, maxW: c1.body.w / 2 - c.w - 90 }), rr - 20, 76).svg
  })
  const c2 = card(M + lw + 150, y, IW - lw - 150, hh, { title: 'How to keep the decision moving', accent: 'teal', icon: 'route', titleSize: 100 })
  b += c2.svg + fit((z) => bullets(c2.body.x, c2.body.y, ['Send the security & governance brief before the technical review.', 'Agree pilot success criteria in writing before the pilot starts.', 'Build the business case from pilot data, not projections.', 'Disclose roadmap gaps (SSO, hosting, data export) early — late surprises kill deals.'], { size: z, maxW: c2.body.w, dot: 'teal', gap: 0.3 }), c2.body.h, 90).svg
  return poster({ num: 12, kicker: 'APEX enterprise buying decision journey', title: 'How an organisation decides to buy APEX', summary: 'Eight evaluation stages, from recognising the need to the signature. At each stage different stakeholders join, raise a predictable objection and must pass an approval gate. Anticipating each objection keeps the decision moving.', body: b, takeaway: 'Plan the deal backwards from the signature: know who approves each gate, prepare the answer to each objection before it is raised, and let pilot evidence — not promises — carry the business case.' })
}

export const POSTERS = [
  { n: 1, dir: '01_Commercial_Positioning', file: 'APEX_Commercial_Positioning_A0', title: 'Commercial Business Positioning', build: p01 },
  { n: 2, dir: '02_Customer_Segmentation', file: 'APEX_Customer_Segmentation_A0', title: 'Target Customer Segmentation', build: p02 },
  { n: 3, dir: '03_Persona_Hierarchy', file: 'APEX_Persona_Hierarchy_A0', title: 'Customer Persona Hierarchy', build: p03 },
  { n: 4, dir: '04_PainPoints_Value', file: 'APEX_PainPoints_Value_A0', title: 'Persona Pain Points vs Business Value', build: p04 },
  { n: 5, dir: '05_Persona_Education', file: 'APEX_Persona_Education_A0', title: 'What We Should Teach Each Persona', build: p05 },
  { n: 6, dir: '06_Educational_Material_Matrix', file: 'APEX_Educational_Material_Matrix_A0', title: 'Persona-Based Educational Material Matrix', build: p06 },
  { n: 7, dir: '07_Enterprise_Sales_Funnel', file: 'APEX_Enterprise_Sales_Funnel_A0', title: 'Enterprise Sales Funnel', build: p07 },
  { n: 8, dir: '08_Customer_Acquisition', file: 'APEX_Customer_Acquisition_A0', title: 'Customer Acquisition Journey', build: p08 },
  { n: 9, dir: '09_Value_Proposition', file: 'APEX_Value_Proposition_A0', title: 'Product Value Proposition', build: p09 },
  { n: 10, dir: '10_Commercial_Engagement', file: 'APEX_Commercial_Engagement_A0', title: 'Commercial Engagement Strategy', build: p10 },
  { n: 11, dir: '11_Product_Demonstration', file: 'APEX_Product_Demonstration_A0', title: 'Product Demonstration Strategy', build: p11 },
  { n: 12, dir: '12_Buying_Decision_Journey', file: 'APEX_Buying_Decision_Journey_A0', title: 'Enterprise Buying Decision Journey', build: p12 },
]
