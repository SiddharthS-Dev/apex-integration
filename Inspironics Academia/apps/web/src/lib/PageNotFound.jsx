import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PageNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center bg-background">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
        <Compass className="w-7 h-7 text-white" />
      </div>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted-foreground max-w-sm">The page you are looking for doesn&apos;t exist or has been moved.</p>
      <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
    </div>
  );
}
