/**
 * A fake Dropbox (as a `fetch` implementation) and a harness that builds the
 * whole API against it with an in-memory SQLite database.
 *
 * The fake speaks just enough of the real wire format — OAuth token endpoint,
 * list_folder with cursors, get_thumbnail_v2, get_preview, download with
 * Range, the path-root check — that the production code paths run unchanged.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createSqliteDb } from '../src/db/sqlite.js'
import { hashPassword } from '../src/lib/crypto.js'
import { silentLogger } from '../src/lib/log.js'
import { createServices } from '../src/services.js'

/** Smallest JPEG header imageSize() can read: SOI + SOF0 with the given size. */
export function fakeJpeg(width, height) {
  const b = Buffer.alloc(20)
  b.writeUInt16BE(0xffd8, 0)
  b.writeUInt16BE(0xffc0, 2)
  b.writeUInt16BE(17, 4)
  b[6] = 8
  b.writeUInt16BE(height, 7)
  b.writeUInt16BE(width, 9)
  return b
}

export async function fakePptx({ title, slides }) {
  const zip = new JSZip()
  zip.file('docProps/core.xml', `<?xml version="1.0"?><cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>`)
  slides.forEach((text, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`)
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/** @param {{ thumbnail?: (file: { name: string, bytes: Buffer }) => Buffer }} [opts] */
export function createFakeDropbox({ thumbnail = () => fakeJpeg(640, 480) } = {}) {
  const state = {
    /** path_lower -> { id, name, path_display, rev, bytes, thumbable } */
    files: new Map(),
    rootNamespaceId: 'ns-root-1',
    homeNamespaceId: 'ns-home-1',
    calls: [],
    tokenCalls: 0,
    thumbnailCalls: 0,
    tokenCounter: 0,
    validTokens: new Set(),
    listPageSize: 2,
    failDiscovery: false,
  }
  let idSeq = 0

  const put = (pathDisplay, bytes, { thumbable = true } = {}) => {
    const key = pathDisplay.toLowerCase()
    const prev = state.files.get(key)
    state.files.set(key, {
      id: prev?.id || `id:${++idSeq}`,
      name: pathDisplay.split('/').pop(),
      path_display: pathDisplay,
      rev: `rev${Math.random().toString(16).slice(2, 10)}`,
      bytes: Buffer.from(bytes),
      thumbable,
    })
  }
  const remove = (pathDisplay) => state.files.delete(pathDisplay.toLowerCase())
  const byId = (id) => [...state.files.values()].find((f) => f.id === id)

  const mint = () => {
    const t = `at-${++state.tokenCounter}`
    state.validTokens.add(t)
    return t
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url)
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    state.calls.push({ path: u.pathname, headers })

    if (u.pathname === '/oauth2/token') {
      state.tokenCalls++
      await new Promise((r) => setTimeout(r, 20))
      const p = new URLSearchParams(String(init.body))
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== 'good-code') return json(400, { error: 'invalid_grant', error_description: 'code doesn’t exist or has expired' })
        return json(200, { access_token: mint(), refresh_token: 'rt-secret-1', expires_in: 14400, account_id: 'dbid:1' })
      }
      if (p.get('refresh_token') !== 'rt-secret-1') return json(400, { error: 'invalid_grant' })
      return json(200, { access_token: mint(), expires_in: 14400 })
    }

    const token = (headers.authorization || '').replace('Bearer ', '')
    if (!state.validTokens.has(token)) return json(401, { error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } })

    if (u.pathname === '/2/users/get_current_account') {
      return json(200, {
        account_id: 'dbid:1',
        email: 'owner@inspironics.test',
        name: { display_name: 'Owner' },
        root_info: { '.tag': 'team', root_namespace_id: state.rootNamespaceId, home_namespace_id: state.homeNamespaceId },
      })
    }
    if (u.pathname === '/2/auth/token/revoke') {
      state.validTokens.delete(token)
      return new Response(null, { status: 200 })
    }

    // the path-root check: a stale namespace gets 422 with the current one
    const root = headers['dropbox-api-path-root'] && JSON.parse(headers['dropbox-api-path-root'])
    // what live Dropbox sends an App Folder app: a plain-text 400
    if (root && state.refuseRoot) return new Response('Error in call to API function "files/list_folder": path root is not supported for sandbox app', { status: 400 })
    if (root && root.root !== state.rootNamespaceId) {
      return json(422, {
        error_summary: 'invalid_root/',
        error: { '.tag': 'invalid_root', invalid_root: { '.tag': 'team', root_namespace_id: state.rootNamespaceId, home_namespace_id: state.homeNamespaceId } },
      })
    }

    if (u.pathname === '/2/files/list_folder' || u.pathname === '/2/files/list_folder/continue') {
      const body = JSON.parse(init.body)
      if (state.failDiscovery) return json(503, { error_summary: 'too_busy' }, { 'Retry-After': '0' })
      let start = 0
      let prefix
      if (body.cursor) [prefix, start] = [JSON.parse(body.cursor).prefix, JSON.parse(body.cursor).start]
      else prefix = body.path.toLowerCase()
      if (prefix && ![...state.files.keys()].some((k) => k.startsWith(prefix + '/'))) {
        return json(409, { error_summary: 'path/not_found/..', error: { '.tag': 'path', path: { '.tag': 'not_found' } } })
      }
      const all = [...state.files.entries()].filter(([k]) => !prefix || k.startsWith(prefix + '/'))
      const page = all.slice(start, start + state.listPageSize)
      const more = start + state.listPageSize < all.length
      return json(200, {
        entries: page.map(([k, f]) => ({
          '.tag': 'file',
          id: f.id,
          name: f.name,
          path_lower: k,
          path_display: f.path_display,
          rev: f.rev,
          size: f.bytes.length,
          server_modified: '2026-09-01T10:00:00Z',
          content_hash: 'h',
        })),
        cursor: JSON.stringify({ prefix, start: start + state.listPageSize }),
        has_more: more,
      })
    }

    if (u.pathname === '/2/files/get_metadata') {
      const p = JSON.parse(init.body).path.toLowerCase()
      if ([...state.files.keys()].some((k) => k.startsWith(p + '/'))) return json(200, { '.tag': 'folder', path_display: p })
      return json(409, { error_summary: 'path/not_found/' })
    }

    const arg = headers['dropbox-api-arg'] && JSON.parse(headers['dropbox-api-arg'])
    if (u.pathname === '/2/files/get_thumbnail_v2') {
      state.thumbnailCalls++
      const f = byId(arg.resource.path)
      if (!f) return json(409, { error_summary: 'path/not_found/' })
      if (!f.thumbable) return json(409, { error_summary: 'unsupported_image/' })
      return new Response(thumbnail(f), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    }
    if (u.pathname === '/2/files/get_preview') {
      return new Response(Buffer.from('%PDF-1.4 preview'), { status: 200 })
    }
    if (u.pathname === '/2/files/download') {
      const f = byId(arg.path)
      if (!f) return json(409, { error_summary: 'path/not_found/' })
      const range = /bytes=(\d+)-(\d*)/.exec(headers.range || '')
      if (range) {
        const s = Number(range[1])
        const e = range[2] ? Number(range[2]) : f.bytes.length - 1
        const slice = f.bytes.subarray(s, e + 1)
        return new Response(slice, {
          status: 206,
          headers: { 'Content-Range': `bytes ${s}-${e}/${f.bytes.length}`, 'Content-Length': String(slice.length) },
        })
      }
      return new Response(f.bytes, { status: 200, headers: { 'Content-Length': String(f.bytes.length) } })
    }
    return json(404, { error_summary: `unknown endpoint ${u.pathname}` })
  }

  return { state, put, remove, fetch: fetchImpl }
}

/** Build the API against the fake, listening on an ephemeral port. */
export async function createHarness({ env = {}, enricher, seeds, port = 0, fake, logger = silentLogger } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'insp-api-'))
  const config = loadConfig({
    NODE_ENV: 'test',
    DROPBOX_APP_KEY: 'app-key',
    DROPBOX_APP_SECRET: 'app-secret',
    ENCRYPTION_KEY: 'a'.repeat(64),
    OBJECT_STORE_DIR: path.join(dir, 'objects'),
    SEED_PATH: path.join(dir, 'no-seed.json'),
    DROPBOX_ROOT_PATH: '/Showcase',
    SYNC_CONCURRENCY: '3',
    ...env,
  })
  const dropbox = createFakeDropbox(fake)
  const services = await createServices(config, logger, {
    db: createSqliteDb(':memory:'),
    fetch: dropbox.fetch,
    scheduler: { stop() {}, nextRunAt: () => null },
    enricher: enricher || { enabled: false, enrich: async () => null },
    seeds: seeds || { size: 0, match: () => null },
  })
  const app = createApp(services)
  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  /** A cookie-carrying client. */
  const client = () => {
    let cookie = ''
    const call = async (method, p, body, headers = {}) => {
      const res = await fetch(base + p, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      return res
    }
    return {
      call,
      get: (p, h) => call('GET', p, undefined, h),
      post: (p, b, h) => call('POST', p, b, h),
      async json(method, p, body) {
        const res = await call(method, p, body)
        return { status: res.status, body: res.status === 204 ? null : await res.json() }
      },
    }
  }

  async function signIn(email, role = 'viewer') {
    const { repos } = services
    let user = await repos.users.findByEmail(email)
    if (!user) user = await repos.users.create({ email, name: email, passwordHash: await hashPassword('Passw0rd1'), role, verified: true })
    const c = client()
    const r = await c.json('POST', '/api/auth/login', { email, password: 'Passw0rd1' })
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`)
    return Object.assign(c, { user })
  }

  /** Connect Dropbox exactly as the OAuth callback does. */
  async function connectDropbox(adminId) {
    return services.dropboxAuth.completeAuthorization('good-code', adminId, (t) => services.dropbox.describeAccount(t))
  }

  async function syncAndWait(trigger = 'manual') {
    const { id, done } = await services.sync.start({ trigger })
    await done
    return (await services.repos.syncLog.list({ limit: 50 })).items.find((s) => s.id === id)
  }

  async function close() {
    await new Promise((r) => server.close(r))
    await services.db.close()
    rmSync(dir, { recursive: true, force: true })
  }

  return { config, services, dropbox, base, client, signIn, connectDropbox, syncAndWait, close }
}
