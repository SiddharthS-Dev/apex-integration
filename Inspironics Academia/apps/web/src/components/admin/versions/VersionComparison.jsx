import { useMemo, useState } from 'react';
import MetadataComparison from '@/components/admin/versions/MetadataComparison';
import ChapterDiffList from '@/components/admin/versions/ChapterDiffList';
import TextDiff from '@/components/admin/versions/TextDiff';
import { compareChapters, parseSnapshot } from '@/components/admin/versions/compareChapters';

export default function VersionComparison({ oldVersion, newVersion }) {
  const { rows, errors } = useMemo(() => {
    const a = parseSnapshot(oldVersion?.chapters_snapshot);
    const b = parseSnapshot(newVersion?.chapters_snapshot);
    const errs = [
      a.error && `${oldVersion?.version_label}: ${a.error}`,
      b.error && `${newVersion?.version_label}: ${b.error}`,
    ].filter(Boolean);
    return { rows: compareChapters(a.chapters, b.chapters), errors: errs };
  }, [oldVersion, newVersion]);

  const [selectedKey, setSelectedKey] = useState(null);
  const selected = rows.find((r) => r.key === selectedKey) || rows.find((r) => r.status !== 'unchanged') || rows[0];
  const selectedTitle = (selected?.newChapter || selected?.oldChapter)?.title;
  const labels = { oldLabel: oldVersion?.version_label, newLabel: newVersion?.version_label };

  return (
    <div className="space-y-6">
      <MetadataComparison oldVersion={oldVersion} newVersion={newVersion} />
      <TextDiff title="Table of contents summary" oldText={oldVersion?.toc_summary} newText={newVersion?.toc_summary} {...labels} />
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <ChapterDiffList rows={rows} selectedKey={selected?.key} onSelect={setSelectedKey} errors={errors} />
        </div>
        <div className="lg:col-span-3 min-w-0">
          <TextDiff
            title={selectedTitle ? `Chapter summary — ${selectedTitle}` : 'Chapter summary'}
            oldText={selected?.oldChapter?.summary}
            newText={selected?.newChapter?.summary}
            {...labels}
          />
        </div>
      </div>
    </div>
  );
}
