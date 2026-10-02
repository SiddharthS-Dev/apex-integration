import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

export default function AdminGuard({ children }) {
  const { user } = useAuth();

  if (user?.role === 'admin') return children;

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center flex flex-col items-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 flex items-center justify-center">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h1 className="text-2xl font-bold">Access denied</h1>
      <p className="text-muted-foreground">This area is restricted to administrators.</p>
      <Button asChild><Link to="/dashboard">Go to dashboard</Link></Button>
    </div>
  );
}
