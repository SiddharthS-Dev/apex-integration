/**
 * The Dropbox credential model.
 *
 *   Refresh token  long-lived; AES-256-GCM ciphertext in the database. This is
 *                  the connection.
 *   Access token   short-lived; minted on demand and held in this process's
 *                  memory only. Never written to the database, never returned
 *                  by an API, never logged.
 *
 * A leaked database row is therefore useless against Dropbox without the
 * encryption key as well.
 *
 * Concurrent refreshes collapse to one call: in-process through a single
 * flight, across instances through a DB lock, so eight sync workers and a
 * content request asking at once cost Dropbox one token call, not nine.
 */
import { decrypt, encrypt } from '../lib/crypto.js'
import { createSingleFlight, sleep } from '../lib/concurrency.js'
import { HttpError } from '../lib/http.js'

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const AAD = 'dropbox-refresh-token'
/** Refresh this long before Dropbox's stated expiry, so no request races it. */
const EARLY_MS = 5 * 60_000

export class DropboxReauthRequired extends HttpError {
  constructor(message = 'The Dropbox connection has expired or was revoked — an administrator needs to reconnect it.') {
    super(503, message, 'DROPBOX_REAUTH')
  }
}

export class DropboxNotConnected extends HttpError {
  constructor() {
    super(503, 'Dropbox is not connected yet — an administrator can connect it in Settings.', 'DROPBOX_NOT_CONNECTED')
  }
}

export function createDropboxAuth({ config, repos, key, log, metrics, fetchImpl = fetch }) {
  const flight = createSingleFlight()
  /** @type {{ token: string, expiresAt: number } | null} */
  let access = null
  /** @type {Awaited<ReturnType<typeof repos.dropbox.get>> | undefined} */
  let connection
  /** App Folder ("sandbox") apps cannot take a path-root header; learned once, then stored. */
  let appFolder
  /** When this process last minted an access token (for the console; never persisted). */
  let lastRefreshAt = null

  const configured = () => !!(config.dropbox.appKey && config.dropbox.appSecret)

  async function getConnection({ fresh = false } = {}) {
    if (connection === undefined || fresh) connection = (await repos.dropbox.get()) || null
    return connection
  }

  async function tokenCall(params) {
    metrics?.inc('dropbox_token_calls_total', { grant: params.grant_type })
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${config.dropbox.appKey}:${config.dropbox.appSecret}`).toString('base64'),
      },
      body: new URLSearchParams(params),
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  }

  async function refresh() {
    const conn = await getConnection({ fresh: true })
    if (!conn) throw new DropboxNotConnected()
    if (conn.status === 'reauth_required') throw new DropboxReauthRequired()

    // another instance may be mid-refresh; wait briefly for its lock rather than
    // double-refreshing, but never block forever on it
    let lock = null
    for (let i = 0; i < 10 && !lock; i++) {
      lock = await repos.db.tryLock('dropbox-token-refresh', 30_000)
      if (!lock) await sleep(300)
    }
    try {
      const refreshToken = decrypt(key, conn.refreshTokenEnc, AAD)
      const { ok, status, body } = await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken })
      if (!ok) {
        if (status === 400 || status === 401) {
          // invalid_grant: revoked in Dropbox, or the app's access was removed
          await repos.dropbox.setStatus('reauth_required', String(body.error_description || body.error || status))
          connection = undefined
          log.warn('Dropbox refresh token rejected; reconnect required', { status, error: body.error })
          throw new DropboxReauthRequired()
        }
        throw new HttpError(502, `Dropbox token refresh failed (${status}).`, 'DROPBOX_UPSTREAM')
      }
      access = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 14_400) * 1000 - EARLY_MS }
      lastRefreshAt = new Date().toISOString()
      log.debug('Minted Dropbox access token', { expiresInS: body.expires_in })
      return access.token
    } finally {
      await lock?.release()
    }
  }

  return {
    configured,
    getConnection,

    /** A live access token, refreshing if needed. */
    async getAccessToken() {
      if (access && access.expiresAt > Date.now()) return access.token
      return flight('refresh', refresh)
    },

    /** Drop the cached access token — after a 401 from Dropbox. */
    invalidate() {
      access = null
    },

    authorizeUrl(state) {
      if (!configured()) throw new HttpError(503, 'DROPBOX_APP_KEY and DROPBOX_APP_SECRET are not configured on the server.', 'DROPBOX_UNCONFIGURED')
      const u = new URL(AUTHORIZE_URL)
      u.search = new URLSearchParams({
        client_id: config.dropbox.appKey,
        response_type: 'code',
        // `offline` is what makes Dropbox return a refresh token
        token_access_type: 'offline',
        redirect_uri: config.dropbox.redirectUri,
        state,
      }).toString()
      return u.toString()
    },

    /** Exchange the callback code, look the account up, and store the connection. */
    async completeAuthorization(code, connectedBy, describeAccount) {
      const { ok, status, body } = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: config.dropbox.redirectUri })
      if (!ok) {
        const reason = body.error_description || body.error || `HTTP ${status}`
        throw new HttpError(400, `Dropbox rejected the authorization: ${reason}`, 'DROPBOX_OAUTH')
      }
      if (!body.refresh_token) throw new HttpError(400, 'Dropbox did not return a refresh token.', 'DROPBOX_OAUTH')

      const account = await describeAccount(body.access_token)
      // a new connection may be a different app (App Folder -> Full Dropbox): learn it afresh
      appFolder = false
      await repos.settings.set('dropbox.appFolder', false)
      await repos.settings.set('dropbox.homePath', account.root_info?.home_path || null)
      const rootNs = account.root_info?.root_namespace_id || null
      const homeNs = account.root_info?.home_namespace_id || null
      await repos.dropbox.save({
        accountId: account.account_id,
        email: account.email,
        displayName: account.name?.display_name || account.email,
        refreshTokenEnc: encrypt(key, body.refresh_token, AAD),
        rootNamespaceId: rootNs,
        homeNamespaceId: homeNs,
        isTeam: account.root_info?.['.tag'] === 'team' || (rootNs && homeNs && rootNs !== homeNs),
        connectedBy,
      })
      access = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 14_400) * 1000 - EARLY_MS }
      lastRefreshAt = new Date().toISOString()
      connection = undefined
      return getConnection()
    },

    /** Forget the connection locally. The caller revokes it at Dropbox first. */
    async forget() {
      access = null
      await repos.dropbox.remove()
      connection = null
    },

    lastRefreshAt: () => lastRefreshAt,

    async isAppFolder() {
      if (appFolder === undefined) appFolder = !!(await repos.settings.get('dropbox.appFolder', false))
      return appFolder
    },

    async markAppFolder() {
      appFolder = true
      await repos.settings.set('dropbox.appFolder', true)
    },

    /** Called when Dropbox reports the team root moved. */
    async setRootNamespace(id) {
      await repos.dropbox.setRootNamespace(id)
      connection = undefined
    },
  }
}
