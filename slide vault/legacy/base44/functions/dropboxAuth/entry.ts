import { createClientFromRequest } from '@base44/sdk';
import {
  appKey, appSecret, normalizeRootFolder, readConfig, writeConfig, dbxRpc,
  requireAdmin, json, errorResponse, DropboxConfigRecord,
} from '../../shared/dropboxClient.ts';

/**
 * Admin-facing Dropbox OAuth and connection management.
 * Every action requires the admin role, and no response ever carries the
 * refresh token back to the browser.
 */

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

function sanitize(config: DropboxConfigRecord | null) {
  if (!config) {
    return {
      connection_status: 'disconnected',
      sync_status: 'idle',
      root_folder: normalizeRootFolder(null),
      last_sync: null,
      last_token_refresh: null,
      last_error: '',
    };
  }
  // Explicit allow-list: refresh_token must never leave the server.
  return {
    connection_status: config.connection_status,
    sync_status: config.sync_status ?? 'idle',
    account_id: config.account_id ?? '',
    connected_account_name: config.connected_account_name ?? '',
    connected_account_email: config.connected_account_email ?? '',
    root_folder: config.root_folder ?? '',
    last_sync: config.last_sync ?? null,
    last_token_refresh: config.last_token_refresh ?? null,
    last_error: config.last_error ?? '',
  };
}

async function upsertConfig(base44: any, patch: Record<string, unknown>) {
  const config = await readConfig(base44);
  if (config) return writeConfig(base44, config.id, patch);
  return base44.asServiceRole.entities.DropboxConfig.create({
    connection_status: 'disconnected',
    sync_status: 'idle',
    root_folder: normalizeRootFolder(null),
    ...patch,
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    await requireAdmin(base44);

    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
    const action = payload.action ?? 'status';

    switch (action) {
      /* --------------------------------------------------------- authorize */
      case 'getAuthUrl': {
        const params = new URLSearchParams({
          client_id: appKey(),
          response_type: 'code',
          redirect_uri: payload.redirect_uri,
          // offline is what makes Dropbox hand back a refresh token.
          token_access_type: 'offline',
          force_reapprove: 'false',
        });
        return json({ url: `${AUTHORIZE_URL}?${params.toString()}` });
      }

      /* ---------------------------------------------------------- exchange */
      case 'exchange': {
        if (!payload.code) return json({ error: 'No authorization code supplied.' }, 400);

        const body = new URLSearchParams({
          code: payload.code,
          grant_type: 'authorization_code',
          client_id: appKey(),
          client_secret: appSecret(),
          redirect_uri: payload.redirect_uri,
        });

        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const token = await response.json().catch(() => ({}));

        if (!response.ok || !token.refresh_token) {
          return json(
            { error: token.error_description || 'Dropbox rejected the authorization code.' },
            400
          );
        }

        // Look the account up with the one-shot access token; only the refresh
        // token is written to the database.
        let account: any = {};
        try {
          const accountResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token.access_token}` },
          });
          account = await accountResponse.json();
        } catch {
          account = {};
        }

        await upsertConfig(base44, {
          refresh_token: token.refresh_token,
          account_id: account.account_id ?? token.account_id ?? '',
          connected_account_name: account.name?.display_name ?? '',
          connected_account_email: account.email ?? '',
          connection_status: 'connected',
          last_token_refresh: new Date().toISOString(),
          last_error: '',
        });

        return json(sanitize(await readConfig(base44)));
      }

      /* -------------------------------------------------------------- test */
      case 'test': {
        try {
          const account = await dbxRpc(base44, 'users/get_current_account', null);
          await upsertConfig(base44, { connection_status: 'connected', last_error: '' });
          return json({
            ok: true,
            account_name: account?.name?.display_name ?? '',
            account_email: account?.email ?? '',
          });
        } catch (err: any) {
          await upsertConfig(base44, { connection_status: 'error', last_error: err.message });
          return json({ ok: false, error: err.message });
        }
      }

      /* ------------------------------------------------------------ revoke */
      case 'revoke': {
        try {
          await dbxRpc(base44, 'auth/token/revoke', null);
        } catch {
          // A token that is already dead is still a successful disconnect.
        }
        await upsertConfig(base44, {
          refresh_token: '',
          connection_status: 'disconnected',
          account_id: '',
          connected_account_name: '',
          connected_account_email: '',
          last_error: '',
        });
        return json({ ok: true });
      }

      /* ------------------------------------------------------ folder tree */
      case 'list_folders': {
        const path = payload.path ? normalizeRootFolder(payload.path) : '';
        const page = await dbxRpc(base44, 'files/list_folder', {
          path,
          recursive: false,
          limit: 500,
        });
        const entries = (page.entries ?? [])
          .filter((e: any) => e['.tag'] === 'folder')
          .map((e: any) => ({ name: e.name, path_lower: e.path_lower, path_display: e.path_display }));
        return json({ path, entries });
      }

      /* -------------------------------------------------- set sync folder */
      case 'set_root_folder': {
        const root = normalizeRootFolder(payload.root_folder);
        await upsertConfig(base44, { root_folder: root });
        return json(sanitize(await readConfig(base44)));
      }

      /* ------------------------------------------------------------ status */
      default:
        return json(sanitize(await readConfig(base44)));
    }
  } catch (err) {
    return errorResponse(err);
  }
});
