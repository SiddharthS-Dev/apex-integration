/**
 * Dropbox OAuth 2.0 — authorization code flow with refresh tokens.
 *
 * The credential model, which the rest of the integration depends on:
 *
 *   refresh token  long-lived, encrypted, in the database. The connection.
 *   access token   ephemeral, in process memory only, minted on demand.
 *
 * An access token is never written to the database, never returned by an API,
 * and never logged. A leaked database row therefore cannot be replayed against
 * Dropbox without also holding the encryption key.
 *
 * Concurrency (spec §7): when several requests find the cached token expired,
 * exactly one refresh call is made. In-process that is SingleFlight; across
 * instances it is the advisory lock, so three containers do not each burn a
 * refresh at the same moment.
 */
import { SingleFlight, withTimeout } from '../../util/async.js';
import { LOCKS } from '../../db/repositories/lockRepository.js';
import { ConnectionRepository } from '../../db/repositories/connectionRepository.js';
import { M } from '../../services/metrics/metrics.js';
import {
  DropboxAuthenticationError,
  DropboxConfigurationError,
  classifyNetworkError,
  classifyResponse,
} from './errors.js';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

/** Refresh this long before the stated expiry, so no in-flight request races it. */
const EXPIRY_SAFETY_MS = 120_000;

export class DropboxAuthService {
  #cachedToken = null; // { token, expiresAt } — memory only, by design
  #refreshFlight = new SingleFlight();

  /**
   * The account's root namespace id, cached beside the token.
   *
   * Cached rather than read per request because the executor needs it on every
   * single Dropbox call, and a database round trip per call would be a
   * meaningful regression. It is populated wherever the connection is already
   * being read — the OAuth exchange and the token refresh — so a cached token
   * always implies a known path root.
   */
  #pathRoot = null;

  constructor({ config, connections, oauthStates, locks, audit, metrics, logger, fetchImpl = fetch }) {
    this.config = config;
    this.connections = connections;
    this.oauthStates = oauthStates;
    this.locks = locks;
    this.audit = audit;
    this.metrics = metrics;
    this.logger = logger?.child?.({ component: 'DropboxAuthService' }) ?? logger;
    this.fetch = fetchImpl;
    this.provider = 'dropbox';
  }

  /** Throws unless the app credentials are present. */
  assertConfigured() {
    if (!this.config.dropbox.appKey || !this.config.dropbox.appSecret) {
      throw new DropboxConfigurationError(
        'DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set on the server.'
      );
    }
  }

  /* ------------------------------------------------------------- authorize */

  /**
   * Builds the Dropbox consent URL and issues the matching CSRF state.
   *
   * token_access_type=offline is what makes Dropbox return a refresh token —
   * without it the integration would be back to expiring access tokens.
   */
  async getAuthorizationUrl({ userId = '', redirectAfter = '', forceReapprove = false } = {}) {
    this.assertConfigured();

    const { state, expiresAt } = await this.oauthStates.issue({
      provider: this.provider,
      userId,
      redirectAfter,
      ttlMinutes: this.config.dropbox.oauthStateTtlMinutes,
    });

    const params = new URLSearchParams({
      client_id: this.config.dropbox.appKey,
      response_type: 'code',
      redirect_uri: this.config.dropbox.redirectUri,
      token_access_type: 'offline',
      state,
      force_reapprove: forceReapprove ? 'true' : 'false',
    });

    return {
      url: `${AUTHORIZE_URL}?${params.toString()}`,
      state,
      expiresAt,
      redirectUri: this.config.dropbox.redirectUri,
    };
  }

  /* -------------------------------------------------------------- exchange */

  /**
   * Exchanges an authorization code for a refresh token and stores it.
   *
   * Authorization codes are single-use at Dropbox, and browsers replay
   * callbacks (StrictMode double-mount, a refresh, a double-click). The code is
   * claimed first: whoever claims it performs the exchange, everyone else gets
   * the recorded result instead of a confusing "invalid code" error (§76).
   */
  async exchangeAuthorizationCode(code, { state, actor = null, ip = '' } = {}) {
    this.assertConfigured();
    if (!code) throw new DropboxAuthenticationError('No authorization code was supplied.');

    if (state !== undefined) {
      const verdict = await this.oauthStates.consume(state, this.provider);
      if (!verdict.ok) {
        // A replayed callback for a code we already exchanged is benign — the
        // state is used precisely because the first callback succeeded.
        const previous = await this.oauthStates.findCodeExchange(code);
        if (verdict.reason === 'already_used' && previous?.outcome === 'success') {
          return { ...previous.result, replayed: true };
        }
        await this.audit?.record({
          actorId: actor?.id,
          actorEmail: actor?.email,
          action: 'dropbox.oauth.state_rejected',
          outcome: 'failure',
          ip,
          details: { reason: verdict.reason },
        });
        throw new DropboxAuthenticationError(`OAuth state rejected: ${verdict.reason}`, {
          status: 400,
          userMessage:
            'This Dropbox authorization link is no longer valid. Start the connection again from ' +
            'Dropbox Settings.',
        });
      }
    }

    const claimed = await this.oauthStates.claimCode(code, this.provider);
    if (!claimed) {
      const previous = await this.oauthStates.findCodeExchange(code);
      if (previous?.outcome === 'success') return { ...previous.result, replayed: true };
      if (previous?.outcome === 'pending') {
        throw new DropboxAuthenticationError('This authorization code is already being exchanged.', {
          status: 409,
          userMessage: 'The Dropbox connection is already being completed. Give it a moment.',
        });
      }
      throw new DropboxAuthenticationError('This authorization code has already been used.', {
        status: 400,
        userMessage: 'That Dropbox authorization has already been used. Connect again to retry.',
      });
    }

    try {
      const token = await this.#postToken({
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.dropbox.redirectUri,
      });

      if (!token.refresh_token) {
        throw new DropboxAuthenticationError(
          'Dropbox returned no refresh token — the authorization request was not made with ' +
            'token_access_type=offline.'
        );
      }

      // Identify the account with the one-shot access token from the exchange.
      const account = await this.#fetchAccount(token.access_token);

      // root_info is where Dropbox says whether this member has a team space.
      // Captured here, at authorization time, because it is the only moment we
      // are guaranteed to be talking to the account that is being connected.
      const rootInfo = account.root_info ?? {};

      const timestamp = new Date().toISOString();
      await this.connections.update(this.provider, {
        refreshToken: token.refresh_token,
        account_id: account.account_id ?? token.account_id ?? '',
        account_name: account.name?.display_name ?? '',
        account_email: account.email ?? '',
        root_namespace_id: String(rootInfo.root_namespace_id ?? ''),
        home_namespace_id: String(rootInfo.home_namespace_id ?? ''),
        home_path: String(rootInfo.home_path ?? ''),
        connection_status: 'connected',
        last_connected_at: timestamp,
        last_token_refresh_at: timestamp,
        last_error: '',
      });

      this.#pathRoot = String(rootInfo.root_namespace_id ?? '') || null;

      // The access token from the exchange is good for hours — cache it rather
      // than immediately spending a refresh on the very next request.
      this.#cacheToken(token.access_token, token.expires_in);

      const connection = await this.connections.get(this.provider);
      const result = {
        connected: true,
        account_id: connection.account_id,
        account_name: connection.account_name,
        account_email: connection.account_email,
        root_folder: connection.root_folder,
        // Tells the admin UI that folder paths are now team-space-relative,
        // which is a visible change in what the folder browser shows.
        team_space: ConnectionRepository.isTeamSpace(connection),
      };

      await this.oauthStates.completeCode(code, 'success', result);
      await this.audit?.record({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'dropbox.connected',
        target: connection.account_email,
        ip,
        details: { account_id: connection.account_id },
      });
      this.metrics?.increment(M.authRefresh, { kind: 'authorization_code', outcome: 'success' });

      return result;
    } catch (error) {
      // Release the claim so a genuine retry (a network blip, not a used code)
      // is still possible; a code Dropbox rejected stays recorded as failed.
      const permanent = error?.status === 400 || error?.name === 'DropboxAuthenticationError';
      if (permanent) await this.oauthStates.completeCode(code, 'failed', { error: error.userMessage });
      else await this.oauthStates.releaseCode(code);

      await this.connections.update(this.provider, {
        connection_status: 'error',
        last_error: error.message?.slice(0, 500) ?? 'Authorization failed.',
      });
      this.metrics?.increment(M.authRefresh, { kind: 'authorization_code', outcome: 'error' });
      throw error;
    }
  }

  /* --------------------------------------------------------------- tokens */

  /**
   * A valid access token, minted only when the cached one is stale.
   *
   * @param {{force?: boolean}} [options] force skips the cache (401 recovery)
   */
  async getValidAccessToken({ force = false } = {}) {
    if (!force && this.#cachedToken && this.#cachedToken.expiresAt > Date.now()) {
      return this.#cachedToken.token;
    }
    if (force) this.#cachedToken = null;

    // Followers wait for the leader's result instead of refreshing themselves.
    return this.#refreshFlight.run(async () => {
      if (!force && this.#cachedToken && this.#cachedToken.expiresAt > Date.now()) {
        return this.#cachedToken.token;
      }
      return this.refreshAccessToken();
    });
  }

  /**
   * Trades the stored refresh token for a new access token.
   *
   * Guarded by a short advisory lock so that in a multi-instance deployment
   * one instance refreshes and the others fall back to their cache or retry,
   * rather than all hammering the token endpoint together.
   */
  async refreshAccessToken() {
    this.assertConfigured();

    const connection = await this.connections.get(this.provider);
    if (connection?.credentialError) {
      throw new DropboxAuthenticationError(connection.credentialError);
    }
    // The connection is in hand anyway; refresh the path-root cache from it so
    // a restarted process learns the namespace on its first Dropbox call.
    this.#pathRoot = connection?.root_namespace_id || null;
    if (!connection?.refreshToken) {
      throw new DropboxAuthenticationError('Dropbox is not connected — no refresh token is stored.', {
        status: 409,
        userMessage: 'Dropbox is not connected. An administrator needs to connect it first.',
      });
    }

    const start = process.hrtime.bigint();
    try {
      const token = await this.locks.withLock(
        LOCKS.TOKEN_REFRESH,
        30_000,
        () =>
          this.#postToken({
            grant_type: 'refresh_token',
            refresh_token: connection.refreshToken,
          }),
        // Lock busy: another instance is refreshing. Re-read this instance's
        // cache (it may have been filled meanwhile) before giving up.
        async () => {
          if (this.#cachedToken && this.#cachedToken.expiresAt > Date.now()) {
            return { access_token: this.#cachedToken.token, expires_in: 0, reusedCache: true };
          }
          return this.#postToken({
            grant_type: 'refresh_token',
            refresh_token: connection.refreshToken,
          });
        }
      );

      if (!token.reusedCache) this.#cacheToken(token.access_token, token.expires_in);

      await this.connections.update(this.provider, {
        last_token_refresh_at: new Date().toISOString(),
        connection_status: 'connected',
        last_error: '',
      });

      this.metrics?.increment(M.authRefresh, { kind: 'refresh_token', outcome: 'success' });
      this.metrics?.observe(M.oauthLatency, Number(process.hrtime.bigint() - start) / 1e9, {
        operation: 'refresh',
      });
      this.logger?.debug?.('Access token refreshed');

      return this.#cachedToken?.token ?? token.access_token;
    } catch (error) {
      this.metrics?.increment(M.authRefresh, { kind: 'refresh_token', outcome: 'error' });

      // A rejected refresh token means the authorization was revoked or the
      // app secret changed: the connection is dead until someone reconnects.
      if (error?.status === 400 || error?.name === 'DropboxAuthenticationError') {
        await this.connections.update(this.provider, {
          connection_status: 'error',
          last_error: 'The stored Dropbox authorization is no longer valid. Reconnect Dropbox.',
        });
        throw new DropboxAuthenticationError(`Dropbox refused the refresh token: ${error.message}`, {
          status: 409,
          userMessage:
            'The Dropbox authorization is no longer valid. An administrator needs to reconnect ' +
            'Dropbox in the admin settings.',
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Drops the cached token — the next call mints a fresh one. */
  invalidateAccessToken() {
    this.#cachedToken = null;
    // The path root is deliberately kept: it is account topology, not a
    // credential, and the refresh that follows re-reads it from the connection.
  }

  /**
   * The `Dropbox-API-Path-Root` header value, or null for an account with no
   * team space (and for a connection made before namespaces were recorded).
   *
   * The `root` variant rather than `namespace_id`: it makes Dropbox *verify*
   * that the id is still the account's root, and hand back the correct one if
   * it is not. `namespace_id` would point at a stale namespace silently, and a
   * team reorganization would quietly sync the wrong folder.
   */
  getPathRootHeader() {
    if (!this.#pathRoot) return null;
    return JSON.stringify({ '.tag': 'root', root: this.#pathRoot });
  }

  /**
   * Records a new root namespace after Dropbox reported the stored one stale.
   * Called by the executor, which then replays the request.
   */
  async updateRootNamespace(namespaceId) {
    const value = String(namespaceId ?? '');
    if (!value || value === this.#pathRoot) return false;

    this.#pathRoot = value;
    await this.connections.update(this.provider, { root_namespace_id: value });
    this.logger?.warn?.('The Dropbox team space root namespace changed; connection updated.', {
      namespaceId: value,
    });
    return true;
  }

  /** Diagnostics only. Never exposes the token itself. */
  tokenCacheState() {
    if (!this.#cachedToken) return { cached: false };
    return {
      cached: true,
      expiresInSeconds: Math.max(0, Math.round((this.#cachedToken.expiresAt - Date.now()) / 1000)),
    };
  }

  /* ----------------------------------------------------------- connection */

  async getConnection() {
    return this.connections.ensure(this.provider);
  }

  async getAccountInfo(accessToken) {
    const token = accessToken ?? (await this.getValidAccessToken());
    return this.#fetchAccount(token);
  }

  /**
   * Revokes the token at Dropbox and clears the stored credential.
   *
   * Order matters: revoke first (while the credential still works), then
   * clear. A failed revoke does not block the disconnect — a token we can no
   * longer use is already effectively revoked from this app's point of view.
   */
  async revokeAccess({ actor = null, ip = '' } = {}) {
    let revoked = false;
    let revokeError = '';

    try {
      const token = await this.getValidAccessToken();
      const response = await this.#request('https://api.dropboxapi.com/2/auth/token/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      revoked = response.ok;
      if (!response.ok) revokeError = `Dropbox responded ${response.status}`;
    } catch (error) {
      revokeError = error.message;
    }

    this.invalidateAccessToken();
    // Unlike a refresh, a disconnect may be followed by connecting a different
    // account, so the namespace of the old one must not linger.
    this.#pathRoot = null;
    await this.connections.clearCredentials(this.provider);

    await this.audit?.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'dropbox.disconnected',
      outcome: revoked ? 'success' : 'partial',
      ip,
      details: { revoked, revokeError },
    });

    return { disconnected: true, revoked, revokeError };
  }

  /* ----------------------------------------------------------- internals */

  #cacheToken(accessToken, expiresInSeconds) {
    if (!accessToken) return;
    const lifetimeMs = Math.max(60, Number(expiresInSeconds) || 14_400) * 1000;
    this.#cachedToken = {
      token: accessToken,
      expiresAt: Date.now() + Math.max(30_000, lifetimeMs - EXPIRY_SAFETY_MS),
    };
  }

  /** POSTs to the token endpoint with the app credentials. */
  async #postToken(fields) {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.config.dropbox.appKey,
      client_secret: this.config.dropbox.appSecret,
    });

    const response = await this.#request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error_description || parsed.error || '';
      } catch {
        detail = text.slice(0, 200);
      }
      throw new DropboxAuthenticationError(`Dropbox token endpoint returned ${response.status}: ${detail}`, {
        status: response.status === 400 ? 400 : 502,
      });
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new DropboxAuthenticationError('Dropbox token endpoint returned a malformed response.');
    }
  }

  async #fetchAccount(accessToken) {
    try {
      const response = await this.#request('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const text = await response.text();
      if (!response.ok) throw classifyResponse(response.status, text, response.headers);
      return JSON.parse(text);
    } catch (error) {
      // Account metadata is a nicety; a connection without a display name is
      // still a working connection.
      this.logger?.warn?.('Could not read the Dropbox account profile', { error: error.message });
      return {};
    }
  }

  /** fetch with a timeout, mapping transport failures into the taxonomy. */
  async #request(url, options) {
    const controller = new AbortController();
    try {
      return await withTimeout(
        this.fetch(url, { ...options, signal: controller.signal }),
        this.config.dropbox.requestTimeoutMs,
        { message: 'Dropbox OAuth request timed out.', onTimeout: () => controller.abort() }
      );
    } catch (error) {
      throw classifyNetworkError(error);
    }
  }
}
