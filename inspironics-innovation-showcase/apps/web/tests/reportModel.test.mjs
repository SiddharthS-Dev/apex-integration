/**
 * The monthly report is computed from the catalog — including an empty one.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

const { buildReportModel } = await import('../src/features/report/lib/reportPdf.js')

const kpi = (model, label) => model.kpis.find((k) => k.label === label)?.value

test('an empty library gives a valid "no data yet" report', () => {
  const m = buildReportModel({ items: [], cats: [], techs: [], totalCount: 0, productCounts: {} }, new Date(2026, 9, 6))
  assert.equal(m.summary.length, 1)
  assert.match(m.summary[0], /no plates yet/)
  assert.equal(kpi(m, 'Total plates'), 0)
  assert.equal(kpi(m, 'Products'), 0)
  assert.deepEqual(m.byCat, [])
  assert.ok(!m.summary.join(' ').includes('NaN'))
})

test('"this month" filters by modifiedAt, and products are counted from the data', () => {
  const item = (cat, modifiedAt, title) => ({ cat, tech: ['Edge AI'], modifiedAt, title })
  const items = [item('Grid', '2026-10-02T10:00:00Z', 'New grid plate'), item('Grid', '2026-08-01T10:00:00Z', 'Old grid plate'), item('Water', '2026-07-01T10:00:00Z', 'Old water plate')]
  const data = { items, cats: [{ name: 'Grid', count: 2 }, { name: 'Water', count: 1 }], techs: ['Edge AI', 'Unused'], totalCount: 3, aiN: 1, productCounts: { kombos: 2, mints: 0 } }
  const m = buildReportModel(data, new Date(2026, 9, 15))
  assert.equal(kpi(m, 'Products'), 1)
  assert.equal(kpi(m, 'Changed in October'), 1)
  assert.equal(kpi(m, 'Tech domains'), 1, 'a domain no plate uses is not counted')
  assert.deepEqual(m.byCat.find((c) => c.name === 'Grid').milestones.map((x) => x.title), ['New grid plate'])
  assert.deepEqual(m.byCat.find((c) => c.name === 'Water').milestones, [])
  assert.match(m.milestones.title, /October 2026/)
  assert.ok(!/Caleido Mints|roadmap/i.test(JSON.stringify(m)))
})

test('undated records (the demo corpus) get a snapshot, labelled as one', () => {
  const data = { items: [{ cat: 'Grid', tech: [], title: 'A' }], cats: [{ name: 'Grid', count: 1 }], techs: [], totalCount: 1 }
  const m = buildReportModel(data)
  assert.equal(m.milestones.label, 'Library by category')
  assert.equal(m.byCat[0].milestones.length, 1)
  assert.match(m.summary[1], /no dates/)
})
