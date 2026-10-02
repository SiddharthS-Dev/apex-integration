import { createClient } from '@base44/sdk';

// Same-origin requests: the @base44/vite-plugin proxies /api to VITE_BASE44_APP_BASE_URL in dev,
// and the hosted Base44 app serves /api directly in production.
export const base44 = createClient({
  appId: import.meta.env.VITE_BASE44_APP_ID,
  serverUrl: '',
  appBaseUrl: import.meta.env.VITE_BASE44_APP_BASE_URL,
  requiresAuth: false,
});
