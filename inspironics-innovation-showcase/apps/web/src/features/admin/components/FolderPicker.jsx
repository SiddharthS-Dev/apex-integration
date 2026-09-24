import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../api/adminApi.js'

const norm = (p) => (!p || p === '/' ? '' : p)
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase()

/**
 * The sync-folder chooser: a live listing of the connected Dropbox, opened at
 * the current sync folder. Click a row to go into it, the breadcrumb to come
 * back out, and "Use this folder" to sync the folder you are in. Listing goes
 * through the API — the browser never talks to Dropbox.
 */
export default function FolderPicker({ rootPath, appFolder, busy, onChoose }) {
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const open = useCallback(async (path, fallback = true) => {
    setLoading(true)
    setError('')
    try {
      setListing(await adminApi.folders(norm(path)))
    } catch (e) {
      // the saved folder may have been moved or deleted: fall back to the top
      if (fallback && norm(path)) return open('', false)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    open(rootPath)
  }, [open, rootPath])

  const here = norm(listing?.path)
  const crumbs = here ? here.split('/').filter(Boolean) : []

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
      <div className="flex flex-wrap items-center gap-1 px-4 pb-2 pt-3 text-xs">
        <button className="text-muted hover:text-chalk" onClick={() => open('')}>
          {appFolder ? 'App folder' : 'Dropbox'}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-muted/60">›</span>
            <button className={i === crumbs.length - 1 ? 'text-chalk' : 'text-muted hover:text-chalk'} onClick={() => open('/' + crumbs.slice(0, i + 1).join('/'))}>
              {c}
            </button>
          </span>
        ))}
        {loading && <span className="ml-auto text-muted">loading…</span>}
      </div>

      {error ? (
        <p className="px-4 py-4 text-sm text-rose-300">{error}</p>
      ) : !listing ? (
        <p className="px-4 py-4 text-sm text-muted">Loading folders…</p>
      ) : (
        <ul className="scroll-thin max-h-72 overflow-y-auto px-2 pb-2">
          {here && (
            <li>
              <button
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-muted hover:bg-white/5"
                onClick={() => open(here.split('/').slice(0, -1).join('/'))}
              >
                <span aria-hidden="true">↰</span> Up one level
              </button>
            </li>
          )}
          {listing.folders.map((f) => (
            <li key={f.path}>
              <button className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-chalk hover:bg-white/5" onClick={() => open(f.path)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-muted" aria-hidden="true">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {same(f.path, rootPath) && <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">syncing</span>}
                <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-chalk" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
          {!listing.folders.length && <li className="px-2 py-3 text-xs text-muted">No sub-folders here.</li>}
        </ul>
      )}

      {listing && (
        <div className="flex items-center gap-3 border-t border-white/8 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-chalk">{here || '/'}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {listing.files} supported file{listing.files === 1 ? '' : 's'} directly here · sub-folders are included in a sync
            </p>
          </div>
          <button className="btn-primary shrink-0 !px-4 !py-2 text-xs" disabled={busy || same(here, rootPath)} onClick={() => onChoose(here)}>
            {same(here, rootPath) ? 'Current sync folder' : 'Use this folder'}
          </button>
        </div>
      )}
    </div>
  )
}
