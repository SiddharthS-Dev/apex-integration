import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const REASONS = {
  access_denied: 'Access was not granted in Dropbox.',
  invalid_state: 'The connection request expired or was not started here. Try again.',
  exchange_failed: 'Dropbox did not accept the authorization. Check DROPBOX_REDIRECT_URI and the app credentials.',
  not_configured: 'Dropbox is not configured on the server.',
  not_admin: 'Only administrators can connect Dropbox.',
  missing_code: 'Dropbox returned no authorization code.',
};

// Reads ?dropbox=connected|error&reason=… left by the OAuth callback, toasts it, then clears it.
export default function useOAuthResultToast(onConnected) {
  const [params, setParams] = useSearchParams();
  const result = params.get('dropbox');
  useEffect(() => {
    if (!result) return;
    if (result === 'connected') {
      toast.success('Dropbox connected');
      onConnected?.();
    } else {
      const reason = params.get('reason');
      toast.error(`Dropbox connection failed. ${REASONS[reason] || reason || ''}`.trim());
    }
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}
