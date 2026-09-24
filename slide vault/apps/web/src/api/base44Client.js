import { localClient } from './localClient';
import { apiClient, isApiMode } from './apiClient';

/**
 * Resolves the backend the app talks to.
 *
 * - With VITE_API_BASE_URL set, the SlidesVault API server in `server/` is used:
 *   the enterprise Dropbox integration layer, with its own session auth, the
 *   synced catalog, and all Dropbox traffic proxied through the backend. This
 *   takes precedence, because a deployment that runs the API server means it.
 * - Otherwise, with VITE_BASE44_APP_ID set, the @base44/sdk client is used, so
 *   the app reads the live catalog from the deployed Base44 app and calls the
 *   serverless functions in base44/functions/.
 * - With neither, a local backend (localStorage + a seeded demo catalog) is
 *   used so the app still runs end to end on a laptop with no cloud account.
 *
 * Each backend's API is normalised into the single shape the rest of the app
 * consumes, so no page or hook knows which one is in play.
 */
const APP_ID = import.meta.env.VITE_BASE44_APP_ID;
const SERVER_URL = import.meta.env.VITE_BASE44_SERVER_URL || 'https://base44.app';

export const isLocalMode = !isApiMode && !APP_ID;
export { isApiMode };

/** 'api' | 'base44' | 'local' — for the few places that must adapt. */
export const backendMode = isApiMode ? 'api' : APP_ID ? 'base44' : 'local';

let clientPromise = null;

/** Wraps the SDK client so it matches the local backend's interface exactly. */
function adaptRemoteClient(sdk) {
  const functions = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        // The SDK invokes backend functions by name: functions.invoke(name, data).
        return (payload = {}) => sdk.functions.invoke(name, payload);
      },
    }
  );

  const auth = {
    me: () => sdk.auth.me(),
    isAuthenticated: () => sdk.auth.isAuthenticated(),

    async login({ email, password }) {
      const result = await sdk.auth.loginViaEmailPassword(email, password);
      return result?.user ?? sdk.auth.me();
    },

    // Base44 hosts the identity provider, so both methods are always offered.
    capabilities: async () => ({ password: true, google: true }),

    loginWithGoogle(nextUrl) {
      // Base44 sends the browser back to this URL with ?access_token=..., which
      // createClient() picks up on the next load. Returning to the app root
      // rather than /login avoids an extra bounce through the guarded route.
      return sdk.auth.loginWithProvider('google', nextUrl || `${window.location.origin}/`);
    },

    register: ({ email, password, full_name }) =>
      sdk.auth.register({ email, password, full_name }),

    sendOtp: ({ email }) => sdk.auth.resendOtp(email),

    async verifyOtp({ email, otp }) {
      const result = await sdk.auth.verifyOtp({ email, otpCode: otp });
      return result?.user ?? sdk.auth.me();
    },

    resetPasswordRequest: ({ email }) => sdk.auth.resetPasswordRequest(email),

    resetPassword: ({ token, password }) =>
      sdk.auth.resetPassword({ resetToken: token, newPassword: password }),

    updateMyUserData: (data) => sdk.auth.updateMe(data),

    // Logout is a full-page round trip through Base44 so the HTTP-only cookies
    // are cleared too; it comes back to the app's own sign-in screen.
    logout: (redirectUrl) => sdk.auth.logout(redirectUrl || `${window.location.origin}/login`),

    /** Hands off to Base44's hosted sign-in (covers SSO, magic links, invites). */
    redirectToLogin: (nextUrl) => sdk.auth.redirectToLogin(nextUrl || `${window.location.origin}/`),
  };

  return {
    mode: 'base44',
    appId: APP_ID,
    entities: sdk.entities,
    integrations: sdk.integrations,
    functions,
    auth,
    sdk,
  };
}

async function createRemoteClient() {
  const { createClient } = await import('@base44/sdk');
  const sdk = createClient({
    appId: APP_ID,
    serverUrl: SERVER_URL,
    // The SDK builds its auth URLs as `${appBaseUrl}/api/apps/auth/...` and
    // defaults appBaseUrl to "". Left unset, every auth redirect (provider
    // login, hosted login, logout) resolves against this origin instead of
    // Base44 and lands on the app's own 404.
    appBaseUrl: SERVER_URL,
    // The app renders its own /login screen, so the SDK must not hijack the
    // first unauthenticated request with a redirect.
    requiresAuth: false,
  });
  return adaptRemoteClient(sdk);
}

export async function getClient() {
  if (isApiMode) return apiClient;
  if (isLocalMode) return localClient;
  if (!clientPromise) {
    clientPromise = createRemoteClient().catch((err) => {
      // A broken SDK must not take the whole app down — fall back loudly.
      console.error('[SlidesVault] Base44 SDK unavailable, falling back to the local backend.', err);
      return localClient;
    });
  }
  return clientPromise;
}

export function getClientSync() {
  return isApiMode ? apiClient : localClient;
}
