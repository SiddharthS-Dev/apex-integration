import { useState } from 'react';
import { CheckCheck, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';
import StudioGenerateButtons from '@/components/admin/studio/StudioGenerateButtons';

export default function StudioActions({ actions }) {
  const [confirm, setConfirm] = useState(null);
  const { busy } = actions;
  const confirmations = {
    approve: { title: 'Approve all content?', description: 'All lessons, questions, flashcards and tests awaiting review will be approved.', label: 'Approve all', run: actions.approveEverything },
    publish: { title: 'Publish this course?', description: 'Everything awaiting review will be approved, tests published, and the course made visible to learners.', label: 'Publish', run: actions.publish },
  };
  const current = confirm && confirmations[confirm];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StudioGenerateButtons actions={actions} />
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm('approve')}><CheckCheck />Approve All</Button>
      <Button size="sm" disabled={busy} onClick={() => setConfirm('publish')}><Rocket />Publish</Button>
      <ConfirmDialog
        open={!!current}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={current?.title}
        description={current?.description}
        confirmLabel={current?.label}
        onConfirm={() => { const run = current?.run; setConfirm(null); run?.(); }}
      />
    </div>
  );
}
