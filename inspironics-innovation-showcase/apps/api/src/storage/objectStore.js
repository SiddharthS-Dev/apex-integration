/**
 * A disposable local cache for derived bytes: thumbnails and rendered previews.
 *
 * Keyed by (file id, revision, kind) — content-addressed in effect, because a
 * changed file in Dropbox has a new revision, so its old derivatives are simply
 * never looked up again. Nothing needs invalidating. Deleting the whole
 * directory is always safe: Dropbox remains the source of truth, and the next
 * request re-fetches.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createObjectStore(dir) {
  const locate = (fileId, rev, kind) => {
    const h = createHash('sha256').update(`${fileId}\0${rev}\0${kind}`).digest('hex')
    const folder = path.join(dir, h.slice(0, 2))
    return { folder, data: path.join(folder, `${h}.bin`), meta: path.join(folder, `${h}.json`) }
  }

  return {
    async get(fileId, rev, kind) {
      const p = locate(fileId, rev, kind)
      try {
        const [data, meta] = await Promise.all([readFile(p.data), readFile(p.meta, 'utf8')])
        return { data, ...JSON.parse(meta) }
      } catch {
        return null
      }
    },

    async has(fileId, rev, kind) {
      try {
        await stat(locate(fileId, rev, kind).data)
        return true
      } catch {
        return false
      }
    },

    /** Write via a temp file and rename, so a reader never sees half an object. */
    async put(fileId, rev, kind, data, contentType) {
      const p = locate(fileId, rev, kind)
      await mkdir(p.folder, { recursive: true })
      const tmp = `${p.data}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, data)
      await rename(tmp, p.data)
      await writeFile(p.meta, JSON.stringify({ contentType, size: data.length, storedAt: new Date().toISOString() }))
    },

    async stats() {
      let files = 0
      let bytes = 0
      try {
        for (const sub of await readdir(dir)) {
          for (const name of await readdir(path.join(dir, sub))) {
            if (!name.endsWith('.bin')) continue
            files++
            bytes += (await stat(path.join(dir, sub, name))).size
          }
        }
      } catch {
        /* empty or missing: zero */
      }
      return { objects: files, bytes }
    },

    clear: () => rm(dir, { recursive: true, force: true }),
  }
}
