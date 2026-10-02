import { cn } from '@/lib/utils';

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

// The user's profile photo, falling back to initials on the brand gradient.
export default function UserAvatar({ user, className, textClassName }) {
  const name = user?.full_name || user?.email || '';
  return (
    <div className={cn('rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-semibold flex items-center justify-center shrink-0', className)}>
      {user?.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        : <span className={textClassName}>{initials(name)}</span>}
    </div>
  );
}
