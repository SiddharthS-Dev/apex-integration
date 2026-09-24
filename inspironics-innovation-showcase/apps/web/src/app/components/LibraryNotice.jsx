import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '#features/auth'
import { apiRequest, apiUrl } from '#shared/lib/apiClient.js'

/**
 * The strip under the navbar for the states the Dropbox-backed catalog can be
 * in that the rest of the page would otherwise leave unexplained: an empty
 * library, and an offline snapshot.
 *
 * For an administrator an empty library is actionable, so this carries the
 * next step itself — Connect Dropbox, or Run sync now — and reloads the
 * gallery when the sync finishes.
 */
export default function LibraryNotice({ data, onSynced }) {
  const { user } = useAuth()
  const [hidden, setHidden] = useState(false)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const synced = data.raw?.source === 'dropbox'
  const empty = synced && data.baseItems.length === 0
  const admin = user?.role === 'admin'

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiRequest('/api/dropbox/status')
      setStatus(s)
      return s
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  useEffect(() => {
    if (empty) loadStatus()
  }, [empty, admin, loadStatus])

  // while a sync runs, poll; when it ends, reload the gallery
  useEffect(() => {
    if (!status?.running) return
    const t = setInterval(async () => {
      const s = await loadStatus()
      if (s && !s.running) onSynced?.()
    }, 2000)
    return () => clearInterval(t)
  }, [status?.running, loadStatus, onSynced])

  const runSync = async () => {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/dropbox/sync', { method: 'POST', body: {} })
    } catch (e) {
      if (e.code !== 'SYNC_RUNNING') setError(e.message)
    } finally {
      await loadStatus()
      setBusy(false)
    }
  }

  if (hidden || (!data.offline && !empty)) return null

  let text
  let action = null
  if (data.offline) {
    text = `You are offline — showing the catalog as it was ${data.savedAt ? new Date(data.savedAt).toLocaleString() : 'last time'}.`
    action = (
      <Link to="/offline" className="btn-ghost shrink-0 !px-4 !py-2 text-xs">
        Offline library
      </Link>
    )
  } else if (!admin) {
    text = 'The library is empty — an administrator needs to connect Dropbox and run a sync.'
  } else if (!status) {
    text = 'The library is empty. Checking the Dropbox connection…'
  } else if (!status.configured) {
    text = 'The library is empty, and the API has no Dropbox app key yet — set DROPBOX_APP_KEY and DROPBOX_APP_SECRET in apps/api/.env and restart.'
  } else if (!status.connected || status.status !== 'ok') {
    text = status.connected
      ? 'The Dropbox connection has expired — reconnect it to keep the library in sync.'
      : 'The library is empty. Link your Dropbox to bring the plates in.'
    action = (
      // a top-level navigation, so the session cookie goes with it to the OAuth start
      <a href={apiUrl('/api/dropbox/oauth/start')} className="btn-primary shrink-0 !px-4 !py-2 text-xs">
        {status.connected ? 'Reconnect Dropbox' : 'Connect Dropbox'}
      </a>
    )
  } else if (status.running) {
    const p = status.running
    text = `Syncing from Dropbox… ${p.total ? `${p.done} / ${p.total} files` : `${p.discovered} files found`}`
  } else {
    const last = status.lastSync
    text = last
      ? last.status === 'failed'
        ? `The last sync failed: ${last.errors?.[0]?.message || 'see the admin console'}`
        : `Dropbox is linked (${status.account?.email}) but no plates were found in ${status.rootPath}.`
      : `Dropbox is linked (${status.account?.email}). Run a sync to index ${status.rootPath === '/' ? 'the app folder' : status.rootPath}.`
    action = (
      <button onClick={runSync} disabled={busy} className="btn-primary shrink-0 !px-4 !py-2 text-xs">
        {busy ? 'Starting…' : 'Run sync now'}
      </button>
    )
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-[76px] z-40 mx-auto flex w-[min(94vw,860px)] flex-wrap items-center gap-3 rounded-xl border border-cyan-glow/35 bg-[#0a0b12]/95 px-4 py-3 text-sm text-chalk shadow-lift backdrop-blur"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-glow/15 text-cyan-glow" aria-hidden="true">
        {data.offline ? '⚡' : '⇅'}
      </span>
      <span className="min-w-0 flex-1">
        {text}
        {error && <span className="mt-1 block text-xs text-rose-300">{error}</span>}
      </span>
      {action}
      {admin && !data.offline && (
        <Link to="/admin" className="shrink-0 text-xs text-muted underline-offset-4 hover:text-chalk hover:underline">
          Admin console
        </Link>
      )}
      <button onClick={() => setHidden(true)} aria-label="Dismiss" className="shrink-0 text-muted hover:text-chalk">
        ✕
      </button>
    </div>
  )
}
