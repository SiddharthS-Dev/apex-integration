import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Cloud, CloudOff, ShieldAlert, RefreshCw, Loader2, CheckCircle2, XCircle, Folder,
  FolderOpen, ChevronRight, Copy, Check, Link2, PlugZap, FlaskConical, ArrowLeft,
  Activity, History, Unplug, Wand2, AlertTriangle, ListChecks,
} from 'lucide-react';
import { dropboxAuth, syncDropbox, renameUntitledPresentations } from '@/api/functions';
import { backendMode } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui';
import { cn, timeAgo } from '@/lib/utils';

/**
 * Dropbox Settings — the administrator's view of the integration.
 *
 * Everything here is a call to our own backend. The browser never sees an app
 * key, a refresh token or an access token, and never contacts Dropbox except
 * by being redirected to the consent screen.
 *
 * Two OAuth shapes are supported, because the redirect URI is a deployment
 * choice: the API server can handle the callback itself and bounce back here
 * with ?dropbox_connected=1, or this page can be the registered redirect URI
 * and post the code to the backend for exchange.
 */

/**
 * React StrictMode mounts effects twice in development, and browsers replay
 * navigations. Exchanging one authorization code twice fails at Dropbox, so
 * codes are deduped per page load as well as on the server.
 */
const _exchangedCodes = new Set();

const STATUS_TONES = {
  healthy: { label: 'Healthy', className: 'text-emerald-400', dot: 'bg-emerald-400' },
  warning: { label: 'Needs attention', className: 'text-amber-400', dot: 'bg-amber-400' },
  error: { label: 'Error', className: 'text-red-400', dot: 'bg-red-400' },
  disconnected: { label: 'Disconnected', className: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  unconfigured: { label: 'Not configured', className: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

function StatusRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('truncate font-medium', tone)}>{value}</span>
    </div>
  );
}

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="space-y-3 rounded-2xl glass p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DropboxSettings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';

  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [proposals, setProposals] = useState(null);

  // On the API backend the server owns the callback; on the others this page is
  // the redirect target.
  const fallbackRedirectUri = useMemo(() => `${window.location.origin}${import.meta.env.BASE_URL}dropbox-settings`, []);
  const redirectUri = status?.redirect_uri || fallbackRedirectUri;

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await dropboxAuth({ action: 'status' });
      setStatus(data);

      if (data?.connection_status && backendMode === 'api') {
        const [healthResult, logResult] = await Promise.allSettled([
          dropboxAuth({ action: 'health' }),
          dropboxAuth({ action: 'logs', limit: 10 }),
        ]);
        if (healthResult.status === 'fulfilled') setHealth(healthResult.value.data);
        if (logResult.status === 'fulfilled') setLogs(logResult.value.data?.logs ?? []);
      }
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message || 'Could not read the Dropbox status.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) refreshStatus();
    else setLoading(false);
  }, [isAdmin, refreshStatus]);

  /* --------------------- OAuth return leg, server-handled callback --------- */
  useEffect(() => {
    if (!isAdmin) return;
    const connected = params.get('dropbox_connected');
    const failed = params.get('dropbox_error');
    if (!connected && !failed) return;

    setNotice(
      connected
        ? { tone: 'success', message: `Dropbox connected${params.get('account') ? ` as ${params.get('account')}` : ''}.` }
        : { tone: 'danger', message: failed }
    );

    const next = new URLSearchParams(params);
    for (const key of ['dropbox_connected', 'dropbox_error', 'account']) next.delete(key);
    setParams(next, { replace: true });
    refreshStatus();
  }, [params, isAdmin, setParams, refreshStatus]);

  /* ---------------------- OAuth return leg, page-handled callback ---------- */
  useEffect(() => {
    const code = params.get('code');
    if (!code || !isAdmin || _exchangedCodes.has(code)) return;
    _exchangedCodes.add(code);

    setBusy('exchange');
    dropboxAuth({ action: 'exchange', code, state: params.get('state'), redirect_uri: redirectUri })
      .then(({ data }) => {
        if (data?.error) throw new Error(data.error);
        setNotice({ tone: 'success', message: 'Dropbox connected.' });
        return refreshStatus();
      })
      .catch((err) => setNotice({ tone: 'danger', message: err.message || 'Could not complete the connection.' }))
      .finally(() => {
        setBusy('');
        const next = new URLSearchParams(params);
        next.delete('code');
        next.delete('state');
        setParams(next, { replace: true });
      });
  }, [params, isAdmin, redirectUri, refreshStatus, setParams]);

  /* ------------------------------------------------------------- actions -- */

  const run = async (name, fn) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const connect = (reconnect = false) =>
    run(reconnect ? 'reconnect' : 'connect', async () => {
      const { data } = await dropboxAuth({ action: reconnect ? 'reconnect' : 'getAuthUrl' });
      if (!data?.url) throw new Error(data?.error || 'No authorization URL was returned.');
      window.location.href = data.url;
    });

  const testConnection = () =>
    run('test', async () => {
      const { data } = await dropboxAuth({ action: 'test' });
      setNotice(
        data?.ok
          ? {
              // A team space that is available but not enabled is the single
              // most useful thing this button can tell a Business admin.
              tone: data.hint ? 'warning' : 'success',
              message:
                `Connection OK — ${data.accountName || data.account_name || 'account reachable'}.` +
                (data.hint ? ` ${data.hint}` : ''),
            }
          : {
              tone: 'danger',
              message: data?.error?.message || data?.error || 'The connection test failed.',
            }
      );
      await refreshStatus();
    });

  const runSync = (force = false) =>
    run(force ? 'resync' : 'sync', async () => {
      const { data } = await syncDropbox({ trigger: 'manual', force });
      if (data?.status === 'skipped') {
        setNotice({ tone: 'warning', message: data.reason || 'A synchronization is already running.' });
      } else {
        const failed = data?.failed ?? 0;
        setNotice({
          tone: failed ? 'warning' : 'success',
          message:
            `Sync ${data?.status ?? 'finished'} — ${data?.total ?? 0} found, ${data?.new ?? 0} new, ` +
            `${data?.updated ?? 0} updated, ${data?.skipped ?? 0} unchanged, ${data?.deleted ?? 0} archived` +
            (failed ? `, ${failed} failed.` : '.'),
        });
      }
      await refreshStatus();
    });

  const disconnect = () =>
    run('disconnect', async () => {
      // Irreversible for the connection, so it is confirmed. Indexed files are
      // kept either way — the backend says so explicitly in its response.
      if (!window.confirm('Disconnect Dropbox? Indexed presentations are kept, but syncing stops until you reconnect.')) {
        return;
      }
      const { data } = await dropboxAuth({ action: 'disconnect' });
      setNotice({
        tone: 'success',
        message: data?.revoked
          ? 'Dropbox disconnected and the authorization revoked.'
          : 'Dropbox disconnected. The stored credential was cleared.',
      });
      setHealth(null);
      await refreshStatus();
    });

  const browse = useCallback(async (nextPath) => {
    setPickerLoading(true);
    try {
      const { data } = await dropboxAuth({ action: 'list_folders', path: nextPath });
      setEntries(data?.entries || []);
      setBreadcrumbs(data?.breadcrumbs || []);
      setPath(data?.path ?? nextPath);
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setPickerLoading(false);
    }
  }, []);

  const openPicker = () => {
    setPickerOpen(true);
    browse('');
  };

  const useThisFolder = () =>
    run('folder', async () => {
      await dropboxAuth({ action: 'set_root_folder', root_folder: path });
      setNotice({ tone: 'success', message: `Sync folder set to ${path || '/'}.` });
      setPickerOpen(false);
      await refreshStatus();
    });

  const previewRenames = () =>
    run('rename-preview', async () => {
      const { data } = await renameUntitledPresentations({ dryRun: true, limit: 50 });
      setProposals(data);
      setNotice({
        tone: 'success',
        message: `${data?.proposals?.filter((p) => p.proposedName).length ?? 0} of ${data?.examined ?? 0} generically-named files have a proposed title.`,
      });
    });

  const applyRenames = () =>
    run('rename-apply', async () => {
      const count = proposals?.proposals?.filter((p) => p.proposedName).length ?? 0;
      if (!window.confirm(`Rename ${count} file(s) in Dropbox? This changes the files themselves.`)) return;
      const { data } = await renameUntitledPresentations({ dryRun: false, limit: 50 });
      setProposals(data);
      setNotice({
        tone: data?.failed ? 'warning' : 'success',
        message: `Renamed ${data?.renamed ?? 0} file(s)${data?.failed ? `, ${data.failed} failed.` : '.'}`,
      });
      await refreshStatus();
    });

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the URI is visible on screen anyway */
    }
  };

  /* -------------------------------------------------------------- render -- */

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-400">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dropbox configuration is restricted to administrators.
        </p>
        <Button asChild variant="gradient" size="sm" className="mt-6 p-0">
          <Link to="/" className="px-4 py-2">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </Button>
      </div>
    );
  }

  const connected = status?.connection_status === 'connected';
  const configured = status?.configured !== false;
  const healthStatus = health?.status ?? (connected ? 'healthy' : 'disconnected');
  const tone = STATUS_TONES[healthStatus] ?? STATUS_TONES.disconnected;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dropbox Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          SlidesVault indexes one Dropbox folder. Only the long-lived refresh token is stored, encrypted;
          access tokens are minted per request, held in memory and never persisted.
        </p>
      </div>

      {!configured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The server has no Dropbox app credentials. Set <code>DROPBOX_APP_KEY</code> and{' '}
            <code>DROPBOX_APP_SECRET</code> in the backend environment, then restart it.
          </span>
        </div>
      )}

      {notice && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            notice.tone === 'danger'
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : notice.tone === 'warning'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          )}
        >
          {notice.message}
        </div>
      )}

      {/* ------------------------------------------------ connection status */}
      <section className="rounded-2xl glass p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              'grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white',
              connected ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-secondary text-muted-foreground'
            )}
          >
            {connected ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {loading ? 'Checking connection…' : connected ? 'Connected to Dropbox' : 'Not connected'}
              {!loading &&
                (connected ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                ))}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {status?.account_name
                ? `${status.account_name} · ${status.account_email || ''}`
                : 'Authorise a Dropbox account to start indexing presentations.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="gradient" size="sm" onClick={() => connect(connected)} disabled={!!busy || !configured}>
              {busy === 'connect' || busy === 'reconnect' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5" />
              )}
              {connected ? 'Reconnect' : 'Connect Dropbox'}
            </Button>
            <Button variant="outline" size="sm" onClick={testConnection} disabled={!!busy || !connected}>
              {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Test
            </Button>
            <Button variant="outline" size="sm" onClick={() => runSync(false)} disabled={!!busy || !connected}>
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run sync now
            </Button>
            {connected && (
              <Button variant="ghost" size="sm" onClick={disconnect} disabled={!!busy}>
                {busy === 'disconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-x-8 border-t border-border pt-3 sm:grid-cols-2">
          <StatusRow
            label="Health"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                {tone.label}
              </span>
            }
            tone={tone.className}
          />
          <StatusRow label="Root folder" value={status?.root_folder || '/'} />
          {status?.team_space && (
            <StatusRow
              label="Namespace"
              value={`Team space (personal folder: ${status.home_path || '—'})`}
            />
          )}
          <StatusRow label="Sync status" value={status?.sync_status || 'idle'} />
          <StatusRow label="Last sync" value={timeAgo(status?.last_sync_at || status?.last_sync)} />
          <StatusRow
            label="Last token refresh"
            value={timeAgo(status?.last_token_refresh_at || status?.last_token_refresh)}
          />
          <StatusRow label="Account ID" value={status?.account_id || '—'} />
          {health && <StatusRow label="Indexed presentations" value={health.indexedFiles ?? '—'} />}
          {health && <StatusRow label="Archived" value={health.archivedFiles ?? '—'} />}
          <StatusRow
            label="Last error"
            value={status?.last_error || 'none'}
            tone={status?.last_error ? 'text-red-400' : undefined}
          />
          {status?.scheduler && (
            <StatusRow
              label="Scheduled sync"
              value={
                status.scheduler.enabled
                  ? `every ${status.scheduler.interval_minutes} min`
                  : 'disabled'
              }
            />
          )}
        </div>
      </section>

      {/* -------------------------------------------------- redirect helper */}
      <Section icon={Link2} title="OAuth redirect URI">
        <p className="text-xs text-muted-foreground">
          Register this exact URI under your app in the Dropbox App Console before connecting. It must match
          character for character, including the scheme and any trailing path.
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-secondary/60 p-2">
          <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{redirectUri}</code>
          <Button variant="ghost" size="sm" onClick={copyRedirect}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Section>

      {/* ---------------------------------------------------- folder picker */}
      <Section
        icon={Folder}
        title="Sync folder"
        action={
          <Button variant="outline" size="sm" onClick={openPicker} disabled={!connected}>
            <FolderOpen className="h-3.5 w-3.5" /> Browse folders
          </Button>
        }
      >
        {pickerOpen && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <button type="button" onClick={() => browse('')} className="rounded px-1.5 py-0.5 hover:bg-secondary">
                Dropbox
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.path} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button
                    type="button"
                    onClick={() => browse(crumb.path)}
                    className="rounded px-1.5 py-0.5 hover:bg-secondary"
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {pickerLoading ? (
                <p className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folders…
                </p>
              ) : entries.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">No sub-folders here.</p>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.path_lower}
                    type="button"
                    onClick={() => browse(entry.path_lower)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-secondary"
                  >
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{path || '/'}</code>
              <Button variant="gradient" size="sm" onClick={useThisFolder} disabled={busy === 'folder'}>
                {busy === 'folder' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Use this folder
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Files with a{' '}
          {(status?.supported_extensions ?? ['pdf', 'pptx', 'html']).map((extension, index, all) => (
            <span key={extension}>
              <code className="rounded bg-secondary px-1">.{extension}</code>
              {index < all.length - 2 ? ', ' : index === all.length - 2 ? ' or ' : ''}
            </span>
          ))}{' '}
          extension are indexed, classified, and given a thumbnail. Files removed from Dropbox are archived,
          never hard-deleted.
        </p>
      </Section>

      {/* ------------------------------------------------------ bulk rename */}
      {backendMode === 'api' && connected && (
        <Section
          icon={Wand2}
          title="Rename generically-named files"
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={previewRenames} disabled={!!busy}>
                {busy === 'rename-preview' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListChecks className="h-3.5 w-3.5" />
                )}
                Preview
              </Button>
              <Button
                variant="gradient"
                size="sm"
                onClick={applyRenames}
                disabled={!!busy || !proposals?.proposals?.some((p) => p.proposedName)}
              >
                {busy === 'rename-apply' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Apply
              </Button>
            </div>
          }
        >
          <p className="text-xs text-muted-foreground">
            Finds files called <code className="rounded bg-secondary px-1">Untitled (12).pptx</code> and the like,
            reads their title slide, and proposes a real name. Nothing is renamed until you press Apply.
          </p>

          {proposals?.proposals?.length > 0 && (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {proposals.proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/60">
                  <p className="truncate font-mono text-muted-foreground">{proposal.currentName}</p>
                  {proposal.proposedName ? (
                    <p className="truncate font-medium text-emerald-400">
                      → {proposal.finalName || proposal.proposedName}
                      {proposal.renamed && ' ✓'}
                    </p>
                  ) : (
                    <p className="truncate text-muted-foreground">
                      → kept ({proposal.reason || proposal.error})
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ------------------------------------------------------ sync history */}
      {backendMode === 'api' && logs.length > 0 && (
        <Section
          icon={History}
          title="Sync history"
          action={
            <Button variant="ghost" size="sm" onClick={() => runSync(true)} disabled={!!busy || !connected}>
              {busy === 'resync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              Full resync
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Started</th>
                  <th className="py-1 pr-3 font-medium">Trigger</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 text-right font-medium">New</th>
                  <th className="py-1 pr-3 text-right font-medium">Updated</th>
                  <th className="py-1 pr-3 text-right font-medium">Skipped</th>
                  <th className="py-1 pr-3 text-right font-medium">Archived</th>
                  <th className="py-1 pr-3 text-right font-medium">Failed</th>
                  <th className="py-1 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 text-muted-foreground">{timeAgo(log.started_at)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{log.trigger}</td>
                    <td
                      className={cn(
                        'py-1.5 pr-3 font-medium',
                        log.status === 'success'
                          ? 'text-emerald-400'
                          : log.status === 'partial'
                            ? 'text-amber-400'
                            : log.status === 'running'
                              ? 'text-muted-foreground'
                              : 'text-red-400'
                      )}
                    >
                      {log.status}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{log.new_files}</td>
                    <td className="py-1.5 pr-3 text-right">{log.updated_files}</td>
                    <td className="py-1.5 pr-3 text-right">{log.skipped_files}</td>
                    <td className="py-1.5 pr-3 text-right">{log.deleted_files}</td>
                    <td className={cn('py-1.5 pr-3 text-right', log.failed_files ? 'text-red-400' : '')}>
                      {log.failed_files}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
