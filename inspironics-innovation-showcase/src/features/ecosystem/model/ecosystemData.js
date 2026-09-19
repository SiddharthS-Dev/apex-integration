/**
 * Ecosystem Explorer configuration — the zones, product nodes and stack layers
 * that make up the 3D smart city, plus the routing/count helpers that connect a
 * clicked node to the gallery filters.
 *
 * Every node carries a `route` of { type: 'cat' | 'tech' | 'q', value }.
 *
 * Zone routes point at the category or tech domain that zone actually exercises,
 * because the corpus is organised technically — it has no "agriculture" or "hotel"
 * vocabulary for a q-route to hit. Product nodes keep q-routes, which resolve
 * through the extraKeywords injected by productEnrichment.js. No route may return
 * an empty gallery — `npm run check:routes` asserts that against the dataset.
 */
import { PRODUCTS } from '#features/showcase/model'

export const CY = '#00F0FF'
export const EM = '#00FFB2'
export const AMBER = '#FFB347'
export const VIOLET = '#B48CFF'

/** Zone clusters laid out around the central landmark tower. */
export const ZONES = [
  {
    id: 'energy',
    name: 'Smart Energy',
    color: EM,
    pos: [-46, 0, -34],
    kind3d: 'solar',
    blurb:
      'Generation, storage and grid-balancing assets instrumented end to end — solar arrays, turbines and battery banks metered into one carbon and energy ledger.',
    route: { type: 'tech', value: 'Carbon / ESG' },
  },
  {
    id: 'agri',
    name: 'Smart Agri',
    color: '#7CFF9B',
    pos: [-58, 0, 22],
    kind3d: 'field',
    blurb:
      'Precision agriculture: soil and canopy sensing, irrigation control and yield forecasting, all driven by inference running at the edge rather than in the cloud.',
    route: { type: 'tech', value: 'Edge AI' },
  },
  {
    id: 'residential',
    name: 'Residential',
    color: '#8FD8FF',
    pos: [-20, 0, 50],
    kind3d: 'homes',
    blurb:
      'Connected living spaces — comfort, safety and energy automation delivered to homes and apartment portfolios as a subscription platform.',
    route: { type: 'tech', value: 'SaaS Platform' },
  },
  {
    id: 'cities',
    name: 'Smart Cities',
    color: CY,
    pos: [26, 0, 48],
    kind3d: 'towers',
    blurb:
      'Municipal-scale infrastructure: mobility, lighting, waste and public-safety systems fused into a single urban command surface.',
    route: { type: 'cat', value: 'Command Decks' },
  },
  {
    id: 'hospitality',
    name: 'Hospitality',
    color: AMBER,
    pos: [56, 0, 16],
    kind3d: 'resort',
    blurb:
      'Guest-experience orchestration across rooms, venues and back-of-house, with partner and service marketplaces attached to every stay.',
    route: { type: 'tech', value: 'Marketplace' },
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    color: '#FF9FD1',
    pos: [52, 0, -28],
    kind3d: 'campus',
    blurb:
      'Clinical environments with asset tracking, air-quality assurance and continuity monitoring under a strict security posture.',
    route: { type: 'tech', value: 'Security' },
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    color: VIOLET,
    pos: [16, 0, -56],
    kind3d: 'plant',
    blurb:
      'Production lines mirrored as digital twins — OEE, predictive maintenance and quality inference at the edge.',
    route: { type: 'tech', value: 'Digital Twin' },
  },
  {
    id: 'datacenters',
    name: 'Data Centers',
    color: '#9BB4FF',
    pos: [-22, 0, -58],
    kind3d: 'datacenter',
    blurb:
      'The compute substrate — power, cooling and capacity telemetry feeding the analytics and model-serving stack.',
    route: { type: 'tech', value: 'Analytics' },
  },
]

/** Product nodes orbiting the landmark tower. */
export const PRODUCT_NODES = [
  {
    id: 'kombos',
    name: PRODUCTS.kombos.name,
    color: CY,
    pos: [0, 0, 30],
    blurb:
      'The connected-infrastructure platform: device onboarding, telemetry ingestion, rules and automation across every zone.',
    route: { type: 'q', value: 'kombos' },
  },
  {
    id: 'cielo',
    name: PRODUCTS.cielo.name,
    color: VIOLET,
    pos: [27, 0, 12],
    blurb:
      'Enterprise portfolio intelligence — rolls asset, building and facility twins into a portfolio twin for capital decisions.',
    route: { type: 'q', value: 'cielo' },
  },
  {
    id: 'xenia',
    name: PRODUCTS.xenia.name,
    color: AMBER,
    pos: [18, 0, -26],
    blurb: 'Hospitality experience suite — guest journeys, room intelligence and venue operations.',
    route: { type: 'q', value: 'xenia' },
  },
  {
    id: 'domi',
    name: PRODUCTS.domi.name,
    color: '#8FD8FF',
    pos: [-20, 0, -22],
    blurb: 'Residential intelligence — comfort, safety and energy automation for living spaces.',
    route: { type: 'q', value: 'domi' },
  },
  {
    id: 'mints',
    name: PRODUCTS.mints.name,
    color: EM,
    pos: [-29, 0, 13],
    blurb: 'Carbon and ESG accounting — measurement, attribution and reporting across the estate.',
    route: { type: 'q', value: 'mints' },
  },
]

/** The intelligence stack, shown as the layers of the central landmark. */
export const STACK_LAYERS = [
  {
    id: 'sense',
    name: 'Sense',
    color: EM,
    blurb: 'Sensors, meters and gateways capturing the physical world.',
    route: { type: 'tech', value: 'IoT Sensors' },
  },
  {
    id: 'connect',
    name: 'Connect',
    color: '#8FD8FF',
    blurb: 'Secure transport, edge buffering and protocol normalisation.',
    route: { type: 'tech', value: 'Connectivity' },
  },
  {
    id: 'model',
    name: 'Model',
    color: VIOLET,
    blurb: 'Digital twins and machine-learning models over the normalised estate.',
    route: { type: 'tech', value: 'Machine Learning' },
  },
  {
    id: 'decide',
    name: 'Decide',
    color: CY,
    blurb: 'Agentic AI closing the loop from insight to autonomous action.',
    route: { type: 'tech', value: 'Agentic AI' },
  },
]

/** Every clickable node in the scene, in one flat list. */
export const NODES = [
  {
    id: 'core',
    name: 'Inspironics Core',
    kind: 'landmark',
    category: 'Landmark',
    color: CY,
    pos: [0, 0, 0],
    blurb:
      'The intelligence backbone every zone plugs into — ingestion, twin modelling, decisioning and the command surfaces above them.',
    route: { type: 'q', value: '' },
  },
  ...ZONES.map((z) => ({ ...z, kind: 'zone', category: 'Zone' })),
  ...PRODUCT_NODES.map((p) => ({ ...p, kind: 'product', category: 'Product' })),
  ...STACK_LAYERS.map((s, i) => ({
    ...s,
    kind: 'layer',
    category: 'Stack Layer',
    pos: [0, 26 + i * 8, 0],
  })),
]

export const nodeById = (id) => NODES.find((n) => n.id === id)

const LINKS = [
  ['kombos', 'cities'],
  ['kombos', 'residential'],
  ['kombos', 'manufacturing'],
  ['kombos', 'healthcare'],
  ['kombos', 'energy'],
  ['cielo', 'datacenters'],
  ['cielo', 'cities'],
  ['cielo', 'manufacturing'],
  ['xenia', 'hospitality'],
  ['domi', 'residential'],
  ['mints', 'energy'],
  ['mints', 'agri'],
]

/** Data conduits drawn between the core, the product nodes and the zones. */
export const CONDUITS = [
  ...PRODUCT_NODES.map((p) => ({ from: [0, 0, 0], to: p.pos, color: p.color })),
  ...LINKS.map(([a, b]) => {
    const p = PRODUCT_NODES.find((x) => x.id === a)
    const z = ZONES.find((x) => x.id === b)
    return { from: p.pos, to: z.pos, color: z.color }
  }),
]

/** Does `item` satisfy `route`? */
export function matchesRoute(item, route) {
  if (!route) return true
  if (route.type === 'cat') return item.cat === route.value
  if (route.type === 'tech') return (item.tech || []).includes(route.value)
  if (route.type === 'q') {
    const q = String(route.value || '')
      .trim()
      .toLowerCase()
    if (!q) return true
    const hay = item._hay || ''
    return q.split(/\s+/).every((tok) => hay.includes(tok))
  }
  return true
}

/** Live gallery count for a node's route — shown in tooltips and the side panel. */
export function countMatches(items, route) {
  if (!items?.length) return 0
  if (!route || (route.type === 'q' && !String(route.value || '').trim())) return items.length
  return items.reduce((n, it) => n + (matchesRoute(it, route) ? 1 : 0), 0)
}

export function routeLabel(route) {
  if (!route) return 'All innovations'
  if (route.type === 'cat') return `Category · ${route.value}`
  if (route.type === 'tech') return `Tech domain · ${route.value}`
  if (!String(route.value || '').trim()) return 'All innovations'
  return `Search · "${route.value}"`
}
