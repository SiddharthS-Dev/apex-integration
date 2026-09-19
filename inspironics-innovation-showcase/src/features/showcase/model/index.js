/**
 * Showcase domain surface — the corpus, its derived aggregates, and the
 * locally-added plates. No React here; see `#features/showcase` for the UI.
 */
export {
  BASE,
  CATEGORIES,
  DATA_URL,
  TECHS,
  fullUrl,
  haystack,
  loadShowcase,
  rebuildWithCustom,
  relatedTo,
  spotlightFor,
  thumbUrl,
} from './showcaseData.js'
export { PRODUCTS, PRODUCT_ENRICHMENT, enrichmentFor, productKeysFor } from './productEnrichment.js'
export { addCustomItem, clearCustomItems, loadCustomItems, removeCustomItem } from './customItems.js'
