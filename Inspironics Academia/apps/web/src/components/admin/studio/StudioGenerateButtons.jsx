import { useState } from 'react';
import { ClipboardList, Film, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DisabledReason from '@/components/DisabledReason';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';
import useAppConfig, { AI_DISABLED_REASON, MEDIA_DISABLED_REASON } from '@/lib/useAppConfig';
import { useStudioConfig } from '@/lib/studio';

const TITLES = {
  package: ['Generate the learning package?', 'Generate'],
  media: ['Regenerate media for every lesson?', 'Regenerate media'],
  tests: ['Generate the tests?', 'Generate tests'],
};

// AI-backed studio actions, gated on the server's feature flags. Each bulk action first shows what it
// is about to spend (lessons, AI requests, voice-over characters) and runs only once confirmed.
export default function StudioGenerateButtons({ actions }) {
  const { ai_enabled: ai, ai_unavailable_reason: aiWhy, media_enabled: media } = useAppConfig();
  const { data: studio } = useStudioConfig();
  const [confirm, setConfirm] = useState(null);
  const { busy } = actions;
  const aiReason = ai ? null : (aiWhy || AI_DISABLED_REASON);
  const est = confirm ? actions.estimate(confirm, { autoAudio: !!studio?.auto_generate_audio }) : null;
  const run = { package: actions.generatePackage, media: actions.regenerateMedia, tests: actions.generateAllTests };

  return (
    <>
      <DisabledReason reason={aiReason}>
        <Button size="sm" variant="outline" disabled={busy || !ai} onClick={() => setConfirm('package')}><Sparkles />Generate Learning Package</Button>
      </DisabledReason>
      <DisabledReason reason={aiReason}>
        <Button size="sm" variant="outline" disabled={busy || !ai} onClick={() => setConfirm('tests')}><ClipboardList />Generate Tests</Button>
      </DisabledReason>
      <DisabledReason reason={media ? null : MEDIA_DISABLED_REASON}>
        <Button size="sm" variant="outline" disabled={busy || !media} onClick={() => setConfirm('media')}><Film />Regenerate Media</Button>
      </DisabledReason>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? TITLES[confirm][0] : ''}
        description={est ? `${est.lines.join(' · ')}. Paid requests count against the AI Studio limits; see AI Studio → Usage & budget for the estimated cost so far.` : ''}
        confirmLabel={confirm ? (est?.count ? TITLES[confirm][1] : 'Nothing to do') : ''}
        onConfirm={() => { const fn = run[confirm]; setConfirm(null); if (est?.count) fn?.(); }}
      />
    </>
  );
}
