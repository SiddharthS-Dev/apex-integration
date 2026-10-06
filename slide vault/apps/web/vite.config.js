import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve against this file, not process.cwd(): Apex and the monorepo both
// launch the dev server from a parent folder, and a cwd-relative alias would
// then point at the wrong directory.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// The Apex gateway mounts this app here (see ../../../apex/projects.mjs).
// BASE_URL is derived from it, and both the router basename and the
// public-asset URLs read that — so the mount point is defined in exactly one
// place.
const BASE = '/vault/';

/**
 * Writes precache-manifest.json: every file of this build, relative to BASE.
 * public/sw.js reads it to cache the whole app shell — including route chunks
 * never opened online — so the offline library loads with no network.
 */
function precacheManifest() {
  // Public files are copied, not bundled, so they are listed by hand.
  const publicFiles = ['logo.svg', 'manifest.webmanifest'];
  return {
    name: 'slidesvault-precache-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'));
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify([...new Set([...files, ...publicFiles])]),
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), precacheManifest()],
  resolve: {
    alias: { '@': path.resolve(rootDir, 'src') },
  },
  server: {
    // Apex owns 5173 and proxies to this port; nobody opens it directly.
    port: 5175,
    strictPort: true,
    open: false,
    // Pinned to IPv4 loopback on purpose. Left to itself vite binds ::1 only,
    // and the gateway's proxy — which dials 127.0.0.1 — gets ECONNREFUSED from
    // a server that is plainly "ready" in its own logs. Also keeps this port
    // off every other interface.
    host: '127.0.0.1',
    // The page is served from the gateway's origin, so the HMR socket has to
    // dial the gateway too — it forwards the upgrade back to this server.
    hmr: { clientPort: 5173 },
    /*
     * No /api proxy here. The gateway routes /vault/api to the API server
     * itself, in dev and prod alike, so the app, the API and the session cookie
     * all share the gateway's origin — which is what lets the SameSite=Lax
     * cookie reach the presentation <iframe>.
     */
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          pdf: ['jspdf'],
        },
      },
    },
  },
});
