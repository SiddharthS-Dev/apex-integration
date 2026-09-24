/**
 * Builds the Express app from already-constructed services. No I/O at import
 * time and no globals, so tests can build one against an in-memory database
 * and a fake Dropbox.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import { HttpError } from './lib/http.js'
import { requestMetrics } from './lib/metrics.js'
import { loadSession } from './middleware/auth.js'
import { cors, originGuard, rateLimit, securityHeaders } from './middleware/security.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { dropboxRoutes } from './routes/dropbox.js'
import { entityRoutes } from './routes/entities.js'

export function createApp(deps) {
  const { config, repos, log, metrics } = deps
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  app.set('etag', false)

  app.use(securityHeaders(config))
  app.use(requestMetrics({ metrics, log }))
  app.use(cors(config))
  app.use(express.json({ limit: '256kb' }))
  app.use(cookieParser())
  app.use('/api', originGuard(config))
  app.use('/api', rateLimit({ windowMs: 60_000, max: config.isProd ? 1200 : 20_000, bucket: 'api', metrics }))
  app.use('/api', loadSession({ config, repos }))

  app.get('/api/health', async (req, res) => {
    let db = 'ok'
    try {
      await repos.db.get('SELECT 1 AS ok')
    } catch {
      db = 'down'
    }
    res.status(db === 'ok' ? 200 : 503).json({ ok: db === 'ok', db, time: new Date().toISOString() })
  })

  app.use('/api/auth', authRoutes(deps))
  app.use('/api/dropbox', dropboxRoutes(deps))
  app.use('/api/entities', entityRoutes(deps))
  app.use('/api/admin', adminRoutes(deps))

  app.use('/api', (req, res, next) => next(new HttpError(404, `No route for ${req.method} ${req.path}.`)))

  // one origin in production: the built web app, with SPA fallback
  if (config.serveWeb && existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders(res, file) {
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
        },
      })
    )
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(config.webDist, 'index.html'))
    })
    log.info('Serving the web app', { dir: config.webDist })
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed') error = new HttpError(400, 'Request body is not valid JSON.')
    if (error?.type === 'entity.too.large') error = new HttpError(413, 'Request body is too large.')
    if (error?.name === 'DropboxApiError') error = new HttpError(502, `Dropbox refused the request: ${error.summary || error.message}`, 'DROPBOX_UPSTREAM')
    const status = error instanceof HttpError ? error.status : 500
    if (status >= 500) log.error('Unhandled error', { error, path: req.path })
    if (res.headersSent) return res.destroy()
    res.status(status).json({
      error: {
        code: error instanceof HttpError ? error.code : 'INTERNAL',
        message: status >= 500 && !(error instanceof HttpError) ? 'Something went wrong on the server.' : error.message,
      },
    })
  })

  return app
}
