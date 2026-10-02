import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { Camera, Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import UserAvatar from '@/components/shell/UserAvatar';

// Crops the picked image to a centred square and re-encodes it small (256px JPEG), so the photo
// can live on the user record without a separate file store.
async function toAvatarDataUrl(file) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function AvatarEditor({ user, refreshUser }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  const save = async (avatarUrl, message) => {
    setBusy(true);
    try {
      await api.auth.updateMe({ avatar_url: avatarUrl });
      await refreshUser();
      toast.success(message);
    } catch (e) {
      toast.error('Could not update photo', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await save(await toAvatarDataUrl(file), 'Photo updated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label="Update photo"
        className="group relative w-20 h-20 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <UserAvatar user={user} className="w-20 h-20" textClassName="text-2xl" />
        <span
          className={`absolute inset-0 rounded-full bg-slate-950/55 backdrop-blur-[2px] text-white flex flex-col items-center justify-center gap-0.5 transition-opacity duration-200 ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          <span className="text-[10px] font-medium leading-none">{busy ? 'Saving…' : 'Update Photo'}</span>
        </span>
      </button>
      {user.avatar_url && !busy && (
        <button type="button" onClick={() => save('', 'Photo removed')} className="text-[11px] text-muted-foreground hover:text-rose-500 inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> Remove
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPick} />
    </div>
  );
}

const micro = 'inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium transition-all duration-200 active:scale-95 disabled:opacity-50';

export default function ProfileCard({ user, refreshUser }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.full_name || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await api.auth.updateMe({ full_name: name.trim() });
      await refreshUser();
      toast.success('Profile updated');
      setEditing(false);
    } catch (e) {
      toast.error('Could not update profile', { description: e?.message });
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => { setName(user.full_name || ''); setEditing(false); };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-5">
      <AvatarEditor user={user} refreshUser={refreshUser} />
      <div className="flex-1 min-w-0 space-y-1.5">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-wrap items-center gap-2 max-w-lg">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && cancel()}
              autoFocus
              maxLength={200}
              aria-label="Full name"
              placeholder="Full name"
              className="flex-1 min-w-[12rem] h-10 rounded-xl border border-input bg-background px-3 text-lg font-semibold outline-none transition-shadow focus:border-primary/60 focus:ring-2 focus:ring-primary/25 caret-primary dark:bg-slate-950/60"
            />
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className={`${micro} bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25 hover:shadow-[0_0_14px_-2px_rgb(16_185_129/0.7)]`}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
            </button>
            <button type="button" onClick={cancel} className={`${micro} bg-muted text-muted-foreground ring-1 ring-border hover:text-foreground hover:bg-muted/80`}>
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-semibold truncate">{user.full_name || 'Unnamed learner'}</h2>
            <button
              type="button"
              onClick={() => { setName(user.full_name || ''); setEditing(true); }}
              aria-label="Edit name"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
        <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="capitalize">{user.role || 'user'}</Badge>
          {user.created_date && <span>Member since {format(new Date(user.created_date), 'MMMM yyyy')}</span>}
        </div>
      </div>
    </div>
  );
}
