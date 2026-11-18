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
      try {
        await writeFile(tmp, data)
        await rename(tmp, p.data)
      } catch (error) {
        // A failed write (disk full, permissions) must not leave a partial file behind.
        await rm(tmp, { force: true }).catch(() => {})
        throw error
      }
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

    /**
     * Retention: removes derivatives nobody has read or written for `hours` (old revisions are never
     * looked up again, so without this the cache only grows), and partial writes left by a crash.
     * Always safe: anything removed is fetched again on the next request.
     */
    async purgeOlderThan(hours) {
      const cutoff = Date.now() - hours * 3600_000
      let removed = 0
      for (const sub of await readdir(dir).catch(() => [])) {
        const folder = path.join(dir, sub)
        for (const name of await readdir(folder).catch(() => [])) {
          if (!name.endsWith('.bin') && !name.endsWith('.tmp')) continue
          const full = path.join(folder, name)
          try {
            const s = await stat(full)
            if (Math.max(s.atimeMs, s.mtimeMs) >= cutoff) continue
            await rm(full, { force: true })
            if (name.endsWith('.bin')) await rm(full.replace(/.bin$/, '.json'), { force: true })
            removed++
          } catch {
            /* raced with a write or another sweep */
          }
        }
      }
      return removed
    },

    clear: () => rm(dir, { recursive: true, force: true }),
  }
}
