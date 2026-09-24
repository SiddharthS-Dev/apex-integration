import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Users, Activity, Radio, Eye, Library as LibraryIcon, HardDrive, Download, TrendingUp,
  ShieldAlert, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Cloud,
} from 'lucide-react';
import {
  Presentation, PresentationAnalytics, SyncLog, LoginHistory, User, DropboxConfig, listAll,
} from '@/api/entities';
import { syncDropbox } from '@/api/functions';
import { getAllCachedIds } from '@/lib/offline-db';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui';
import { DOMAINS, DOMAIN_NAMES } from '@/lib/domains';
import { cn, formatBytes, formatDate, timeAgo } from '@/lib/utils';

function StatCard({ icon: Icon, label, value, tint, hint }) {
  return (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white', tint)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2.5 text-2xl font-bold leading-none">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="space-y-3 rounded-2xl glass p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

const chartTooltip = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 12,
    fontSize: 12,
  },
};

export default function Admin() {
  const { user } = useAuth();
  const [state, setState] = useState({
    presentations: [], analytics: [], users: [], logins: [], syncLogs: [], config: null, cachedIds: [],
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [presentations, analytics, users, logins, syncLogs, configs, cachedIds] = await Promise.all([
        listAll(Presentation, { sort: '-created_date' }),
        listAll(PresentationAnalytics, { sort: '-total_views' }),
        listAll(User, { sort: '-created_date' }),
        LoginHistory.list('-login_at', 500),
        SyncLog.list('-started_at', 10),
        DropboxConfig.list('-created_date', 1),
        getAllCachedIds(),
      ]);
      setState({ presentations, analytics, users, logins, syncLogs, config: configs[0] || null, cachedIds });
    } catch (err) {
      console.error('[admin] load failed', err);
      setNotice({ tone: 'danger', message: err.message || 'Failed to load admin data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  const { presentations, analytics, users, logins, syncLogs, config, cachedIds } = state;

  const activePresentations = useMemo(
    () => presentations.filter((p) => p.status !== 'archived'),
    [presentations]
  );

  const stats = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 86400000;
    const fifteenMin = now - 15 * 60000;
    const weekAgo = now - 7 * 86400000;
    const todayKey = new Date().toISOString().slice(0, 10);

    const activeUsers = users.filter((u) => u.last_active && new Date(u.last_active).getTime() >= dayAgo);
    const onlineNow = users.filter((u) => u.last_active && new Date(u.last_active).getTime() >= fifteenMin);

    const viewsToday = analytics.reduce(
      (sum, a) => sum + ((a.daily_breakdown || []).find((d) => d.date === todayKey)?.count || 0),
      0
    );
    const viewsWeek = analytics.reduce(
      (sum, a) =>
        sum +
        (a.daily_breakdown || []).reduce(
          (s, d) => (new Date(d.date).getTime() >= weekAgo ? s + (d.count || 0) : s),
          0
        ),
      0
    );
    const storage = activePresentations.reduce((sum, p) => sum + (p.file_size || 0), 0);

    return {
      totalUsers: users.length,
      activeUsers: activeUsers.length,
      onlineNow: onlineNow.length,
      viewsToday,
      viewsWeek,
      presentations: activePresentations.length,
      storage,
      cached: cachedIds.length,
    };
  }, [users, analytics, activePresentations, cachedIds]);

  const dailyActivity = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const views = analytics.reduce(
        (sum, a) => sum + ((a.daily_breakdown || []).find((d) => d.date === date)?.count || 0),
        0
      );
      const sessions = logins.filter((l) => String(l.login_at).slice(0, 10) === date).length;
      days.push({ date: date.slice(5), views, sessions });
    }
    return days;
  }, [analytics, logins]);

  const userGrowth = useMemo(() => {
    const sorted = [...users].sort(
      (a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0)
    );
    const buckets = [];
    for (let i = 11; i >= 0; i -= 1) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - i);
      const label = cutoff.toLocaleDateString(undefined, { month: 'short' });
      const total = sorted.filter((u) => new Date(u.created_date || 0) <= cutoff).length;
      buckets.push({ month: label, users: total });
    }
    return buckets;
  }, [users]);

  const domainDistribution = useMemo(() => {
    const counts = new Map(DOMAIN_NAMES.map((d) => [d, 0]));
    activePresentations.forEach((p) => {
      if (counts.has(p.primary_domain)) counts.set(p.primary_domain, counts.get(p.primary_domain) + 1);
    });
    const rows = [...counts.entries()];
    const max = Math.max(1, ...rows.map(([, c]) => c));
    return rows.map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }));
  }, [activePresentations]);

  const insights = useMemo(() => {
    const sortedByViews = [...activePresentations].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    const domainCounts = new Map();
    activePresentations.forEach((p) => {
      domainCounts.set(p.primary_domain, (domainCounts.get(p.primary_domain) || 0) + (p.view_count || 0));
    });
    const popularDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      mostPopular: sortedByViews[0],
      leastViewed: sortedByViews[sortedByViews.length - 1],
      popularDomain: popularDomain ? { name: popularDomain[0], views: popularDomain[1] } : null,
    };
  }, [activePresentations]);

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const { data } = await syncDropbox({ trigger: 'manual' });
      setNotice({
        tone: data?.errors?.length ? 'warning' : 'success',
        message: `Sync ${data?.status || 'finished'} — ${data?.indexed ?? 0} indexed, ${data?.new ?? 0} new, ${data?.updated ?? 0} updated, ${data?.deleted ?? 0} archived.${
          data?.errors?.length ? ` ${data.errors[0]}` : ''
        }`,
      });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message || 'Sync failed.' });
    } finally {
      setSyncing(false);
    }
  };

  const promote = async (target) => {
    try {
      await User.update(target.id, { role: 'admin' });
      setNotice({ tone: 'success', message: `${target.full_name || target.email} is now an admin.` });
      await load();
    } catch (err) {
      setNotice({ tone: 'danger', message: err.message || 'Could not update that user.' });
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
          This console is restricted to administrators. Ask an admin to grant you access if you need it.
        </p>
        <Button asChild variant="gradient" size="sm" className="mt-6 p-0">
          <Link to="/" className="px-4 py-2">
            Back to home
          </Link>
        </Button>
      </div>
    );
  }

  const lastSync = syncLogs[0];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Usage, catalog health, sync status and user management.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </Button>
          <Button variant="gradient" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
            Run sync now
          </Button>
        </div>
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

      {/* ----------------------------------------------------------- stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} tint="from-indigo-500 to-violet-500" />
        <StatCard icon={Activity} label="Active (24h)" value={stats.activeUsers} tint="from-sky-500 to-cyan-500" />
        <StatCard icon={Radio} label="Online Now" value={stats.onlineNow} tint="from-emerald-500 to-teal-500" />
        <StatCard icon={Eye} label="Views Today" value={stats.viewsToday} tint="from-amber-500 to-orange-500" />
        <StatCard icon={LibraryIcon} label="Presentations" value={stats.presentations} tint="from-violet-500 to-purple-500" />
        <StatCard icon={HardDrive} label="Storage Used" value={formatBytes(stats.storage)} tint="from-rose-500 to-pink-500" />
        <StatCard icon={Download} label="Cached Offline" value={stats.cached} tint="from-teal-500 to-emerald-500" hint="on this device" />
        <StatCard icon={TrendingUp} label="Views This Week" value={stats.viewsWeek} tint="from-fuchsia-500 to-pink-500" />
      </section>

      {/* ---------------------------------------------------------- charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Daily Activity (14 days)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyActivity} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="sessionsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d946ef" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#d946ef" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...chartTooltip} />
              <Area type="monotone" dataKey="views" stroke="#6366f1" fill="url(#viewsFill)" strokeWidth={2} name="Views" />
              <Area type="monotone" dataKey="sessions" stroke="#d946ef" fill="url(#sessionsFill)" strokeWidth={2} name="Logins" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="User Growth (cumulative)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={userGrowth} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...chartTooltip} />
              <Area type="monotone" dataKey="users" stroke="#10b981" fill="url(#usersFill)" strokeWidth={2} name="Users" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* -------------------------------------------------------- insights */}
      <section className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Most Popular', item: insights.mostPopular, tone: 'text-emerald-400' },
          { label: 'Least Viewed', item: insights.leastViewed, tone: 'text-amber-400' },
        ].map(({ label, item, tone }) => (
          <div key={label} className="rounded-2xl glass p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            {item ? (
              <Link to={`/presentation/${item.id}`} className="mt-2 block">
                <p className="line-clamp-2 text-sm font-semibold hover:text-primary">{item.title}</p>
                <p className={cn('mt-1 text-xs', tone)}>{item.view_count || 0} views · {item.primary_domain}</p>
              </Link>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No data yet.</p>
            )}
          </div>
        ))}
        <div className="rounded-2xl glass p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Popular Domain</p>
          {insights.popularDomain ? (
            <>
              <p className="mt-2 text-sm font-semibold">{insights.popularDomain.name}</p>
              <p className="mt-1 text-xs text-violet-400">{insights.popularDomain.views} total views</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No data yet.</p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------- sync + domains */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl glass p-4">
          <h2 className="text-sm font-semibold">Sync Status</h2>
          {lastSync ? (
            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Last run</dt>
                <dd className="font-medium">{timeAgo(lastSync.started_at)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd className={cn('inline-flex items-center gap-1 font-medium', lastSync.status === 'success' ? 'text-emerald-400' : lastSync.status === 'error' ? 'text-red-400' : 'text-amber-400')}>
                  {lastSync.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : lastSync.status === 'error' ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {lastSync.status}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Trigger</dt>
                <dd className="font-medium capitalize">{lastSync.trigger}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Counts</dt>
                <dd className="font-medium">
                  {lastSync.new_count} new · {lastSync.updated_count} updated · {lastSync.deleted_count} archived
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Connection</dt>
                <dd className={cn('font-medium', config?.connection_status === 'connected' ? 'text-emerald-400' : 'text-muted-foreground')}>
                  {config?.connection_status || 'disconnected'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              No sync has run yet.{' '}
              <Link to="/dropbox-settings" className="text-primary hover:underline">
                Connect Dropbox
              </Link>{' '}
              to index the first files.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl glass p-4">
          <h2 className="text-sm font-semibold">Domain Distribution</h2>
          <div className="space-y-2.5">
            {domainDistribution.map(({ name, count, pct }) => (
              <div key={name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{name}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn('h-full rounded-full bg-gradient-to-r transition-all', DOMAINS[name].gradient)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- users */}
      <section className="space-y-3 rounded-2xl glass p-4">
        <h2 className="text-sm font-semibold">User Management</h2>
        <div className="divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] font-bold text-white">
                {(u.full_name || u.email || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{u.full_name || u.email}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                Joined {formatDate(u.created_date)}
              </span>
              <span className="hidden text-xs text-muted-foreground md:block">
                Active {timeAgo(u.last_active || u.last_login)}
              </span>
              {u.role === 'admin' ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                  <ShieldCheck className="h-3 w-3" /> Admin
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => promote(u)}>
                  Promote to admin
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- sync logs */}
      <section className="space-y-3 rounded-2xl glass p-4">
        <h2 className="text-sm font-semibold">Sync Logs</h2>
        {syncLogs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No sync runs recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Trigger</th>
                  <th className="py-2 pr-3 font-medium">New</th>
                  <th className="py-2 pr-3 font-medium">Updated</th>
                  <th className="py-2 pr-3 font-medium">Archived</th>
                  <th className="py-2 font-medium">Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {syncLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 pr-3">{formatDate(log.started_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className={cn('py-2 pr-3 capitalize', log.status === 'success' ? 'text-emerald-400' : log.status === 'error' ? 'text-red-400' : 'text-amber-400')}>
                      {log.status}
                    </td>
                    <td className="py-2 pr-3 capitalize">{log.trigger}</td>
                    <td className="py-2 pr-3">{log.new_count}</td>
                    <td className="py-2 pr-3">{log.updated_count}</td>
                    <td className="py-2 pr-3">{log.deleted_count}</td>
                    <td className="py-2">{log.total_files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
