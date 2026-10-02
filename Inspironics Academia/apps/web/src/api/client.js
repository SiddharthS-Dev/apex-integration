import { createDriver } from 'virtual:academy-driver';

// One client interface, swappable backends. No page or hook knows which one is in play.
//   VITE_BACKEND=api   (default) → the Academy API server (same origin, /api)
//   VITE_BACKEND=demo           → bundled in-browser demo backend (no server needed)
// vite.config.js resolves `virtual:academy-driver` to the selected driver at build time, so a
// production build never ships the demo backend or its seed data.
export const api = createDriver();
export const backendKind = api.kind;
