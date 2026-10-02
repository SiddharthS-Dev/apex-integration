import { ClipboardList, Film, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DisabledReason from '@/components/DisabledReason';
import useAppConfig, { AI_DISABLED_REASON, MEDIA_DISABLED_REASON } from '@/lib/useAppConfig';

// AI-backed studio actions, gated on the server's feature flags.
export default function StudioGenerateButtons({ actions }) {
  const { ai_enabled: ai, media_enabled: media } = useAppConfig();
  const { busy } = actions;
  const aiReason = ai ? null : AI_DISABLED_REASON;
  return (
    <>
      <DisabledReason reason={aiReason}>
        <Button size="sm" variant="outline" disabled={busy || !ai} onClick={actions.generatePackage}><Sparkles />Generate Learning Package</Button>
      </DisabledReason>
      <DisabledReason reason={aiReason}>
        <Button size="sm" variant="outline" disabled={busy || !ai} onClick={actions.generateAllTests}><ClipboardList />Generate Tests</Button>
      </DisabledReason>
      <DisabledReason reason={media ? null : MEDIA_DISABLED_REASON}>
        <Button size="sm" variant="outline" disabled={busy || !media} onClick={actions.regenerateMedia}><Film />Regenerate Media</Button>
      </DisabledReason>
    </>
  );
}
