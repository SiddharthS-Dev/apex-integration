/**
 * Ecosystem domain surface.
 *
 * The `model` barrel is what other features' domain code is allowed to import:
 * data and pure functions, no React, no three.js. UI consumers go through
 * `#features/ecosystem` instead.
 */
export {
  AMBER,
  CONDUITS,
  CY,
  EM,
  NODES,
  PRODUCT_NODES,
  STACK_LAYERS,
  VIOLET,
  ZONES,
  countMatches,
  matchesRoute,
  nodeById,
  routeLabel,
} from './ecosystemData.js'
