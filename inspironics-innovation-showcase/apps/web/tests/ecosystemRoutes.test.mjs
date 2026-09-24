import { strict as assert } from 'node:assert'
import test from 'node:test'

// ecosystemData pulls in productEnrichment, which is plain data — no browser
// globals needed here.
const { matchesRoute, countMatches, routeLabel, nodeById, NODES, CONDUITS } = await import(
  '#features/ecosystem/model'
)

const item = (over = {}) => ({
  f: 'x',
  cat: 'Command Decks',
  tech: ['Edge AI', 'Security'],
  _hay: 'edge inference mesh kombos gateway',
  ...over,
})

test('a missing route matches everything', () => {
  assert.equal(matchesRoute(item(), null), true)
  assert.equal(matchesRoute(item(), undefined), true)
})

test('cat routes match on exact category', () => {
  assert.equal(matchesRoute(item(), { type: 'cat', value: 'Command Decks' }), true)
  assert.equal(matchesRoute(item(), { type: 'cat', value: 'Data & Analytics' }), false)
  // no partial or case-insensitive matching on categories
  assert.equal(matchesRoute(item(), { type: 'cat', value: 'command decks' }), false)
})

test('tech routes require the domain to be present', () => {
  assert.equal(matchesRoute(item(), { type: 'tech', value: 'Edge AI' }), true)
  assert.equal(matchesRoute(item(), { type: 'tech', value: 'Marketplace' }), false)
  assert.equal(matchesRoute(item({ tech: undefined }), { type: 'tech', value: 'Edge AI' }), false)
})

test('q routes need every token, in any order', () => {
  assert.equal(matchesRoute(item(), { type: 'q', value: 'kombos' }), true)
  assert.equal(matchesRoute(item(), { type: 'q', value: 'mesh kombos' }), true)
  assert.equal(matchesRoute(item(), { type: 'q', value: 'KOMBOS  Mesh ' }), true)
  assert.equal(matchesRoute(item(), { type: 'q', value: 'kombos missing' }), false)
  assert.equal(matchesRoute(item({ _hay: undefined }), { type: 'q', value: 'kombos' }), false)
})

test('an empty q route means "everything", not "nothing"', () => {
  assert.equal(matchesRoute(item(), { type: 'q', value: '' }), true)
  assert.equal(matchesRoute(item(), { type: 'q', value: '   ' }), true)
})

test('countMatches counts, and treats an empty route as the whole set', () => {
  const items = [item(), item({ cat: 'Data & Analytics' }), item({ tech: ['Marketplace'] })]
  assert.equal(countMatches(items, { type: 'cat', value: 'Command Decks' }), 2)
  assert.equal(countMatches(items, { type: 'tech', value: 'Edge AI' }), 2)
  assert.equal(countMatches(items, null), 3)
  assert.equal(countMatches(items, { type: 'q', value: '' }), 3)
  assert.equal(countMatches([], { type: 'cat', value: 'Command Decks' }), 0)
})

test('routeLabel describes each route type', () => {
  assert.equal(routeLabel(null), 'All innovations')
  assert.equal(routeLabel({ type: 'cat', value: 'Command Decks' }), 'Category · Command Decks')
  assert.equal(routeLabel({ type: 'tech', value: 'Edge AI' }), 'Tech domain · Edge AI')
  assert.equal(routeLabel({ type: 'q', value: 'kombos' }), 'Search · "kombos"')
  assert.equal(routeLabel({ type: 'q', value: '' }), 'All innovations')
})

test('every node is addressable by id and carries a route and a position', () => {
  assert.ok(NODES.length > 15)
  for (const n of NODES) {
    assert.equal(nodeById(n.id), n, `nodeById lost ${n.id}`)
    assert.ok(n.route, `${n.id} has no route`)
    assert.equal(n.pos?.length, 3, `${n.id} has no 3D position`)
    assert.ok(n.color && n.name && n.kind, `${n.id} is missing display fields`)
  }
  assert.equal(new Set(NODES.map((n) => n.id)).size, NODES.length, 'node ids must be unique')
})

test('nodeById is undefined for an unknown id rather than throwing', () => {
  assert.equal(nodeById('no-such-node'), undefined)
})

test('every conduit joins two real points with a colour', () => {
  assert.ok(CONDUITS.length > 10)
  for (const c of CONDUITS) {
    assert.equal(c.from?.length, 3)
    assert.equal(c.to?.length, 3)
    assert.match(c.color, /^#[0-9a-f]{6}$/i)
  }
})
