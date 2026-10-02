import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TestPageHeader({ courseId, courseTitle, kicker, title }) {
  return (
    <div className="mb-6">
      {courseId && (
        <Link to={`/courses/${courseId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-4 h-4" /> {courseTitle || 'Back to course'}
        </Link>
      )}
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{kicker}</p>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">{title}</h1>
    </div>
  );
}
