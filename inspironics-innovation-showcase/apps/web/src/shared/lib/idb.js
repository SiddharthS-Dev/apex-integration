/**
 * A minimal promise wrapper over IndexedDB: one database, named object stores,
 * get/put/delete/getAll. Enough for the offline library and the catalog
 * snapshot; not a general-purpose ORM.
 *
 * Every function resolves to a harmless default when IndexedDB is missing
 * (private windows in some browsers, the Node test runner), so callers never
 * need to guard.
 */
const DB_NAME = 'inspironics'
const VERSION = 1
export const STORES = /** @type {const} */ (['blobs', 'plates', 'state', 'meta'])

let opening = null

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!opening) {
    opening = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    })
  }
  return opening
}

function run(store, mode, fn, fallback) {
  return open().then(
    (db) =>
      db
        ? new Promise((resolve) => {
            const tx = db.transaction(store, mode)
            const req = fn(tx.objectStore(store))
            tx.oncomplete = () => resolve(req?.result ?? fallback)
            tx.onerror = () => resolve(fallback)
            tx.onabort = () => resolve(fallback)
          })
        : fallback
  )
}

export const idbGet = (store, key) => run(store, 'readonly', (s) => s.get(key), undefined)
export const idbPut = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key), undefined)
export const idbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key), undefined)
export const idbGetAll = (store) => run(store, 'readonly', (s) => s.getAll(), [])
export const idbKeys = (store) => run(store, 'readonly', (s) => s.getAllKeys(), [])
