import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { cn, initials } from '@/lib/utils';

export default function UserProfileChip({ compact = false, className }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Link
        to="/dashboard"
        className="group flex items-center gap-2 rounded-full glass py-1 pl-1 pr-3 transition-colors hover:bg-card/80"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] font-bold text-white">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            initials(user.full_name || user.email)
          )}
          {user.role === 'admin' && (
            <ShieldCheck className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-background text-emerald-400" />
          )}
        </span>
        {!compact && (
          <span className="hidden min-w-0 flex-col leading-tight lg:flex">
            <span className="truncate text-xs font-medium group-hover:text-primary">
              {user.full_name || user.email}
            </span>
            <span className="truncate text-[10px] capitalize text-muted-foreground">{user.role}</span>
          </span>
        )}
      </Link>

      <button
        type="button"
        onClick={handleLogout}
        aria-label="Sign out"
        title="Sign out"
        className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
