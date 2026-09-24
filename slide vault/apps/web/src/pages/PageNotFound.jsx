import { Link } from 'react-router-dom';
import { Compass, SearchX } from 'lucide-react';
import { Button } from '@/components/ui';

export default function PageNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white">
        <SearchX className="h-7 w-7" />
      </span>
      <p className="mt-6 font-mono text-5xl font-bold tracking-tight">404</p>
      <h1 className="mt-2 text-xl font-semibold">This page does not exist</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may be out of date, or the presentation may have been archived.
      </p>
      <Button asChild variant="gradient" className="mt-6 p-0">
        <Link to="/" className="flex items-center gap-2 px-4 py-2">
          <Compass className="h-4 w-4" /> Back to home
        </Link>
      </Button>
    </div>
  );
}
