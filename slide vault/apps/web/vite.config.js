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

export default defineConfig({
  base: BASE,
  plugins: [react()],
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
