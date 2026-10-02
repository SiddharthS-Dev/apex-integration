import { Link } from 'react-router-dom';
import { BookOpen, PlayCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeHero({ user }) {
  const firstName = (user?.full_name || '').split(' ')[0];
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-indigo-50 via-card to-violet-50 dark:from-indigo-950/40 dark:via-card dark:to-violet-950/40 p-8 sm:p-12">
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-600/20 blur-3xl" />
      <div className="relative max-w-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium">
          <Sparkles className="w-3.5 h-3.5" /> {greeting()}{firstName ? `, ${firstName}` : ''}
        </span>
        <h1 className="mt-4 text-3xl sm:text-5xl font-bold tracking-tight">
          Turn engineering playbooks into{' '}
          <span className="bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">mastery</span>
        </h1>
        <p className="mt-4 text-muted-foreground text-base sm:text-lg">
          Inspironics Engineering Academy transforms our engineering playbooks into structured learning paths,
          AI-narrated video lessons and assessments — so every engineer can learn the way we build.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/courses"><BookOpen /> Browse courses</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/dashboard"><PlayCircle /> Continue learning</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
