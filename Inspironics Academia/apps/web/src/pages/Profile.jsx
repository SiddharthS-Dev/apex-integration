import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import ProfileCard from '@/components/profile/ProfileCard';
import ProfileStats from '@/components/profile/ProfileStats';
import ChangePasswordForm from '@/components/profile/ChangePasswordForm';
import ThemePreference from '@/components/profile/ThemePreference';

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  if (!user) return <LoadingState label="Loading profile…" />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <PageHeader
        icon={UserRound}
        title="Profile"
        description="Manage your account and preferences."
        actions={<Button size="sm" variant="outline" onClick={logout}><LogOut /> Log out</Button>}
      />
      <ProfileCard user={user} refreshUser={refreshUser} />
      <ProfileStats />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChangePasswordForm user={user} />
        <ThemePreference />
      </div>
    </div>
  );
}
