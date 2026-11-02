import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/lib/retention';

// In-app notifications (review reminders, new courses, certificates, recertification). Polled every
// minute; opening one marks it read and follows its link.
export default function NotificationBell() {
  const { data: items = [] } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) api.entities.Notification.update(n.id, { read: true }).then(refresh).catch(() => {});
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try {
      await Promise.all(unread.map((n) => api.entities.Notification.update(n.id, { read: true })));
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not update notifications');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}>
          <Bell />
          {unread.length > 0 && (
            <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-4 text-center tabular-nums">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Notifications</span>
          {unread.length > 0 && (
            <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-4">
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn('w-full text-left px-4 py-3 flex gap-3 hover:bg-muted/60 transition-colors', !n.read && 'bg-primary/5')}
                  >
                    <span aria-hidden="true" className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', n.read ? 'bg-transparent' : 'bg-primary')} />
                    <span className="min-w-0">
                      <span className={cn('block text-sm leading-snug', !n.read && 'font-semibold')}>{n.title}</span>
                      {n.body && <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</span>}
                      <span className="block text-[11px] text-muted-foreground mt-1">
                        {n.created_date ? formatDistanceToNow(new Date(n.created_date), { addSuffix: true }) : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
