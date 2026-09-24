/**
 * Offline reading: downloaded plates and per-user reading state, in IndexedDB.
 *
 *   plates   id -> the plate record as it was when saved (for listing offline)
 *   blobs    id -> { full: Blob, thumb: Blob } fetched through the API's content
 *            proxy — the bytes stay in the browser sandbox, never loose files
 *   state    userId -> { favourites: string[], recent: { id, at }[] }
 *
 * Nothing here talks to Dropbox; blobs come from same-origin API paths.
 */
import { idbDelete, idbGet, idbGetAll, idbPut } from '#shared/lib/idb.js'

export const OFFLINE_EVENT = 'inspironics:offline-changed'

const keyOf = (item) => String(item?.id || item?.f || '')
const announce = () => globalThis.window?.dispatchEvent?.(new CustomEvent(OFFLINE_EVENT))

async function fetchBlob(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Download failed (${res.status}).`)
  return res.blob()
}

/** Download a plate's preview and thumbnail for offline reading. */
export async function savePlate(item) {
  const key = keyOf(item)
  if (!key) throw new Error('This plate cannot be saved.')
  const [full, thumb] = await Promise.all([fetchBlob(item.fullUrl), fetchBlob(item.thumbUrl).catch(() => null)])
  // eslint-disable-next-line no-unused-vars
  const { _hay, ...record } = item
  await idbPut('blobs', key, { full, thumb })
  await idbPut('plates', key, { ...record, savedAt: new Date().toISOString(), bytes: full.size + (thumb?.size || 0) })
  announce()
}

export async function removePlate(item) {
  const key = keyOf(item)
  await idbDelete('blobs', key)
  await idbDelete('plates', key)
  announce()
}

/** @returns {Promise<object[]>} saved plate records, newest first */
export async function listSaved() {
  const all = await idbGetAll('plates')
  return all.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
}

export const isSaved = async (item) => !!(await idbGet('plates', keyOf(item)))

/** Object URLs for a saved plate's blobs. The caller revokes them. */
export async function savedBlobUrls(item) {
  const blobs = await idbGet('blobs', keyOf(item))
  if (!blobs) return null
  return {
    full: URL.createObjectURL(blobs.full),
    thumb: blobs.thumb ? URL.createObjectURL(blobs.thumb) : null,
    type: blobs.full.type,
  }
}

/* ------------------------------------------------------ reading state -- */

const emptyState = () => ({ favourites: [], recent: [] })

export async function readingState(userId) {
  if (!userId) return emptyState()
  return { ...emptyState(), ...((await idbGet('state', userId)) || {}) }
}

export async function toggleFavourite(userId, item) {
  const s = await readingState(userId)
  const key = keyOf(item)
  const on = !s.favourites.includes(key)
  s.favourites = on ? [key, ...s.favourites] : s.favourites.filter((k) => k !== key)
  await idbPut('state', userId, s)
  announce()
  return on
}

/** Remember a view (most recent first, 50 kept). */
export async function noteView(userId, item) {
  if (!userId) return
  const s = await readingState(userId)
  const key = keyOf(item)
  s.recent = [{ id: key, at: new Date().toISOString() }, ...s.recent.filter((r) => r.id !== key)].slice(0, 50)
  await idbPut('state', userId, s)
}
