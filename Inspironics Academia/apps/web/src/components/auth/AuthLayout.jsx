import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

// Standalone centered layout for public pages (auth flows, certificate verification).
export default function AuthLayout({ title, description, children, footer, wide = false }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-violet-600/10 dark:bg-violet-600/15 blur-3xl" />
      <div className={cn('relative w-full', wide ? 'max-w-lg' : 'max-w-md')}>
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Inspironics Learn</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
          {(title || description) && (
            <div className="mb-6 text-center">
              {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
              {description && <p className="text-sm text-muted-foreground mt-1.5">{description}</p>}
            </div>
          )}
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}
