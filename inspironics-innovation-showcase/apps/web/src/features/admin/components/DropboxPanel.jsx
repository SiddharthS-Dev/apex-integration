import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../api/adminApi.js'
import FolderPicker from './FolderPicker.jsx'
import { Badge, Card, formatDate, formatDuration } from './ui.jsx'

const CALLBACK_MESSAGES = {
  connected: ['ok', 'Dropbox is connected. Pick the sync folder below, then run a sync.'],
  denied: ['warn', 'Dropbox authorization was cancelled.'],
  bad_state: ['warn', 'That authorization link expired or was already used — try Connect again.'],
  forbidden: ['warn', 'Only an administrator can connect Dropbox.'],
  error: ['warn', 'Dropbox rejected the authorization.'],
}

/** "15m ago", "3h ago", "2d ago". */
function ago(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 text-xs last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-chalk">{children}</dd>
    </div>
  )
}

function health(status) {
  if (!status.configured) return ['warn', 'Not configured']
  if (!status.connected) return ['warn', 'Not connected']
  if (status.status !== 'ok') return ['bad', 'Reconnect needed']
  if (status.running) return ['ok', 'Syncing']
  const last = status.lastSync
  if (!last) return ['warn', 'Needs attention']
  if (last.status === 'failed') return ['bad', 'Last sync failed']
  if (last.status === 'partial') return ['warn', 'Needs attention']
  return ['ok', 'Healthy']
}

const DOT = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-rose-400' }
const TONE = { ok: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-rose-300' }

/** Connection health, the redirect URI, and the sync folder — the three things an admin sets up. */
export default function DropboxPanel({ callback, onSynced }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => {
    if (!callback?.dropbox) return null
    const [tone, text] = CALLBACK_MESSAGES[callback.dropbox] || CALLBACK_MESSAGES.error
    return { tone, text: callback.message ? `${text} ${callback.message}` : text }
  })
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [browsing, setBrowsing] = useState(true)

  const load = useCallback(async () => {
    try {
      const s = await adminApi.dropboxStatus()
      setStatus(s)
      return s
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // poll while a run is in progress, and tell the page when it ends
  const running = status?.running
  useEffect(() => {
    if (!running) return
    const t = setInterval(async () => {
      const s = await load()
      if (s && !s.running) onSynced?.()
    }, 2000)
    return () => clearInterval(t)
  }, [running, load, onSynced])

  const act = async (name, fn, done) => {
    setBusy(name)
    setError('')
    try {
      await fn()
      done?.()
      await load()
    } catch (e) {
      // 409 SYNC_RUNNING is the "already running" banner, not an error
      if (e.code === 'SYNC_RUNNING') setNotice({ tone: 'warn', text: 'A synchronization is already running.' })
      else setError(e.message)
      await load()
    } finally {
      setBusy('')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked: the URI is selectable */
    }
  }

  if (!status) return <Card title="Dropbox">{error ? <p className="text-sm text-rose-300">{error}</p> : <p className="text-sm text-muted">Loading…</p>}</Card>

  const [tone, label] = health(status)
  const last = status.lastSync
  const progress = status.running
  const acct = status.account
  const namespace = !acct
    ? '—'
    : status.appFolder
      ? 'App folder (Apps/…) — this app cannot see the rest of Dropbox'
      : acct.isTeam
        ? `Team space${acct.homePath ? ` (personal folder: ${acct.homePath})` : ''}`
        : 'Personal Dropbox'
  const lastError = acct?.lastError || (last?.status === 'failed' ? last.errors?.[0]?.message : null)
  const connectedOk = status.connected && status.status === 'ok'

  return (
    <div className="space-y-5">
      {notice && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${notice.tone === 'ok' ? 'border-emerald-400/30 text-emerald-200' : 'border-amber-400/30 text-amber-200'}`}>{notice.text}</p>
      )}
      {error && <p className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {/* ---------------------------------------------------- connection */}
      <Card
        title="Dropbox connection"
        right={
          <div className="flex flex-wrap items-center gap-2">
            {connectedOk && (
              <button className="btn-primary !px-4 !py-2 text-xs" disabled={!!busy || !!progress} onClick={() => act('sync', adminApi.runSync)}>
                {progress ? 'Syncing…' : busy === 'sync' ? 'Starting…' : 'Run sync now'}
              </button>
            )}
            {status.configured && (
              <a href={adminApi.connectUrl()} className={`${connectedOk ? 'btn-ghost' : 'btn-primary'} !px-4 !py-2 text-xs`}>
                {status.connected ? 'Reconnect' : 'Connect Dropbox'}
              </a>
            )}
            {status.connected && (
              <button
                className="btn-ghost !px-3 !py-2 text-xs hover:!border-rose-400/40 hover:!text-rose-300"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm('Disconnect Dropbox? The library stays; syncing stops until you reconnect.')) act('disconnect', adminApi.disconnect)
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        }
      >
        {status.appFolder && connectedOk && (
          <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs leading-relaxed text-amber-100">
            This Dropbox app has <b>App Folder</b> access, so it only sees <code>Apps/&lt;app name&gt;/</code>. To browse and sync any folder in your
            Dropbox, use an app with <b>Full Dropbox</b> access: put its key and secret in <code>apps/api/.env</code>, restart the API, and press
            Reconnect.
          </p>
        )}
        {progress && (
          <div className="mb-4">
            <p className="text-xs text-chalk">
              Syncing… {progress.total ? `${progress.done} / ${progress.total} files processed` : `${progress.discovered} files discovered`}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-cyan-glow transition-all" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '8%' }} />
            </div>
          </div>
        )}
        <dl className="grid gap-x-10 sm:grid-cols-2">
          <div>
            <Row label="Health">
              <span className={`inline-flex items-center gap-1.5 ${TONE[tone]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
                {label}
              </span>
            </Row>
            <Row label="Account">{acct ? `${acct.displayName} · ${acct.email}` : '—'}</Row>
            <Row label="Namespace">{namespace}</Row>
            <Row label="Last sync">
              {last ? (
                <>
                  <Badge tone={last.status}>{last.status}</Badge> <span className="ml-1">{ago(last.startedAt)} · {formatDuration(last.durationMs)}</span>
                </>
              ) : (
                'never'
              )}
            </Row>
            <Row label="Account ID">{acct?.accountId || '—'}</Row>
            <Row label="Archived">{status.library?.archived || 0}</Row>
            <Row label="Scheduled sync">{status.nextRunAt ? `every ${status.intervalMinutes} min` : 'off'}</Row>
          </div>
          <div>
            <Row label="Root folder">{status.rootPath}</Row>
            <Row label="Sync status">{progress ? 'running' : `idle · next ${status.nextRunAt ? formatDate(status.nextRunAt) : 'manual'}`}</Row>
            <Row label="Last token refresh">{ago(status.lastTokenRefreshAt)}</Row>
            <Row label="Indexed plates">{status.library?.active || 0}</Row>
            <Row label="Connected">{acct ? formatDate(acct.connectedAt) : '—'}</Row>
            <Row label="AI enrichment">{status.ai?.enabled ? status.ai.model : 'off'}</Row>
            <Row label="Last error">
              <span className={lastError ? 'text-rose-300' : ''} title={lastError || ''}>
                {lastError || 'none'}
              </span>
            </Row>
          </div>
        </dl>
        {!status.configured && (
          <p className="mt-4 text-xs text-muted">
            The API has no Dropbox app yet. Set <code className="text-chalk">DROPBOX_APP_KEY</code> and <code className="text-chalk">DROPBOX_APP_SECRET</code> in{' '}
            <code className="text-chalk">apps/api/.env</code> and restart it.
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------- redirect URI */}
      <Card title="OAuth redirect URI">
        <p className="text-xs leading-relaxed text-muted">
          Register this exact URI under your app in the Dropbox App Console before connecting. It must match character for character, including the scheme,
          port and path.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-black/40 px-4 py-3">
          <code className="min-w-0 flex-1 select-all truncate font-mono text-xs text-chalk">{status.redirectUri}</code>
          <button className="shrink-0 text-xs text-muted hover:text-cyan-glow" onClick={copy}>
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      </Card>

      {/* ---------------------------------------------------- sync folder */}
      <Card
        title="Sync folder"
        right={
          connectedOk && (
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setBrowsing((b) => !b)}>
              {browsing ? 'Hide folders' : 'Browse folders'}
            </button>
          )
        }
      >
        {!connectedOk ? (
          <p className="text-xs text-muted">Connect Dropbox to browse its folders.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              Syncing <span className="font-medium text-chalk">{status.rootPath}</span>. Changing it archives every plate outside the new folder on the next
              sync — nothing is deleted.
            </p>
            {browsing && (
              <FolderPicker
                rootPath={status.rootPath}
                appFolder={status.appFolder}
                busy={!!busy}
                onChoose={(path) =>
                  act('folder', () => adminApi.setRootPath(path || '/'), () => setNotice({ tone: 'ok', text: `Sync folder set to ${path || '/'}. Run a sync to index it.` }))
                }
              />
            )}
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Files with a{' '}
          {['.jpg', '.png', '.webp', '.pdf', '.pptx', '.html'].map((e, i) => (
            <span key={e}>
              {i ? ', ' : ''}
              <code className="rounded bg-white/5 px-1 py-0.5 text-chalk">{e}</code>
            </span>
          ))}{' '}
          extension are indexed, classified, and given a thumbnail. Files removed from Dropbox are archived, never hard-deleted.
        </p>
      </Card>
    </div>
  )
}
