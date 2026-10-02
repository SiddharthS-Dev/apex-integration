import { Link } from 'react-router-dom';
import { Award, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ChapterTestLink({ moduleId, passed }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5 mt-2">
      <div className="flex items-center gap-2 text-sm">
        {passed ? (
          <Award className="w-4 h-4 text-emerald-500" />
        ) : (
          <ClipboardCheck className="w-4 h-4 text-primary" />
        )}
        <span className="font-medium">Chapter test</span>
        {passed && (
          <span className="rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium">
            Passed
          </span>
        )}
      </div>
      <Button asChild size="sm" variant={passed ? 'outline' : 'default'}>
        <Link to={`/test/chapter/${moduleId}`}>{passed ? 'Retake' : 'Take test'}</Link>
      </Button>
    </div>
  );
}
