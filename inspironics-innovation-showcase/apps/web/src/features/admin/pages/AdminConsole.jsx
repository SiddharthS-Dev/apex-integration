import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '#features/auth'
import { adminApi } from '../api/adminApi.js'
import DropboxPanel from '../components/DropboxPanel.jsx'
import { Badge, Bars, Card, DayColumns, Stat, formatBytes, formatDate, formatDuration } from '../components/ui.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sync', label: 'Sync logs' },
  { id: 'users', label: 'Users' },
  { id: 'logins', label: 'Login history' },
]

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '' })
  const reload = useCallback(() => {
    fn()
      .then((data) => setState({ data, error: '' }))
      .catch((e) => setState({ data: null, error: e.message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return { ...state, reload }
}

function Overview({ analytics, reloadKey }) {
  const { data, error } = analytics
  const cache = useLoad(() => adminApi.cache(), [reloadKey])
  const views = useMemo(() => {
    const m = {}
    for (const e of data?.activity.byDay || []) if (e.kind === 'view') m[e.day] = (m[e.day] || 0) + e.count
    return m
  }, [data])
  const logins = useMemo(() => {
    const m = {}
    for (const l of data?.logins || []) if (l.success) m[l.day] = (m[l.day] || 0) + l.count
    return m
  }, [data])

  if (error) return <p className="text-sm text-rose-300">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  const lib = data.library
  const classified = lib.byClassification.filter((c) => c.name !== 'unclassified').reduce((s, c) => s + c.count, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active plates" value={lib.active} hint={lib.archived ? `${lib.archived} archived` : 'none archived'} />
        <Stat label="Classified" value={`${lib.active ? Math.round((classified / lib.active) * 100) : 0}%`} hint={`${classified} of ${lib.active}`} />
        <Stat label="Library size" value={formatBytes(lib.totalBytes)} hint={`cache ${formatBytes(cache.data?.bytes)}`} />
        <Stat label="ESG · AI · IoT" value={`${lib.flags.esg} · ${lib.flags.ai} · ${lib.flags.iot}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plates by category">
          <Bars rows={lib.byCategory} />
        </Card>
        <Card title="Plates by technology">
          <Bars rows={lib.byTech} />
        </Card>
        <Card title={`Views · last ${data.activity.days} days`}>
          <DayColumns days={data.activity.days} series={views} label="Plate views per day" />
        </Card>
        <Card title={`Sign-ins · last ${data.activity.days} days`}>
          <DayColumns days={data.activity.days} series={logins} label="Successful sign-ins per day" />
        </Card>
        <Card title="Most viewed">
          <Bars rows={data.topViewed.map((t) => ({ name: t.title, count: t.count }))} empty="No views recorded yet." />
        </Card>
        <Card title="How titles were found">
          <Bars rows={lib.byTitleSource} />
          <div className="mt-4">
            <Bars rows={lib.byKind} />
          </div>
        </Card>
      </div>
    </div>
  )
}

function SyncLogs({ reloadKey }) {
  const { data, error } = useLoad(() => adminApi.syncLogs(50), [reloadKey])
  const [open, setOpen] = useState(null)
  if (error) return <p className="text-sm text-rose-300">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  if (!data.items.length) return <p className="text-sm text-muted">No sync has run yet.</p>
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="label-mono">
            <tr>
              {['Started', 'Trigger', 'Status', 'Duration', 'Found', 'Added', 'Updated', 'Unchanged', 'Archived', 'Failed', ''].map((h) => (
                <th key={h} className="pb-3 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <Fragment key={s.id}>
                <tr className="border-t border-white/6 text-muted">
                  <td className="py-2.5 pr-3 text-chalk">{formatDate(s.startedAt)}</td>
                  <td className="pr-3">{s.trigger}</td>
                  <td className="pr-3">
                    <Badge tone={s.status}>{s.status}</Badge>
                  </td>
                  <td className="pr-3">{formatDuration(s.durationMs)}</td>
                  <td className="pr-3">{s.discovered}</td>
                  <td className="pr-3">{s.added}</td>
                  <td className="pr-3">{s.updated}</td>
                  <td className="pr-3">{s.unchanged}</td>
                  <td className="pr-3">{s.archived}</td>
                  <td className="pr-3">{s.failed}</td>
                  <td>
                    {(s.errors.length > 0 || s.warnings.length > 0) && (
                      <button className="text-cyan-glow" onClick={() => setOpen(open === s.id ? null : s.id)}>
                        {open === s.id ? 'hide' : `${s.errors.length + s.warnings.length} notes`}
                      </button>
                    )}
                  </td>
                </tr>
                {open === s.id && (
                  <tr>
                    <td colSpan={11} className="pb-4">
                      <ul className="space-y-1 rounded-lg bg-black/30 p-3 font-mono text-[11px]">
                        {s.errors.map((e, i) => (
                          <li key={`e${i}`} className="text-rose-300">
                            ✖ {e.file || e.stage}: {e.message}
                          </li>
                        ))}
                        {s.warnings.map((w, i) => (
                          <li key={`w${i}`} className="text-amber-200">
                            ⚠ {w.file}: {w.message}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Users() {
  const { user: me } = useAuth()
  const { data, error, reload } = useLoad(() => adminApi.users(), [])
  const [err, setErr] = useState('')
  const update = async (id, patch) => {
    setErr('')
    try {
      await adminApi.updateUser(id, patch)
      reload()
    } catch (e) {
      setErr(e.message)
    }
  }
  if (error) return <p className="text-sm text-rose-300">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  return (
    <Card>
      {err && <p className="mb-3 text-sm text-rose-300">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="label-mono">
            <tr>
              {['Name', 'Email', 'Sign-in', 'Last seen', 'Role', ''].map((h) => (
                <th key={h} className="pb-3 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id} className={`border-t border-white/6 ${u.disabled ? 'opacity-50' : ''}`}>
                <td className="py-2.5 pr-3 text-chalk">{u.name}</td>
                <td className="pr-3 text-muted">
                  {u.email}
                  {!u.verified && <span className="ml-2 text-amber-300">unverified</span>}
                </td>
                <td className="pr-3 text-muted">{u.provider}</td>
                <td className="pr-3 text-muted">{formatDate(u.lastLoginAt)}</td>
                <td className="pr-3">
                  <select
                    value={u.role}
                    disabled={u.id === me?.id}
                    onChange={(e) => update(u.id, { role: e.target.value })}
                    className="rounded border border-white/12 bg-black/40 px-2 py-1 text-chalk"
                  >
                    <option value="viewer">viewer</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  {u.id !== me?.id && (
                    <button className="text-muted hover:text-rose-300" onClick={() => update(u.id, { disabled: !u.disabled })}>
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Logins() {
  const { data, error } = useLoad(() => adminApi.loginHistory(200), [])
  if (error) return <p className="text-sm text-rose-300">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  return (
    <Card title={`${data.total} sign-in attempts`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="label-mono">
            <tr>
              {['When', 'Email', 'Method', 'Result', 'IP'].map((h) => (
                <th key={h} className="pb-3 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((l) => (
              <tr key={l.id} className="border-t border-white/6 text-muted">
                <td className="py-2.5 pr-3 text-chalk">{formatDate(l.createdAt)}</td>
                <td className="pr-3">{l.email || '—'}</td>
                <td className="pr-3">{l.method}</td>
                <td className="pr-3">{l.success ? <span className="text-emerald-300">success</span> : <span className="text-rose-300">{l.reason || 'failed'}</span>}</td>
                <td className="pr-3 font-mono">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function AdminConsole() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState('overview')
  // bumped when a sync finishes, so every panel re-reads
  const [reloadKey, setReloadKey] = useState(0)
  const onSynced = useCallback(() => setReloadKey((k) => k + 1), [])
  const analytics = useLoad(() => adminApi.analytics(30), [reloadKey])
  const callback = useMemo(() => ({ dropbox: params.get('dropbox'), message: params.get('message') }), [params])

  return (
    <main id="main" className="mx-auto min-h-screen max-w-[1400px] px-5 pb-24 pt-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/" className="label-mono text-cyan-glow">
            ← Back to the showcase
          </Link>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-chalk">Admin console</h1>
          <p className="mt-1 text-sm text-muted">Dropbox holds the files; this is where the library is connected, synced and watched.</p>
        </div>
      </div>

      <div className="mt-8">
        <DropboxPanel callback={callback} onSynced={onSynced} />
      </div>

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-white/8" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${tab === t.id ? 'border-cyan-glow text-chalk' : 'border-transparent text-muted hover:text-chalk'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'overview' && <Overview analytics={analytics} reloadKey={reloadKey} />}
        {tab === 'sync' && <SyncLogs reloadKey={reloadKey} />}
        {tab === 'users' && <Users />}
        {tab === 'logins' && <Logins />}
      </div>
    </main>
  )
}
