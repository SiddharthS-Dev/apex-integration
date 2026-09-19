/**
 * Client-side multi-page monthly report, rendered with jsPDF.
 *
 * Layout is A4 portrait in points. Every writer returns the y it finished at, and
 * `flow()` starts a new page whenever the next block would overrun the footer.
 */
import { jsPDF } from 'jspdf'

const PAGE = { w: 595.28, h: 841.89 }
const M = { l: 48, r: 48, t: 56, b: 62 }
const CONTENT_W = PAGE.w - M.l - M.r

/*
 * Tuples, not arrays: these are spread into jsPDF's setFillColor/setTextColor,
 * which take exactly three numbers. Typed as number[] the spread is unchecked,
 * and a four-element palette entry would sail through to a runtime error.
 */
/** @type {[number, number, number]} */
const INK = [10, 10, 12]
/** @type {[number, number, number]} */
const PANEL = [16, 17, 24]
/** @type {[number, number, number]} */
const CY = [0, 176, 200]
/** @type {[number, number, number]} */
const EM = [0, 190, 140]
/** @type {[number, number, number]} */
const CHALK = [244, 244, 249]
/** @type {[number, number, number]} */
const MUTED = [150, 152, 165]

export function buildReportModel(data, date = new Date()) {
  const month = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const { items, cats, techs, totalCount, esgN, aiN, iotN, flagshipN } = data

  const byCat = cats.map((c) => ({
    ...c,
    share: Math.round((c.count / totalCount) * 100),
    milestones: items
      .filter((i) => i.cat === c.name)
      .slice(0, 4)
      .map((i) => ({ title: i.title, note: i.takeaway || i.objective || '' })),
  }))

  const topTech = techs
    .map((t) => ({ name: t, count: items.filter((i) => i.tech.includes(t)).length }))
    .sort((a, b) => b.count - a.count)

  return {
    month,
    generatedAt: date,
    kpis: [
      { label: 'Total plates', value: totalCount },
      { label: 'Categories', value: cats.length },
      { label: 'Tech domains', value: techs.length },
      { label: 'AI-driven', value: aiN },
      { label: 'IoT-enabled', value: iotN },
      { label: 'ESG-linked', value: esgN },
      { label: 'Flagship', value: flagshipN },
      { label: 'Products', value: 5 },
    ],
    summary: [
      `The Inspironics innovation estate closed ${month} at ${totalCount} published architecture plates spanning ${cats.length} categories and ${techs.length} technology domains.`,
      `${aiN} plates now carry an AI or agentic component and ${iotN} are IoT-enabled, reflecting the continued shift from static schematics toward instrumented, closed-loop systems.`,
      `${esgN} plates are explicitly ESG-linked, driven by carbon accounting work landing in the Caleido Mints line, while ${byCat[0].name} remains the largest single body of work at ${byCat[0].count} plates.`,
    ],
    byCat,
    topTech,
    roadmap: [
      ['Portfolio twin depth', 'Extend Cielo Epic roll-ups so facility twins aggregate without manual mapping.'],
      ['Edge inference footprint', 'Push more Machine Learning plates from cloud scoring to on-site Edge AI.'],
      ['Carbon attribution', 'Close the gap between metered consumption and scope-3 attribution in Mints.'],
      ['Zero-trust baseline', 'Bring the Security posture in the healthcare zone to every other zone.'],
      ['Marketplace surface', 'Package the most-reused components as installable modules.'],
    ],
  }
}

/** Generates the PDF and returns the jsPDF instance. */
export function generateReportPdf(data, { date = new Date(), save = true } = {}) {
  const model = buildReportModel(data, date)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const bg = () => {
    doc.setFillColor(...INK)
    doc.rect(0, 0, PAGE.w, PAGE.h, 'F')
  }

  let y = 0
  const newPage = () => {
    doc.addPage()
    bg()
    y = M.t
  }
  /** Ensures `need` points of room, adding a page if not. */
  const flow = (need) => {
    if (y + need > PAGE.h - M.b) newPage()
  }

  const text = (str, x, yy, { size = 10, color = MUTED, style = 'normal', maxW = CONTENT_W, lh = 1.45 } = {}) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(String(str), maxW)
    doc.text(lines, x, yy)
    return lines.length * size * lh
  }

  const rule = (yy, /** @type {[number, number, number]} */ color = [40, 42, 54]) => {
    doc.setDrawColor(...color)
    doc.setLineWidth(0.7)
    doc.line(M.l, yy, PAGE.w - M.r, yy)
  }

  const sectionTitle = (label, title) => {
    flow(72)
    doc.setFont('courier', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...CY)
    doc.text(label.toUpperCase(), M.l, y)
    y += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.setTextColor(...CHALK)
    doc.text(title, M.l, y)
    y += 10
    rule(y, [0, 90, 105])
    y += 20
  }

  /* -------------------------------------------------------------- cover -- */
  bg()
  doc.setFillColor(6, 8, 18)
  doc.rect(0, 0, PAGE.w, 250, 'F')
  doc.setDrawColor(...CY)
  doc.setLineWidth(1.4)
  doc.line(M.l, 236, PAGE.w - M.r, 236)

  y = 84
  doc.setFont('courier', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CY)
  doc.text('INSPIRONICS  ·  INNOVATION SHOWCASE', M.l, y)

  y += 40
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...CHALK)
  doc.text('Monthly Innovation', M.l, y)
  y += 34
  doc.text('Report', M.l, y)

  y += 30
  doc.setFont('courier', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...MUTED)
  doc.text(model.month.toUpperCase(), M.l, y)

  y = 292

  /* ------------------------------------------------------ exec summary -- */
  sectionTitle('01 · Executive summary', 'Where the estate stands')
  model.summary.forEach((p) => {
    flow(60)
    y += text(p, M.l, y, { size: 10.5, color: [200, 202, 214] }) + 10
  })

  /* --------------------------------------------------------------- KPIs -- */
  y += 12
  sectionTitle('02 · Key metrics', 'The numbers behind the library')

  const cols = 4
  const gap = 12
  const cw = (CONTENT_W - gap * (cols - 1)) / cols
  const chh = 62
  model.kpis.forEach((k, i) => {
    const col = i % cols
    if (col === 0) flow(chh + gap)
    const x = M.l + col * (cw + gap)
    const yy = y
    doc.setFillColor(...PANEL)
    doc.roundedRect(x, yy, cw, chh, 6, 6, 'F')
    doc.setDrawColor(34, 36, 48)
    doc.roundedRect(x, yy, cw, chh, 6, 6, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(19)
    doc.setTextColor(...(i % 2 ? EM : CY))
    doc.text(String(k.value), x + 12, yy + 30)
    doc.setFont('courier', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(k.label.toUpperCase(), x + 12, yy + 47)
    if (col === cols - 1) y += chh + gap
  })
  if (model.kpis.length % cols) y += chh + gap

  /* ----------------------------------------------------- tech breakdown -- */
  y += 8
  sectionTitle('03 · Domain coverage', 'Plates by technology domain')
  const max = model.topTech[0]?.count || 1
  model.topTech.forEach((t) => {
    flow(24)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...CHALK)
    doc.text(t.name, M.l, y + 8)
    const barX = M.l + 150
    const barW = CONTENT_W - 150 - 34
    doc.setFillColor(24, 26, 36)
    doc.roundedRect(barX, y, barW, 10, 3, 3, 'F')
    doc.setFillColor(...CY)
    doc.roundedRect(barX, y, Math.max(3, (t.count / max) * barW), 10, 3, 3, 'F')
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(String(t.count), PAGE.w - M.r - 20, y + 8)
    y += 20
  })

  /* -------------------------------------------------------- milestones --- */
  y += 14
  sectionTitle('04 · Milestones by category', 'What shipped this cycle')
  model.byCat.forEach((c) => {
    flow(96)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...CHALK)
    doc.text(c.name, M.l, y)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...EM)
    doc.text(`${c.count} PLATES · ${c.share}%`, PAGE.w - M.r - 92, y)
    y += 8
    rule(y, [30, 32, 44])
    y += 14

    c.milestones.forEach((m) => {
      flow(44)
      doc.setFillColor(...CY)
      doc.circle(M.l + 3, y - 3, 1.8, 'F')
      y += text(m.title, M.l + 14, y, { size: 9.5, color: CHALK, style: 'bold', maxW: CONTENT_W - 14 })
      if (m.note) y += text(m.note, M.l + 14, y, { size: 8.5, color: MUTED, maxW: CONTENT_W - 14 }) + 4
      y += 4
    })
    y += 10
  })

  /* ----------------------------------------------------------- roadmap --- */
  y += 6
  sectionTitle('05 · Roadmap', 'Where the next cycle goes')
  model.roadmap.forEach(([t, d], i) => {
    flow(52)
    doc.setFillColor(...PANEL)
    doc.roundedRect(M.l, y - 12, CONTENT_W, 44, 6, 6, 'F')
    doc.setFont('courier', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...CY)
    doc.text(`0${i + 1}`, M.l + 12, y + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...CHALK)
    doc.text(t, M.l + 36, y + 2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(doc.splitTextToSize(d, CONTENT_W - 52), M.l + 36, y + 16)
    y += 54
  })

  /* ------------------------------------------------------------ footers -- */
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(30, 32, 44)
    doc.setLineWidth(0.6)
    doc.line(M.l, PAGE.h - 42, PAGE.w - M.r, PAGE.h - 42)
    doc.setFont('courier', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(`INSPIRONICS · ${model.month.toUpperCase()}`, M.l, PAGE.h - 27)
    doc.text(`${p} / ${pages}`, PAGE.w - M.r - 24, PAGE.h - 27)
  }

  if (save) doc.save(`inspironics-innovation-report-${model.month.toLowerCase().replace(/\s+/g, '-')}.pdf`)
  return doc
}
