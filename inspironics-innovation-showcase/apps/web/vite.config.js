import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// The 235 infographics already live in ./inspironics/{thumbs,full}. Rather than
// duplicating ~48 MB into public/, serve that folder under the app's base at
// /images in dev and copy it into dist/images at build time.
const IMAGE_SRC = path.join(ROOT, 'inspironics')

// The Apex gateway mounts this app here (see ../../../apex/projects.mjs). Kept as
// a constant because both `base` and the image middleware below must agree: the
// browser asks for /showcase/images/..., not /images/....
const BASE = '/showcase/'

const MIME = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function inspironicsImages() {
  return {
    name: 'inspironics-images',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = `${BASE}images/`
        if (!req.url || !req.url.startsWith(prefix)) return next()
        const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
        const file = path.join(IMAGE_SRC, rel)
        if (!file.startsWith(IMAGE_SRC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return next()
        }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const out = path.join(ROOT, 'dist', 'images')
      for (const dir of ['thumbs', 'full']) {
        const from = path.join(IMAGE_SRC, dir)
        if (fs.existsSync(from)) fs.cpSync(from, path.join(out, dir), { recursive: true })
      }
    },
  }
}

export default defineConfig(() => {
  return {
    // Mounted by the Apex gateway at /showcase (see ../../../apex/projects.mjs).
    // Every asset URL and the router basename derive from this one value.
    base: BASE,
    plugins: [react(), inspironicsImages()],
    // Mirrors the `imports` map in package.json. Both exist on purpose: the
    // package.json form is what Node (and therefore the unit tests) resolves,
    // this is what Vite resolves, and they must not drift.
    resolve: {
      alias: {
        '#app': path.join(ROOT, 'src', 'app'),
        '#features': path.join(ROOT, 'src', 'features'),
        '#shared': path.join(ROOT, 'src', 'shared'),
      },
    },
    server: {
      // Apex owns 5173 and proxies to this port; nobody opens it directly.
      port: 5174,
      strictPort: true,
      open: false,
      // Pinned to IPv4 loopback on purpose. Left to itself vite binds ::1 only,
      // and the gateway's proxy — which dials 127.0.0.1 — gets ECONNREFUSED from
      // a server that is plainly "ready" in its own logs.
      host: '127.0.0.1',
      // The page is served from the gateway's origin, so the HMR socket has to
      // dial the gateway too — it forwards the upgrade back to this server.
      hmr: { clientPort: 5173 },
      // No /api proxy: the gateway routes /showcase/api to the API server itself,
      // in dev and prod alike, so the app, the API and the session cookie share
      // the gateway's origin.
    },
    build: {
      rollupOptions: {
        output: {
          /*
           * Only React and the router get a manual chunk, and deliberately so.
           *
           * They are in the entry graph already, so a stable vendor file they can
           * be cached from is a straight win. three.js and jsPDF are the opposite:
           * they are reachable only through lazy routes, and giving them manual
           * chunks made Rollup host Vite's dynamic-import preload helper inside
           * one of them. Every lazy route needs that helper, so the entry ended up
           * statically importing the jsPDF chunk and every visitor downloaded
           * 114 KB gzipped of PDF machinery to look at the login page. Left to
           * itself, Rollup puts them in the chunk of the route that needs them.
           */
          manualChunks(id) {
            const norm = id.split(path.sep).join('/')
            if (!norm.includes('/node_modules/')) return undefined
            if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(norm)) {
              return 'react'
            }
            return undefined
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },
  }
})
