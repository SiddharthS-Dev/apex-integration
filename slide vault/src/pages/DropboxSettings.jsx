import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Cloud, CloudOff, ShieldAlert, RefreshCw, Loader2, CheckCircle2, XCircle, Folder,
  FolderOpen, ChevronRight, Copy, Check, Link2, PlugZap, FlaskConical, ArrowLeft,
} from 'lucide-react';
import { dropboxAuth, syncDropbox } from '@/api/functions';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui';
import { cn, timeAgo } from '@/lib/utils';

/**
 * React StrictMode mounts effects twice in development. Exchanging the same
 * OAuth code twice fails on Dropbox's side, so codes are deduped per page load.
 */
const _exchangedCodes = new Set();

function StatusRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('truncate font-medium', tone)}>{value}</span>
    </div>
  );
}

export default function DropboxSettings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const redirectUri = useMemo(() => `${window.location.origin}/dropbox-settings`, []);

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await dropboxAuth({ action: 'status' });
      setStatus(data);
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

  // OAuth return leg: ?code=... comes back from Dropbox.
  useEffect(() => {
    const code = params.get('code');
    if (!code || !isAdmin || _exchangedCodes.has(code)) return;
    _exchangedCodes.add(code);

    setBusy('exchange');
    dropboxAuth({ action: 'exchange', code, redirect_uri: redirectUri })
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

  const connect = async () => {
    setBusy('connect');
    setNotice(null);
    try {
      const { data } = await dropboxAuth({ action: 'getAuthUrl', redirect_uri: redirectUri });
      if (data?.url) window.location.href = data.url;
      else throw new Error(data?.error || 'No authorization URL was returned.');
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const testConnection = async () => {
    setBusy('test');
    setNotice(null);
    try {
      const { data } = await dropboxAuth({ action: 'test' });
      setNotice(
        data?.ok
          ? { tone: 'success', message: `Connection OK — ${data.account_name || 'account reachable'}.` }
          : { tone: 'danger', message: data?.error || 'The connection test failed.' }
      );
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const runSync = async () => {
    setBusy('sync');
    setNotice(null);
    try {
      const { data } = await syncDropbox({ trigger: 'manual' });
      setNotice({
        tone: data?.errors?.length ? 'warning' : 'success',
        message: `Sync ${data?.status || 'finished'} — ${data?.indexed ?? 0} indexed, ${data?.new ?? 0} new, ${data?.updated ?? 0} updated.${data?.errors?.length ? ` ${data.errors[0]}` : ''}`,
      });
      await refreshStatus();
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const browse = useCallback(async (nextPath) => {
    setPickerLoading(true);
    try {
      const { data } = await dropboxAuth({ action: 'list_folders', path: nextPath });
      setEntries(data?.entries || []);
      setPath(nextPath);
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

  const useThisFolder = async () => {
    setBusy('folder');
    try {
      await dropboxAuth({ action: 'set_root_folder', root_folder: path || '/' });
      setNotice({ tone: 'success', message: `Sync folder set to ${path || '/'}.` });
      setPickerOpen(false);
      await refreshStatus();
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the URI is visible on screen anyway */
    }
  };

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
  const crumbs = (path || '').split('/').filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dropbox Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          SlidesVault indexes one Dropbox folder. Only the long-lived refresh token is stored — access
          tokens are minted per request and never persisted.
        </p>
      </div>

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
              {status?.connected_account_name
                ? `${status.connected_account_name} · ${status.connected_account_email || ''}`
                : 'Authorise a Dropbox account to start indexing presentations.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="gradient" size="sm" onClick={connect} disabled={busy === 'connect'}>
              {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
              {connected ? 'Reconnect' : 'Connect Dropbox'}
            </Button>
            <Button variant="outline" size="sm" onClick={testConnection} disabled={busy === 'test'}>
              {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Test
            </Button>
            <Button variant="outline" size="sm" onClick={runSync} disabled={busy === 'sync'}>
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run sync now
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-x-8 border-t border-border pt-3 sm:grid-cols-2">
          <StatusRow label="Root folder" value={status?.root_folder || '—'} />
          <StatusRow label="Sync status" value={status?.sync_status || 'idle'} />
          <StatusRow label="Last sync" value={timeAgo(status?.last_sync)} />
          <StatusRow label="Last token refresh" value={timeAgo(status?.last_token_refresh)} />
          <StatusRow label="Account ID" value={status?.account_id || '—'} />
          <StatusRow
            label="Last error"
            value={status?.last_error || 'none'}
            tone={status?.last_error ? 'text-red-400' : undefined}
          />
        </div>
      </section>

      {/* -------------------------------------------------- redirect helper */}
      <section className="space-y-2 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-primary" /> OAuth redirect URI
        </h2>
        <p className="text-xs text-muted-foreground">
          Register this exact URI under your app in the Dropbox App Console before connecting.
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-secondary/60 p-2">
          <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{redirectUri}</code>
          <Button variant="ghost" size="sm" onClick={copyRedirect}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------ folder picker */}
      <section className="space-y-3 rounded-2xl glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Folder className="h-4 w-4 text-primary" /> Sync folder
          </h2>
          <Button variant="outline" size="sm" onClick={openPicker}>
            <FolderOpen className="h-3.5 w-3.5" /> Browse folders
          </Button>
        </div>

        {pickerOpen && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <button type="button" onClick={() => browse('')} className="rounded px-1.5 py-0.5 hover:bg-secondary">
                Dropbox
              </button>
              {crumbs.map((crumb, i) => (
                <span key={`${crumb}-${i}`} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button
                    type="button"
                    onClick={() => browse(`/${crumbs.slice(0, i + 1).join('/')}`)}
                    className="rounded px-1.5 py-0.5 hover:bg-secondary"
                  >
                    {crumb}
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
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {path || '/'}
              </code>
              <Button variant="gradient" size="sm" onClick={useThisFolder} disabled={busy === 'folder'}>
                {busy === 'folder' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Use this folder
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Files with a <code className="rounded bg-secondary px-1">.pdf</code>,{' '}
          <code className="rounded bg-secondary px-1">.pptx</code> or{' '}
          <code className="rounded bg-secondary px-1">.html</code> extension are indexed, classified by
          AI, and given a thumbnail. Files removed from Dropbox are archived, never hard-deleted.
        </p>
      </section>
    </div>
  );
}
