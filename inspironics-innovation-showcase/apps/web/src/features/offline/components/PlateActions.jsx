import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '#features/auth'
import { OFFLINE_EVENT, isSaved, readingState, removePlate, savePlate, toggleFavourite } from '../model/offlineStore.js'

/** Re-read offline state whenever any tab or component changes it. */
function useOfflineStatus(item, userId) {
  const [saved, setSaved] = useState(false)
  const [favourite, setFavourite] = useState(false)

  const refresh = useCallback(async () => {
    if (!item) return
    const key = String(item.id || item.f)
    setSaved(await isSaved(item))
    setFavourite((await readingState(userId)).favourites.includes(key))
  }, [item, userId])

  useEffect(() => {
    refresh()
    window.addEventListener(OFFLINE_EVENT, refresh)
    return () => window.removeEventListener(OFFLINE_EVENT, refresh)
  }, [refresh])

  return { saved, favourite }
}

/**
 * Favourite and save-for-offline toggles, for the lightbox toolbar.
 * `onEvent(kind)` lets the host record the action for analytics.
 */
export default function PlateActions({ item, onEvent, className = '' }) {
  const { user } = useAuth()
  const { saved, favourite } = useOfflineStatus(item, user?.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!item || item.custom) return null

  const toggleSave = async () => {
    setBusy(true)
    setError('')
    try {
      if (saved) await removePlate(item)
      else {
        await savePlate(item)
        onEvent?.('offline')
      }
    } catch (e) {
      setError(e.message || 'Could not save for offline.')
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'grid h-9 w-9 place-items-center rounded-lg border border-white/12 bg-white/5 text-sm transition hover:border-cyan-glow/50 disabled:opacity-50'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        className={btn}
        aria-pressed={favourite}
        aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
        title={favourite ? 'Remove from favourites' : 'Add to favourites'}
        onClick={async () => {
          if (await toggleFavourite(user?.id, item)) onEvent?.('favourite')
        }}
      >
        <span className={favourite ? 'text-amber-300' : 'text-muted'}>{favourite ? '★' : '☆'}</span>
      </button>
      <button
        type="button"
        className={btn}
        disabled={busy}
        aria-pressed={saved}
        aria-label={saved ? 'Remove offline copy' : 'Save for offline reading'}
        title={error || (saved ? 'Saved offline — click to remove' : 'Save for offline reading')}
        onClick={toggleSave}
      >
        <span className={saved ? 'text-emerald-300' : error ? 'text-rose-300' : 'text-muted'}>{busy ? '…' : saved ? '⤓' : '↓'}</span>
      </button>
    </div>
  )
}
