/** Locally-added gallery items, persisted in localStorage. */
import { storageKeys } from '#shared/config'

const KEY = storageKeys.customItems

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * Persist, then announce. The order matters: a quota failure has to reach the
 * caller *before* anything tells the user their plate was saved, or the card
 * shows up in the gallery and quietly vanishes on the next reload.
 */
const write = (items) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch (err) {
    const e = new Error(
      'Browser storage is full. Remove a locally added plate, or use a smaller image, and try again.'
    )
    e.cause = err
    throw e
  }
  window.dispatchEvent(new CustomEvent('inspironics:custom-items'))
  return items
}

export const loadCustomItems = read

export function addCustomItem(partial) {
  const f = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const item = {
    f,
    t: partial.imageUrl || '',
    full: partial.imageUrl || '',
    thumbUrl: partial.imageUrl || '',
    fullUrl: partial.imageUrl || '',
    title: partial.title?.trim() || 'Untitled Architecture',
    cat: partial.cat || 'Systems & Architecture',
    tech: partial.tech || [],
    components: partial.components || [],
    flow: partial.flow || [],
    objective: partial.objective || '',
    architecture: partial.architecture || '',
    bizben: [],
    techben: [],
    takeaway: '',
    esg: !!partial.esg,
    ai: !!partial.ai,
    iot: !!partial.iot,
    flagship: false,
    custom: true,
    addedAt: new Date().toISOString(),
  }
  write([item, ...read()])
  return item
}

export function removeCustomItem(f) {
  return write(read().filter((i) => i.f !== f))
}

export function clearCustomItems() {
  return write([])
}
