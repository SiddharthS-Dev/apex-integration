import { Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';

export default function StudioEmpty({ busy, onBuild, chapterCount = 0 }) {
  return (
    <EmptyState
      icon={Layers}
      title="No course yet"
      description={
        chapterCount
          ? `${chapterCount} chapters were extracted. Build the course structure to generate modules and lessons.`
          : 'This playbook has not been processed yet. Building the structure will extract chapters first.'
      }
      action={
        <Button size="sm" disabled={busy} onClick={onBuild}>
          {busy ? <Loader2 className="animate-spin" /> : <Layers />}
          Build course structure
        </Button>
      }
    />
  );
}
