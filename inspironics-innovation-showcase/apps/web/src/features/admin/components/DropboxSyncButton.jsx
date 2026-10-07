import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from '../api/adminApi.js'

/*
 * The navbar's "Sync Dropbox" button, for administrators.
 *
 * Starts the same run as the admin console's "Run sync now", then follows it
 * here: progress while it runs, the outcome when it ends. A run that someone
 * else (or the schedule) already started is followed rather than reported as
 * an error. When a run finishes, `showcase:synced` is dispatched on window so
 * the gallery can reload without anyone refreshing the page.
 */
export const SYNCED_EVENT = 'showcase:synced'

function outcome(latest) {
  if (!latest) return { tone: 'ok', text: 'Synced' }
  if (latest.status && latest.status !== 'success') return { tone: 'bad', text: 'Sync failed — see Admin console' }
  const parts = [
    latest.added ? `${latest.added} new` : '',
    latest.updated ? `${latest.updated} updated` : '',
    latest.archived ? `${latest.archived} archived` : '',
  ].filter(Boolean)
  return { tone: 'ok', text: parts.length ? `Synced · ${parts.join(' · ')}` : 'Synced · no changes' }
}

export default function DropboxSyncButton({ className = '' }) {
  const [phase, setPhase] = useState('idle') // idle | starting | running | done
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const timer = useRef(null)
  const clear = useRef(null)

  const stop = () => {
    clearInterval(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      stop()
      clearTimeout(clear.current)
    },
    []
  )

  const settle = useCallback((next) => {
    stop()
    setPhase('done')
    setResult(next)
    clearTimeout(clear.current)
    clear.current = setTimeout(() => {
      setPhase('idle')
      setResult(null)
    }, 6000)
  }, [])

  const follow = useCallback(() => {
    setPhase('running')
    stop()
    timer.current = setInterval(async () => {
      try {
        const s = await adminApi.syncStatus()
        if (s.running) return setProgress(s.running)
        settle(outcome(s.latest))
        window.dispatchEvent(new CustomEvent(SYNCED_EVENT))
      } catch (e) {
        settle({ tone: 'bad', text: e.message || 'Lost track of the sync' })
      }
    }, 2000)
  }, [settle])

  const start = async () => {
    setPhase('starting')
    setResult(null)
    setProgress(null)
    try {
      const r = await adminApi.runSync()
      if (r?.running) setProgress(r.running)
      follow()
    } catch (e) {
      // already running — follow that run instead of complaining
      if (e.code === 'SYNC_RUNNING') return follow()
      settle({ tone: 'bad', text: e.message || 'Could not start the sync' })
    }
  }

  const busy = phase === 'starting' || phase === 'running'
  const label =
    phase === 'starting'
      ? 'Starting…'
      : phase === 'running'
        ? progress?.total
          ? `Syncing ${progress.done}/${progress.total}`
          : 'Syncing…'
        : 'Sync Dropbox'

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        title="Pull the latest files from Dropbox now"
        className="flex h-9 items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 text-[13px] text-chalk transition hover:border-cyan-glow/40 disabled:cursor-progress disabled:opacity-80"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 text-cyan-glow ${busy ? 'animate-spin' : ''}`}
        >
          <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
          <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
          <path d="M3 21v-5h5M21 3v5h-5" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
      </button>
      {result && (
        <p
          role="status"
          className={`absolute right-0 top-full mt-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs shadow-lift ${
            result.tone === 'ok'
              ? 'border-emerald-400/30 bg-[#08140f] text-emerald-300'
              : 'border-rose-400/30 bg-[#160a0d] text-rose-300'
          }`}
        >
          {result.text}
        </p>
      )}
    </div>
  )
}
