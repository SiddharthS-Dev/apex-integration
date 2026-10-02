import { Map as MapIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import CoverageChapterRow from '@/components/admin/studio/CoverageChapterRow';
import matchChapter from '@/components/admin/studio/matchChapter';

export default function CoverageMap({ chapters = [], lessons = [], onSelectLesson }) {
  const rows = chapters.map((chapter) => ({
    chapter,
    lessons: lessons.filter((l) => matchChapter(l.source_chapter, chapter)),
  }));
  const covered = rows.filter((r) => r.lessons.length).length;
  const pct = chapters.length ? Math.round((covered / chapters.length) * 100) : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="font-semibold flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-primary" />
          Coverage map
        </h2>
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{pct}%</span> · {covered} / {chapters.length} chapters
        </span>
      </div>
      <Progress value={pct} className="h-1.5 mb-4" />
      {chapters.length ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {rows.map((r) => (
            <CoverageChapterRow key={r.chapter.id} chapter={r.chapter} lessons={r.lessons} onSelectLesson={onSelectLesson} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">No chapters extracted for this playbook.</p>
      )}
    </div>
  );
}
