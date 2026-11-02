import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Info } from 'lucide-react';
import { toast } from 'sonner';
import { ENTITIES, NOTIFICATION_PREFS } from '@academy/shared';
import { api } from '@/api/client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import useAppConfig from '@/lib/useAppConfig';
import { cn } from '@/lib/utils';

const DEFAULTS = Object.fromEntries(
  Object.entries(ENTITIES.NotificationPreference.properties).filter(([, p]) => p.type === 'boolean').map(([k, p]) => [k, p.default]),
);

// Which notifications also arrive by email. In-app notifications are always on. The row is created
// the first time something changes; until then the schema defaults apply.
export default function NotificationPreferences() {
  const { user } = useAuth();
  const config = useAppConfig();
  const queryClient = useQueryClient();
  const key = ['notification-prefs', user?.id];
  const { data: row, isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    queryFn: async () => (await api.entities.NotificationPreference.filter({ user_id: user.id }, '-created_date', 1))[0] || null,
  });
  const prefs = { ...DEFAULTS, ...(row || {}) };

  const set = async (field, value) => {
    queryClient.setQueryData(key, { ...prefs, [field]: value });
    try {
      const saved = row?.id
        ? await api.entities.NotificationPreference.update(row.id, { [field]: value })
        : await api.entities.NotificationPreference.create({ user_id: user.id, ...DEFAULTS, [field]: value });
      queryClient.setQueryData(key, saved);
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: key });
      toast.error(e?.message || 'Could not save preference');
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold flex items-center gap-2"><BellRing className="w-4 h-4 text-primary" /> Email notifications</h3>
      <p className="text-sm text-muted-foreground mt-1">Choose what also reaches your inbox. Everything always appears under the bell.</p>
      {config.loaded && !config.email_enabled && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-px" />
          Email delivery isn't configured on this server; you'll still see in-app notifications.
        </p>
      )}
      <div className="mt-4 space-y-3">
        <PrefRow id="pref-email" label="Send me emails" hint="Master switch for every notification email" checked={prefs.email_enabled} disabled={isLoading} onChange={(v) => set('email_enabled', v)} />
        <div className={cn('space-y-3 pl-4 border-l border-border', !prefs.email_enabled && 'opacity-50')}>
          {NOTIFICATION_PREFS.map((p) => (
            <PrefRow key={p.key} id={`pref-${p.key}`} label={p.label} hint={p.hint} checked={prefs[p.key]} disabled={isLoading || !prefs.email_enabled} onChange={(v) => set(p.key, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PrefRow({ id, label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked !== false} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
