import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import useAppConfig from '@/lib/useAppConfig';

// Slim notice at the top of the studio when the server runs without AI.
export default function AiDisabledNotice() {
  const { ai_enabled: ai, loaded } = useAppConfig();
  if (ai || !loaded) return null;
  return (
    <Alert className="mb-4 py-2">
      <Info className="w-4 h-4 !top-2.5" />
      <AlertDescription className="text-xs sm:text-sm">
        AI generation is off on this server (AI_ENABLED=false). You can still review, edit, approve and publish content.
      </AlertDescription>
    </Alert>
  );
}
