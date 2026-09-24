/**
 * /api/dropbox — connection management, sync control, and the content proxy.
 *
 * The browser never talks to Dropbox. Connecting is a redirect round trip
 * through this API; file bytes are fetched here under the server's own
 * authorization and streamed back. No Dropbox URL, access token or share link
 * is ever sent to a client.
 */
import { Readable } from 'node:stream'
import express from 'express'
import { FILE_TYPES, isSupported } from '@inspironics/shared'
import { normaliseDropboxPath } from '../config.js'
import { HttpError, badRequest, notFound, route } from '../lib/http.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { DropboxApiError } from '../dropbox/client.js'
import { SETTINGS_ROOT_KEY, THUMB_SIZE } from '../sync/pipeline.js'

const PREVIEW_SIZE = 'w2048h1536'

export function dropboxRoutes({ config, repos, dropbox, dropboxAuth, sync, scheduler, store, log, metrics }) {
  const r = express.Router()
  const back = (qs) => `${config.webOrigin}/admin?${qs}`

  /* ------------------------------------------------------ connection -- */

  r.get(
    '/status',
    requireAuth,
    route(async (req, res) => {
      const conn = await dropboxAuth.getConnection({ fresh: true })
      const admin = req.user.role === 'admin'
      res.json({
        configured: dropboxAuth.configured(),
        connected: !!conn,
        status: conn?.status || 'disconnected',
        rootPath: (await sync.rootPath()) || '/',
        appFolder: await dropboxAuth.isAppFolder(),
        lastSync: await repos.syncLog.latest(),
        running: sync.progress(),
        nextRunAt: config.sync.enabled ? scheduler.nextRunAt() : null,
        ...(admin && {
          account: conn && {
            email: conn.email,
            displayName: conn.displayName,
            accountId: conn.accountId,
            isTeam: conn.isTeam,
            homePath: await repos.settings.get('dropbox.homePath', null),
            connectedAt: conn.connectedAt,
            lastError: conn.lastError,
          },
          library: await repos.files.counts(),
          lastTokenRefreshAt: dropboxAuth.lastRefreshAt(),
          redirectUri: config.dropbox.redirectUri,
          intervalMinutes: config.sync.intervalMinutes,
          ai: { enabled: config.ai.enabled, model: config.ai.enabled ? config.ai.model : null },
        }),
      })
    })
  )

  /** Browser navigates here (top-level GET, so the Lax cookie is sent) and is redirected to Dropbox. */
  r.get(
    '/oauth/start',
    requireAdmin,
    route(async (req, res) => {
      const state = await repos.oauthStates.create(req.user.id)
      res.redirect(dropboxAuth.authorizeUrl(state))
    })
  )

  /** Dropbox redirects back here. Must match the App Console redirect URI exactly. */
  r.get(
    '/oauth/callback',
    route(async (req, res) => {
      if (!req.user || req.user.role !== 'admin') return res.redirect(back('dropbox=forbidden'))
      if (req.query.error) {
        log.info('Dropbox authorization declined', { error: req.query.error })
        return res.redirect(back(`dropbox=denied`))
      }
      if (!(await repos.oauthStates.consume(String(req.query.state || ''), req.user.id))) {
        return res.redirect(back('dropbox=bad_state'))
      }
      try {
        const conn = await dropboxAuth.completeAuthorization(String(req.query.code || ''), req.user.id, (token) => dropbox.describeAccount(token))
        // one cheap call now, so an App Folder app is recognised before anyone browses
        await dropbox.rpc('files/list_folder', { path: '', limit: 1 }).catch(() => {})
        log.info('Dropbox connected', { account: conn.email, team: conn.isTeam, appFolder: await dropboxAuth.isAppFolder() })
        metrics.inc('dropbox_connections_total')
        res.redirect(back('dropbox=connected'))
      } catch (error) {
        log.warn('Dropbox authorization failed', { error: error.message })
        res.redirect(back(`dropbox=error&message=${encodeURIComponent(error.message)}`))
      }
    })
  )

  r.post(
    '/disconnect',
    requireAdmin,
    route(async (req, res) => {
      try {
        await dropbox.revokeToken(await dropboxAuth.getAccessToken())
      } catch {
        /* already broken: forget it anyway */
      }
      await dropboxAuth.forget()
      log.info('Dropbox disconnected', { by: req.user.id })
      res.json({ ok: true })
    })
  )

  /** Folder picker for the sync root. */
  r.get(
    '/folders',
    requireAdmin,
    route(async (req, res) => {
      const path = normaliseDropboxPath(String(req.query.path || ''))
      try {
        const entries = []
        let page = await dropbox.rpc('files/list_folder', { path, recursive: false, limit: 2000 })
        entries.push(...page.entries)
        // a folder listing is one level, so a few pages at most
        for (let i = 0; page.has_more && i < 5; i++) {
          page = await dropbox.rpc('files/list_folder/continue', { cursor: page.cursor })
          entries.push(...page.entries)
        }
        res.json({
          path: path || '/',
          folders: entries
            .filter((e) => e['.tag'] === 'folder')
            .map((e) => ({ name: e.name, path: e.path_display }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
          files: entries.filter((e) => e['.tag'] === 'file' && isSupported(e.name)).length,
        })
      } catch (error) {
        if (error instanceof DropboxApiError && error.is('path/not_found')) throw notFound('That folder does not exist.')
        throw error
      }
    })
  )

  r.put(
    '/settings',
    requireAdmin,
    route(async (req, res) => {
      const raw = req.body?.rootPath
      if (typeof raw !== 'string' || raw.length > 1000) throw badRequest('rootPath must be a string.')
      const path = normaliseDropboxPath(raw)
      if (path) {
        try {
          const meta = await dropbox.rpc('files/get_metadata', { path })
          if (meta['.tag'] !== 'folder') throw badRequest('That path is a file, not a folder.')
        } catch (error) {
          if (error instanceof DropboxApiError && error.is('path/not_found')) throw badRequest(`"${path}" does not exist in Dropbox.`)
          throw error
        }
      }
      await repos.settings.set(SETTINGS_ROOT_KEY, path, req.user.id)
      log.info('Sync folder changed', { path: path || '/', by: req.user.id })
      res.json({ rootPath: path || '/' })
    })
  )

  /* ------------------------------------------------------------ sync -- */

  r.post(
    '/sync',
    requireAdmin,
    route(async (req, res) => {
      const { id } = await sync.start({ trigger: 'manual', triggeredBy: req.user.id })
      res.status(202).json({ id, running: sync.progress() })
    })
  )

  r.get(
    '/sync',
    requireAuth,
    route(async (req, res) => {
      res.json({ running: sync.progress(), latest: await repos.syncLog.latest() })
    })
  )

  /* --------------------------------------------------- content proxy -- */

  async function activeFile(req) {
    const row = await repos.files.get(req.params.id)
    if (!row) throw notFound('No such file.')
    // archived files are gone from the library; only admins may still open them
    if (row.status !== 'active' && req.user.role !== 'admin') throw notFound('No such file.')
    return row
  }

  /** Browser caching: the URL carries ?v=<rev>, so a matching one is immutable. */
  function cacheHeaders(req, res, row, kind) {
    const etag = `"${row.rev}-${kind}"`
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', req.query.v === row.rev ? 'private, max-age=31536000, immutable' : 'private, max-age=300')
    return req.headers['if-none-match'] === etag
  }

  /** Cached derivative, fetching and storing it on a miss. */
  async function derivative(row, kind, fetcher, contentType) {
    const hit = await store.get(row.external_id, row.rev, kind)
    if (hit) {
      metrics.inc('object_cache_total', { kind, result: 'hit' })
      return hit
    }
    metrics.inc('object_cache_total', { kind, result: 'miss' })
    const data = await fetcher()
    await store.put(row.external_id, row.rev, kind, data, contentType)
    return { data, contentType }
  }

  r.get(
    '/files/:id/thumbnail',
    requireAuth,
    route(async (req, res) => {
      const row = await activeFile(req)
      if (cacheHeaders(req, res, row, 'thumb')) return res.status(304).end()
      try {
        const obj = await derivative(row, 'thumb', () => dropbox.thumbnail(row.external_id, THUMB_SIZE), 'image/jpeg')
        res.type(obj.contentType).send(obj.data)
      } catch (error) {
        if (!(error instanceof DropboxApiError && error.status === 409)) throw error
        // no renderable thumbnail (some PDFs, most decks): a labelled placeholder
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.type('image/svg+xml').send(placeholderSvg(row.ext, row.title))
      }
    })
  )

  r.get(
    '/files/:id/preview',
    requireAuth,
    route(async (req, res) => {
      const row = await activeFile(req)
      if (row.kind === 'image') {
        if (cacheHeaders(req, res, row, 'preview')) return res.status(304).end()
        const obj = await derivative(row, 'preview', () => dropbox.thumbnail(row.external_id, PREVIEW_SIZE), 'image/jpeg')
        return res.type(obj.contentType).send(obj.data)
      }
      if (row.ext === 'pptx') {
        if (cacheHeaders(req, res, row, 'preview')) return res.status(304).end()
        // Dropbox renders Office documents to PDF server-side
        const obj = await derivative(row, 'preview', () => dropbox.preview(row.external_id), 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.name.replace(/\.pptx$/i, '.pdf'))}`)
        return res.type(obj.contentType).send(obj.data)
      }
      return streamOriginal(req, res, row, { download: false })
    })
  )

  r.get(
    '/files/:id/content',
    requireAuth,
    route(async (req, res) => {
      const row = await activeFile(req)
      const download = req.query.download === '1'
      if (download) await repos.events.record(row.id, req.user.id, 'download').catch(() => {})
      return streamOriginal(req, res, row, { download })
    })
  )

  async function streamOriginal(req, res, row, { download }) {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    const range = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined
    let upstream
    try {
      upstream = await dropbox.downloadFile(row.external_id, { range, signal: controller.signal })
    } catch (error) {
      if (error instanceof DropboxApiError && error.status === 409) throw new HttpError(404, 'That file is no longer in Dropbox.')
      if (error instanceof DropboxApiError && error.status === 416) return res.status(416).end()
      throw error
    }
    const type = FILE_TYPES[row.ext]?.mime || 'application/octet-stream'
    res.status(upstream.status === 206 ? 206 : 200)
    res.setHeader('Content-Type', type)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'private, max-age=300')
    for (const h of ['content-length', 'content-range']) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
    // user-supplied HTML is served from our origin: sandbox it so its scripts
    // run with no access to the session, the API, or the parent page
    if (row.ext === 'html') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'")
    // PDFs get no default-src: some browsers' built-in viewers break under it
    else res.setHeader('Content-Security-Policy', row.ext === 'pdf' ? "frame-ancestors 'self'" : "default-src 'none'; frame-ancestors 'self'")
    const body = Readable.fromWeb(upstream.body)
    body.on('error', (error) => {
      if (!controller.signal.aborted) log.warn('Content stream failed', { id: row.id, error: error.message })
      res.destroy()
    })
    body.pipe(res)
  }

  return r
}

/** A dark, labelled tile for files Dropbox cannot render a thumbnail for. */
export function placeholderSvg(ext, title) {
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const words = esc(title).split(/\s+/)
  const lines = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last && (last + ' ' + w).length <= 22) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
    if (lines.length > 4) break
  }
  const text = lines
    .slice(0, 4)
    .map((l, i) => `<text x="40" y="${250 + i * 34}" font-size="26" fill="#e2e8f0">${l}</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480" font-family="system-ui,sans-serif"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111c33"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><rect x="40" y="60" rx="10" width="110" height="46" fill="#22d3ee" fill-opacity=".14" stroke="#22d3ee" stroke-opacity=".5"/><text x="95" y="91" text-anchor="middle" font-size="22" font-weight="700" fill="#67e8f9">${esc(String(ext).toUpperCase())}</text>${text}</svg>`
}
