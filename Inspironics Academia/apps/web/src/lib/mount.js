// Where this app is mounted: '/' standalone, '/academia/' under the Apex gateway. Vite derives
// BASE_URL from `base`, and the router basename is set from it, so links made with <Link>/navigate()
// need nothing. This is for the places the router never sees: full-page navigations, absolute URLs
// handed to someone else, and the /api/... paths the server stores for lesson media.

export const APP_BASE = import.meta.env.BASE_URL || '/';

// Under Apex, the app is not at the site root — and the sign-in is Apex's, not this app's.
export const APEX_MOUNT = APP_BASE !== '/' ? APP_BASE : null;

// A path inside this app, for window.location: appPath('login') → '/academia/login' under Apex.
export const appPath = (path = '') => `${APP_BASE}${String(path).replace(/^\/+/, '')}`;

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/').replace(/\/$/, '');

// The server stores media as '/api/media/<key>'. Dropped straight into <video src> that misses the API
// whenever it is mounted below the origin (/academia/api under Apex), so give it the same prefix every
// fetch gets. Anything else — a full URL, a blob:, a demo asset — passes through untouched.
export const apiUrl = (url) => (typeof url === 'string' && url.startsWith('/api/') ? `${API_BASE}${url}` : url);
