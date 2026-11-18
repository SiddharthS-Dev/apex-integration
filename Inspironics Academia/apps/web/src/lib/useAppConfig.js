import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// Server feature flags (GET /api/config). Everything is off until the server says otherwise.
export const DEFAULT_CONFIG = Object.freeze({
  ai_enabled: false,
  ai_model: null,
  media_provider: 'none',
  media_enabled: false,
  video_render_enabled: false,
  dropbox_configured: false,
  registration_open: false,
  google_enabled: false,
  max_upload_mb: 50,
  email_enabled: false,
  email_provider: 'log',
  demo: false,
});

export const AI_DISABLED_REASON = 'AI is not available on the server';
export const MEDIA_DISABLED_REASON = 'Media generation is disabled (MEDIA_PROVIDER=none)';

export default function useAppConfig() {
  const { data, isFetched } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.system.config(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  // `loaded` lets callers avoid flashing "disabled" UI before the first response arrives.
  return { ...DEFAULT_CONFIG, ...(data || {}), loaded: isFetched };
}

export { useAppConfig };
