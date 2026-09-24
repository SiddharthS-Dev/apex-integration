import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '#features/auth'
import SectionHead from '#shared/ui/SectionHead'
import { OFFLINE_EVENT, listSaved, readingState, removePlate, savedBlobUrls } from '../model/offlineStore.js'

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

/** A saved plate's thumbnail, from its IndexedDB blob. */
function SavedThumb({ plate }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let urls
    savedBlobUrls(plate).then((u) => {
      urls = u
      setSrc(u?.thumb || u?.full || null)
    })
    return () => {
      if (urls?.thumb) URL.revokeObjectURL(urls.thumb)
      if (urls?.full) URL.revokeObjectURL(urls.full)
    }
  }, [plate])
  return src ? (
    <img src={src} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
  ) : (
    <div className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-white/5 font-mono text-xs uppercase text-muted">{plate.ext || 'plate'}</div>
  )
}

/** Full-screen reader for a saved plate: an image, or a PDF/HTML document in a frame. */
function Reader({ plate, onClose }) {
  const [urls, setUrls] = useState(null)
  useEffect(() => {
    let u
    savedBlobUrls(plate).then((x) => {
      u = x
      setUrls(x)
    })
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (u?.full) URL.revokeObjectURL(u.full)
      if (u?.thumb) URL.revokeObjectURL(u.thumb)
    }
  }, [plate, onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={plate.title} className="fixed inset-0 z-[80] flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <p className="truncate text-sm text-chalk">{plate.title}</p>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-xs">
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {!urls ? (
          <p className="text-muted">Loading…</p>
        ) : urls.type.startsWith('image/') ? (
          <img src={urls.full} alt={plate.title} className="max-h-full max-w-full object-contain" />
        ) : (
          // saved HTML runs with no privileges; a sandboxed frame would block the browser's PDF viewer
          <iframe
            title={plate.title}
            src={urls.full}
            sandbox={urls.type.includes('html') ? '' : undefined}
            className="h-full w-full rounded-lg bg-white"
          />
        )}
      </div>
    </div>
  )
}

export default function OfflineLibrary() {
  const { user } = useAuth()
  const [plates, setPlates] = useState(null)
  const [favourites, setFavourites] = useState([])
  const [open, setOpen] = useState(null)
  // stable, so the reader's effect runs once per plate rather than every render
  const close = useCallback(() => setOpen(null), [])
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const load = async () => {
      setPlates(await listSaved())
      setFavourites((await readingState(user?.id)).favourites)
    }
    load()
    const net = () => setOnline(navigator.onLine)
    window.addEventListener(OFFLINE_EVENT, load)
    window.addEventListener('online', net)
    window.addEventListener('offline', net)
    return () => {
      window.removeEventListener(OFFLINE_EVENT, load)
      window.removeEventListener('online', net)
      window.removeEventListener('offline', net)
    }
  }, [user?.id])

  const total = (plates || []).reduce((s, p) => s + (p.bytes || 0), 0)

  return (
    <main id="main" className="mx-auto min-h-screen max-w-[1400px] px-5 pb-24 pt-24 sm:px-8">
      <Link to="/" className="label-mono text-cyan-glow">
        ← Back to the showcase
      </Link>
      <SectionHead
        eyebrow={online ? 'Offline library' : 'You are offline'}
        title="Saved for offline reading"
        sub={`Plates you saved are kept in this browser${plates?.length ? ` — ${plates.length} saved, ${mb(total)}` : ''}. They open without a connection.`}
      />

      {plates === null ? (
        <p className="mt-10 text-muted">Loading…</p>
      ) : plates.length === 0 ? (
        <p className="mt-10 text-muted">Nothing saved yet. Open any plate and use the ↓ button to keep a copy here.</p>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plates.map((p) => {
            const key = String(p.id || p.f)
            return (
              <li key={key} className="glass rounded-xl p-3">
                <button onClick={() => setOpen(p)} className="block w-full text-left">
                  <SavedThumb plate={p} />
                  <p className="mt-3 line-clamp-2 text-sm text-chalk">
                    {favourites.includes(key) && <span className="mr-1 text-amber-300">★</span>}
                    {p.title}
                  </p>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <span className="label-mono">{p.cat}</span>
                  <button onClick={() => removePlate(p)} className="text-xs text-muted hover:text-rose-300">
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && <Reader plate={open} onClose={close} />}
    </main>
  )
}
