import { Link } from 'react-router-dom';
import { ArrowRight, Building2, FileText, Layers, UserRound } from 'lucide-react';
import StatusBadge from '@/components/admin/StatusBadge';

function Meta({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" /> {children}
    </span>
  );
}

export default function PlaybookCard({ playbook, courses, showStatus }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-snug line-clamp-2">{playbook.title}</h3>
            {showStatus && <StatusBadge status={playbook.status} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
            {playbook.organization && <Meta icon={Building2}>{playbook.organization}</Meta>}
            {playbook.author && <Meta icon={UserRound}>{playbook.author}</Meta>}
            <Meta icon={Layers}>{playbook.chapter_count || 0} chapters</Meta>
            {playbook.version && <span>v{playbook.version}</span>}
          </div>
        </div>
      </div>
      {playbook.toc_summary && <p className="text-sm text-muted-foreground line-clamp-3">{playbook.toc_summary}</p>}
      <div className="mt-auto">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Courses</div>
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No published course yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {courses.map((c) => (
              <li key={c.id}>
                <Link to={`/courses/${c.id}`} className="group flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/40 hover:bg-primary/5">
                  <span className="truncate">{c.title}</span>
                  <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
