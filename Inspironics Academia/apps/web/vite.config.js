import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// Resolves `virtual:academy-driver` to the backend chosen by VITE_BACKEND (api | demo).
function backendDriver(backend) {
  const id = 'virtual:academy-driver';
  const target = backend === 'demo'
    ? "export { createDemoDriver as createDriver } from '@/api/drivers/demo';"
    : "export { createHttpDriver as createDriver } from '@/api/drivers/http';";
  return {
    name: 'academy-backend-driver',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (resolved) => (resolved === `\0${id}` ? target : null),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');
  const backend = (env.VITE_BACKEND || 'api').toLowerCase();
  // Under the Apex gateway (see ../../../apex/projects.mjs) the app is mounted at /academia/ and its
  // dev server sits behind the gateway; apex/run.mjs sets these. Unset, it runs standalone at '/'.
  // BASE_URL follows `base`, and the router basename and every runtime path read that.
  const apexGateway = Number(env.APEX_GATEWAY_PORT) || 0;
  return {
    base: env.APEX_BASE || '/',
    plugins: [react(), backendDriver(backend)],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
    server: apexGateway
      ? {
          port: Number(env.APEX_DEV_PORT),
          strictPort: true,
          open: false,
          // IPv4 loopback: the gateway dials 127.0.0.1, and vite left alone binds ::1 only.
          host: '127.0.0.1',
          // The page comes from the gateway's origin, so HMR dials the gateway, which forwards it here.
          hmr: { clientPort: apexGateway },
          // No /api proxy: the gateway routes /academia/api to the API itself.
        }
      : {
          port: 5173,
          strictPort: true,
          // Same-origin API in dev: the browser only ever talks to :5173.
          proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } },
        },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
            charts: ['recharts'],
            pdf: ['jspdf', 'html2canvas'],
          },
        },
      },
    },
  };
});
