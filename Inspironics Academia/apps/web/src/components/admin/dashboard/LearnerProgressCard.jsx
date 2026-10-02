import { Link } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';

export default function LearnerProgressCard({ progress = [], users = [], courses = [], certificates = [] }) {
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const courseMap = Object.fromEntries(courses.map((c) => [c.id, c]));
  const active = new Set(progress.filter((p) => p.started || (p.percentage || 0) > 0).map((p) => p.user_id)).size;
  const avg = progress.length
    ? Math.round(progress.reduce((s, p) => s + (p.percentage || 0), 0) / progress.length)
    : 0;
  const completed = progress.filter((p) => (p.percentage || 0) >= 100).length;
  const summary = [
    { label: 'Active', value: active },
    { label: 'Avg done', value: `${avg}%` },
    { label: 'Completed', value: completed },
    { label: 'Certs', value: certificates.length },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Learner progress</h2>
        <Link to="/admin/learners" className="text-xs text-primary hover:underline">View all</Link>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {summary.map((s) => (
          <div key={s.label} className="rounded-xl bg-muted/60 p-2 text-center">
            <div className="font-semibold">{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      {progress.length === 0 && <p className="text-sm text-muted-foreground">No learner activity yet.</p>}
      <ul className="space-y-3">
        {progress.slice(0, 5).map((p) => (
          <li key={p.id}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-medium truncate">{userMap[p.user_id]?.full_name || userMap[p.user_id]?.email || 'Learner'}</span>
              <span className="text-muted-foreground shrink-0">{p.percentage || 0}%</span>
            </div>
            <div className="text-xs text-muted-foreground truncate mb-1">{courseMap[p.course_id]?.title || 'Course'}</div>
            <Progress value={p.percentage || 0} className="h-1.5" />
          </li>
        ))}
      </ul>
    </div>
  );
}
