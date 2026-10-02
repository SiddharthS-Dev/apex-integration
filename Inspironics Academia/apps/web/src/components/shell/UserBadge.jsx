import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, User } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import UserAvatar from '@/components/shell/UserAvatar';

export { initials } from '@/components/shell/UserAvatar';

export default function UserBadge({ user, onLogout }) {
  if (!user) return null;
  const name = user.full_name || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted">
        <UserAvatar user={user} className="w-9 h-9 ring-2 ring-violet-500/30 shadow-md shadow-violet-500/30" textClassName="text-xs" />
        <div className="hidden 2xl:block leading-tight text-left">
          <div className="text-sm font-semibold max-w-[140px] truncate">{name}</div>
          <div className="text-xs text-muted-foreground capitalize">{user.role || 'user'}</div>
        </div>
        <ChevronDown className="hidden sm:block w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/profile"><User /> Profile</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}><LogOut /> Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
