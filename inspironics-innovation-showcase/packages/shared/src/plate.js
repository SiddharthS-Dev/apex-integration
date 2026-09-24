/**
 * The plate record — the one shape the API serves and the gallery renders.
 *
 * It keeps the field names of the original static corpus (`f`, `t`, `cat`,
 * `tech`, …) so every component that already reads them keeps working, and adds
 * what a synced file has on top: an id, and server paths in place of bundled
 * image paths.
 *
 * @typedef {object} Plate
 * @property {string} id            stable server id
 * @property {string} f             original filename — the key enrichment maps use
 * @property {string} title
 * @property {string} cat           a CATEGORIES name, or UNCLASSIFIED
 * @property {string} tag
 * @property {string[]} tech
 * @property {boolean} esg
 * @property {boolean} ai
 * @property {boolean} iot
 * @property {string} [objective]
 * @property {string[]} [flow]
 * @property {string[]} [components]
 * @property {string} [architecture]
 * @property {string[]} [bizben]
 * @property {string[]} [techben]
 * @property {string} [takeaway]
 * @property {string[]} [extraKeywords]
 * @property {number} [w]
 * @property {number} [h]
 * @property {string} thumbUrl      same-origin path, never a Dropbox URL
 * @property {string} fullUrl       same-origin path, never a Dropbox URL
 * @property {string} kind          'image' | 'document'
 * @property {string} ext
 * @property {number} size
 * @property {number | null} confidence   classifier confidence, null if not classified
 * @property {string} titleSource   'seed' | 'metadata' | 'content' | 'model' | 'vision' | 'filename'
 * @property {string} modifiedAt
 */

/** Fields a plate always has, so the client never guards `undefined.length`. */
export const PLATE_DEFAULTS = Object.freeze({
  tech: [],
  flow: [],
  components: [],
  bizben: [],
  techben: [],
  extraKeywords: [],
  esg: false,
  ai: false,
  iot: false,
})

/** Sync run statuses as written to `sync_log`. */
export const SYNC_STATUS = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
})

/** Stored file lifecycle. Files are archived, never deleted. */
export const FILE_STATUS = Object.freeze({
  ACTIVE: 'active',
  ARCHIVED: 'archived',
})
