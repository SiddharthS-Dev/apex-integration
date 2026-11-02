import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/AuthContext';
import { cn } from '@/lib/utils';

const STATUS_STYLE = {
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  queued: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  skipped: 'bg-muted text-muted-foreground',
};

const COUNTS = [['sent', 'Sent'], ['queued', 'Queued'], ['failed', 'Failed'], ['skipped', 'Skipped']];

// Email delivery: which provider is active, the outbox totals and the latest deliveries, plus a test send.
export default function EmailDeliveryCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['email-status'],
    queryFn: () => api.notifications.emailStatus(),
    refetchInterval: 30_000,
  });

  const sendTest = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await api.notifications.sendTestEmail(to.trim() || user?.email);
      toast.success(res?.status === 'sent' ? 'Test email sent' : `Test email ${res?.status || 'queued'}`);
      queryClient.invalidateQueries({ queryKey: ['email-status'] });
    } catch (err) {
      toast.error(err?.message || 'Could not send the test email');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 flex items-center justify-center shrink-0">
          <Mail className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">Invitations, password resets, review reminders and recertification notices.</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading email status…</p>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {data && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-xl bg-muted/60 p-3">
              <div className="text-xs text-muted-foreground">Provider</div>
              <div className="font-medium">{data.provider || '—'}</div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3 min-w-0">
              <div className="text-xs text-muted-foreground">From</div>
              <div className="font-medium truncate" title={data.from}>{data.from || '—'}</div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <div className="text-xs text-muted-foreground">Delivery</div>
              <div className={cn('font-medium', data.configured ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300')}>
                {data.configured ? 'Configured' : 'Not configured — emails are logged only'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {COUNTS.map(([key, label]) => (
              <span key={key} className={cn('rounded-full px-2.5 py-1 text-xs font-medium tabular-nums', STATUS_STYLE[key])}>
                {label}: {data.outbox?.[key] ?? 0}
              </span>
            ))}
          </div>

          <form onSubmit={sendTest} className="flex flex-col sm:flex-row gap-2">
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={user?.email || 'you@example.com'} aria-label="Test email recipient" />
            <Button type="submit" size="sm" variant="outline" disabled={sending} className="shrink-0">
              {sending ? <Loader2 className="animate-spin" /> : <Send />} Send test email
            </Button>
          </form>

          {data.recent?.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {m.created_at ? formatDistanceToNow(new Date(m.created_at), { addSuffix: true }) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{m.to_email}</TableCell>
                      <TableCell className="text-xs max-w-[18rem] truncate" title={m.subject}>{m.subject}</TableCell>
                      <TableCell>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[m.status] || STATUS_STYLE.skipped)} title={m.last_error || undefined}>
                          {m.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{m.attempts ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No emails sent yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
