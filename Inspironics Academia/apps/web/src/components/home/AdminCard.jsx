import { Link } from 'react-router-dom';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminCard() {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0">
        <LayoutDashboard className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold">Admin workspace</h3>
        <p className="text-sm text-muted-foreground">
          Upload playbooks, review AI-generated content, publish courses and track learner progress.
        </p>
      </div>
      <Button asChild size="sm">
        <Link to="/admin">Open admin <ArrowRight /></Link>
      </Button>
    </section>
  );
}
