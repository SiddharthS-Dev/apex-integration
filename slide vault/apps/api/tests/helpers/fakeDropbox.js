/**
 * An in-memory Dropbox.
 *
 * It implements the endpoints this integration actually calls, holds a real
 * folder tree, and can be told to misbehave — expire tokens, rate limit, fail
 * with a 500, drop the connection. That is what makes the failure scenarios in
 * spec §75 testable without a network or a real account.
 *
 * Injected as `fetchImpl`, so the code under test is the production code.
 */
import JSZip from 'jszip';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const dropboxError = (tag, status = 409, summary = '') =>
  json({ error_summary: summary || `${tag}/...`, error: { '.tag': tag } }, status);

let idCounter = 0;
const nextId = () => `id:FAKE${(idCounter += 1).toString().padStart(6, '0')}`;

/** Composite key: everything in the fake is scoped to a namespace. */
const key = (namespace, path) => `${namespace}\u0000${path}`;

export const HOME_NAMESPACE = '1000';
export const TEAM_NAMESPACE = '2000';

/**
 * @param {object} [options]
 * @param {Array<{path: string, content?: Buffer, rev?: string, namespace?: string}>} [options.files]
 * @param {boolean} [options.team] model a Dropbox Business account whose root
 *        namespace is a team space distinct from the member's home folder
 */
export function createFakeDropbox({ files = [], account = {}, team = false } = {}) {
  const state = {
    account: {
      account_id: 'dbid:FAKEACCOUNT',
      name: { display_name: 'Avery Raman' },
      email: 'avery.raman@inspironics.net',
      // On a personal account the root and home namespaces are the same id;
      // on a team account the root is the team space and home sits inside it.
      root_info: team
        ? {
            '.tag': 'team',
            root_namespace_id: TEAM_NAMESPACE,
            home_namespace_id: HOME_NAMESPACE,
            home_path: '/Avery Raman',
          }
        : {
            '.tag': 'user',
            root_namespace_id: HOME_NAMESPACE,
            home_namespace_id: HOME_NAMESPACE,
          },
      ...account,
    },
    /** @type {Map<string, object>} "<namespace>\0<path_lower>" -> entry */
    files: new Map(),
    /** @type {Set<string>} "<namespace>\0<path_lower>" */
    folders: new Set([`${HOME_NAMESPACE}\u0000`, `${TEAM_NAMESPACE}\u0000`]),
    refreshTokens: new Set(['refresh-token-valid']),
    authorizationCodes: new Map([['auth-code-valid', 'refresh-token-valid']]),
    /** Access tokens the fake currently considers live. */
    accessTokens: new Set(),
    /** Test knobs. */
    behavior: {
      expireNextAccessToken: false,
      rateLimitTimes: 0,
      retryAfterSeconds: 0,
      serverErrorTimes: 0,
      networkErrorTimes: 0,
      timeoutTimes: 0,
      rejectRefreshToken: false,
      noRefreshTokenInExchange: false,
      thumbnailUnsupported: false,
      previewUnsupported: false,
      /** Force list_folder to paginate in pages of this size. */
      pageSize: 2000,
    },
    /** Every request, for assertions. */
    calls: [],
    tokenRefreshCount: 0,
  };

  const addFile = ({ path, content = Buffer.from('%PDF-1.4 fake'), rev, name, namespace }) => {
    const lower = path.toLowerCase();
    const leaf = name ?? path.slice(path.lastIndexOf('/') + 1);
    const entry = {
      '.tag': 'file',
      // Which namespace the file lives in. Default: the member's home folder,
      // so existing tests keep their meaning.
      namespace: namespace ?? HOME_NAMESPACE,
      id: nextId(),
      name: leaf,
      path_lower: lower,
      path_display: path,
      size: content.length,
      rev: rev ?? `rev${(Math.random() * 1e9).toFixed(0)}`,
      content_hash: `hash-${leaf}`,
      server_modified: new Date().toISOString(),
      client_modified: new Date().toISOString(),
      content,
    };
    const ns = entry.namespace;
    state.files.set(key(ns, lower), entry);

    // Register every ancestor folder so list_folder can find them.
    const segments = path.split('/').filter(Boolean).slice(0, -1);
    for (let i = 1; i <= segments.length; i += 1) {
      state.folders.add(key(ns, `/${segments.slice(0, i).join('/')}`.toLowerCase()));
    }
    return entry;
  };

  for (const file of files) addFile(file);

  const findByIdOrPath = (value, namespace) => {
    if (!value) return null;
    if (String(value).startsWith('id:')) {
      // Ids are global in Dropbox, but only resolvable within a namespace the
      // caller can actually see.
      const entry = [...state.files.values()].find((item) => item.id === value);
      return entry && entry.namespace === namespace ? entry : null;
    }
    return state.files.get(key(namespace, String(value).toLowerCase())) ?? null;
  };

  const publicEntry = (entry) => {
    const { content, namespace, ...rest } = entry;
    return rest;
  };

  /**
   * Resolves the Dropbox-API-Path-Root header.
   *
   * Returns either the namespace to operate in, or the 422 Dropbox sends when
   * the client's idea of the root namespace is stale.
   */
  const resolveNamespace = (request) => {
    const header = request.headers.get('Dropbox-API-Path-Root');
    const rootInfo = state.account.root_info ?? {};
    if (!header) return { namespace: String(rootInfo.home_namespace_id ?? HOME_NAMESPACE) };

    let parsed;
    try {
      parsed = JSON.parse(header);
    } catch {
      return { error: json({ error_summary: 'invalid_root/malformed' }, 400) };
    }

    if (parsed['.tag'] === 'home') {
      return { namespace: String(rootInfo.home_namespace_id ?? HOME_NAMESPACE) };
    }
    if (parsed['.tag'] === 'namespace_id') {
      return { namespace: String(parsed.namespace_id) };
    }
    if (parsed['.tag'] === 'root') {
      // The whole point of the "root" variant: Dropbox checks the id against
      // the account's current root and corrects the client when it is stale.
      if (String(parsed.root) !== String(rootInfo.root_namespace_id)) {
        return {
          error: json(
            {
              error_summary: 'invalid_root/...',
              error: { '.tag': 'invalid_root', invalid_root: rootInfo },
            },
            422
          ),
        };
      }
      return { namespace: String(rootInfo.root_namespace_id) };
    }
    return { error: json({ error_summary: 'invalid_root/unknown_tag' }, 400) };
  };

  /** Consumes one "misbehave" credit, if any is pending. */
  const misbehave = () => {
    const b = state.behavior;
    if (b.networkErrorTimes > 0) {
      b.networkErrorTimes -= 1;
      const error = new TypeError('fetch failed');
      error.code = 'ECONNRESET';
      throw error;
    }
    if (b.timeoutTimes > 0) {
      b.timeoutTimes -= 1;
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    }
    if (b.rateLimitTimes > 0) {
      b.rateLimitTimes -= 1;
      return json(
        { error_summary: 'too_many_requests/...', error: { '.tag': 'too_many_requests' } },
        429,
        b.retryAfterSeconds ? { 'Retry-After': String(b.retryAfterSeconds) } : {}
      );
    }
    if (b.serverErrorTimes > 0) {
      b.serverErrorTimes -= 1;
      return new Response('upstream failure', { status: 503 });
    }
    return null;
  };

  const requireToken = (request) => {
    const header = request.headers.get('Authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (state.behavior.expireNextAccessToken) {
      state.behavior.expireNextAccessToken = false;
      return json(
        { error_summary: 'expired_access_token/...', error: { '.tag': 'expired_access_token' } },
        401
      );
    }
    if (!token || !state.accessTokens.has(token)) {
      return json({ error_summary: 'invalid_access_token/...', error: { '.tag': 'invalid_access_token' } }, 401);
    }
    return null;
  };

  /** @type {typeof fetch} */
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const request = { headers: new Headers(options.headers ?? {}) };
    let body = {};
    if (typeof options.body === 'string' && options.body.startsWith('{')) {
      body = JSON.parse(options.body);
    }
    const apiArg = request.headers.get('Dropbox-API-Arg');
    const args = apiArg ? JSON.parse(apiArg) : body;

    state.calls.push({ url: target, args, pathRoot: request.headers.get('Dropbox-API-Path-Root') });

    /* ------------------------------------------------------------ oauth */
    if (target.includes('/oauth2/token')) {
      const params = new URLSearchParams(String(options.body ?? ''));
      const grant = params.get('grant_type');

      if (grant === 'authorization_code') {
        const code = params.get('code');
        const refreshToken = state.authorizationCodes.get(code);
        if (!refreshToken) {
          return json({ error: 'invalid_grant', error_description: 'code not found' }, 400);
        }
        // Single-use, exactly as Dropbox behaves.
        state.authorizationCodes.delete(code);
        const accessToken = `access-${Math.random().toString(36).slice(2)}`;
        state.accessTokens.add(accessToken);
        return json({
          access_token: accessToken,
          ...(state.behavior.noRefreshTokenInExchange ? {} : { refresh_token: refreshToken }),
          expires_in: 14400,
          account_id: state.account.account_id,
          token_type: 'bearer',
        });
      }

      if (grant === 'refresh_token') {
        state.tokenRefreshCount += 1;
        const refreshToken = params.get('refresh_token');
        if (state.behavior.rejectRefreshToken || !state.refreshTokens.has(refreshToken)) {
          return json({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400);
        }
        const accessToken = `access-${Math.random().toString(36).slice(2)}`;
        state.accessTokens.add(accessToken);
        return json({ access_token: accessToken, expires_in: 14400, token_type: 'bearer' });
      }

      return json({ error: 'unsupported_grant_type' }, 400);
    }

    const misbehaved = misbehave();
    if (misbehaved) return misbehaved;

    /* ------------------------------------------------------------- rpc */
    if (target.includes('/2/auth/token/revoke')) {
      state.accessTokens.clear();
      return new Response('null', { status: 200 });
    }

    const unauthorized = requireToken(request);
    if (unauthorized) return unauthorized;

    if (target.includes('/2/users/get_current_account')) {
      return json(state.account);
    }

    // Everything below addresses a path, so it is namespace-scoped.
    const resolved = resolveNamespace(request);
    if (resolved.error) return resolved.error;
    const ns = resolved.namespace;

    if (target.includes('/2/files/list_folder/continue')) {
      const page = state.cursors?.get(args.cursor);
      if (!page) return dropboxError('reset', 409);
      state.cursors.delete(args.cursor);
      return json(makePage(page.entries, page.offset, state));
    }

    if (target.includes('/2/files/list_folder')) {
      const root = String(args.path ?? '').toLowerCase();
      if (root && !state.folders.has(key(ns, root))) return dropboxError('path/not_found', 409);

      const within = (value) => !root || value === root || value.startsWith(`${root}/`);
      const entries = [];
      const prefix = `${ns}\u0000`;

      for (const composite of state.folders) {
        if (!composite.startsWith(prefix)) continue;
        const folder = composite.slice(prefix.length);
        if (!folder || !within(folder)) continue;
        if (folder === root) continue;
        const relative = root ? folder.slice(root.length + 1) : folder.slice(1);
        if (!args.recursive && relative.includes('/')) continue;
        entries.push({
          '.tag': 'folder',
          id: `id:FOLDER${folder}`,
          name: folder.slice(folder.lastIndexOf('/') + 1),
          path_lower: folder,
          path_display: folder,
        });
      }

      for (const entry of state.files.values()) {
        if (entry.namespace !== ns) continue;
        if (!within(entry.path_lower)) continue;
        const relative = root ? entry.path_lower.slice(root.length + 1) : entry.path_lower.slice(1);
        if (!args.recursive && relative.includes('/')) continue;
        entries.push(publicEntry(entry));
      }

      return json(makePage(entries, 0, state));
    }

    if (target.includes('/2/files/get_metadata')) {
      const entry = findByIdOrPath(args.path, ns);
      if (!entry) return dropboxError('path/not_found', 409);
      return json(publicEntry(entry));
    }

    if (target.includes('/2/files/move_v2')) {
      const entry = state.files.get(key(ns, String(args.from_path).toLowerCase()));
      if (!entry) return dropboxError('from_lookup/not_found', 409);
      const destination = String(args.to_path);
      if (state.files.has(key(ns, destination.toLowerCase()))) return dropboxError('to/conflict/file', 409);

      state.files.delete(key(ns, entry.path_lower));
      entry.path_lower = destination.toLowerCase();
      entry.path_display = destination;
      entry.name = destination.slice(destination.lastIndexOf('/') + 1);
      entry.rev = `rev${(Math.random() * 1e9).toFixed(0)}`;
      state.files.set(key(ns, entry.path_lower), entry);
      return json({ metadata: publicEntry(entry) });
    }

    if (target.includes('/2/files/delete_v2')) {
      const entry = state.files.get(key(ns, String(args.path).toLowerCase()));
      if (!entry) return dropboxError('path_lookup/not_found', 409);
      state.files.delete(key(ns, entry.path_lower));
      return json({ metadata: publicEntry(entry) });
    }

    if (target.includes('/2/files/get_temporary_link')) {
      const entry = findByIdOrPath(args.path, ns);
      if (!entry) return dropboxError('path/not_found', 409);
      return json({ link: `https://dl.dropboxusercontent.com/fake/${entry.id}`, metadata: publicEntry(entry) });
    }

    /* --------------------------------------------------------- content */
    if (target.includes('/2/files/download')) {
      const entry = findByIdOrPath(args.path, ns);
      if (!entry) return dropboxError('path/not_found', 409);
      return new Response(entry.content, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(entry.content.length),
          'Dropbox-API-Result': JSON.stringify(publicEntry(entry)),
        },
      });
    }

    if (target.includes('/2/files/get_thumbnail_v2')) {
      if (state.behavior.thumbnailUnsupported) {
        return dropboxError('unsupported_extension', 409);
      }
      const entry = findByIdOrPath(args.resource?.path ?? args.path, ns);
      if (!entry) return dropboxError('path/not_found', 409);
      return new Response(Buffer.from(`JPEG-THUMB-${entry.name}`), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }

    if (target.includes('/2/files/get_preview')) {
      if (state.behavior.previewUnsupported) {
        return dropboxError('unsupported_extension', 409);
      }
      const entry = findByIdOrPath(args.path, ns);
      if (!entry) return dropboxError('path/not_found', 409);
      return new Response(Buffer.from(`%PDF-1.4 preview of ${entry.name}`), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }

    return json({ error_summary: 'unknown_endpoint' }, 404);
  };

  return {
    fetchImpl,
    state,
    addFile,
    /** Simulates an external edit: new revision, same id. */
    touchFile(path, content = null, namespace = HOME_NAMESPACE) {
      const entry = state.files.get(key(namespace, path.toLowerCase()));
      if (!entry) throw new Error(`No such fake file: ${path}`);
      entry.rev = `rev${(Math.random() * 1e9).toFixed(0)}`;
      if (content) {
        entry.content = content;
        entry.size = content.length;
      }
      entry.server_modified = new Date().toISOString();
      return entry;
    },
    removeFile(path, namespace = HOME_NAMESPACE) {
      return state.files.delete(key(namespace, path.toLowerCase()));
    },
    hasFile(path, namespace = HOME_NAMESPACE) {
      return state.files.has(key(namespace, path.toLowerCase()));
    },
    fileAt(path, namespace = HOME_NAMESPACE) {
      return state.files.get(key(namespace, path.toLowerCase())) ?? null;
    },
    /** Simulates a team reorganization: the root namespace id changes. */
    moveTeamSpace(newNamespaceId) {
      state.account.root_info = { ...state.account.root_info, root_namespace_id: newNamespaceId };
      for (const [composite, entry] of [...state.files]) {
        if (entry.namespace !== TEAM_NAMESPACE) continue;
        state.files.delete(composite);
        entry.namespace = newNamespaceId;
        state.files.set(key(newNamespaceId, entry.path_lower), entry);
      }
      for (const composite of [...state.folders]) {
        if (!composite.startsWith(`${TEAM_NAMESPACE}\u0000`)) continue;
        state.folders.add(key(newNamespaceId, composite.slice(TEAM_NAMESPACE.length + 1)));
      }
      return newNamespaceId;
    },
    callsTo(fragment) {
      return state.calls.filter((call) => call.url.includes(fragment));
    },
    /** The path-root header sent on the most recent matching request. */
    pathRootOf(fragment) {
      const call = [...state.calls].reverse().find((item) => item.url.includes(fragment));
      return call?.pathRoot ?? null;
    },
  };
}

/** Splits entries into a page plus a cursor, honouring behavior.pageSize. */
function makePage(entries, offset, state) {
  const size = state.behavior.pageSize;
  const slice = entries.slice(offset, offset + size);
  const hasMore = offset + size < entries.length;

  if (hasMore) {
    state.cursors = state.cursors ?? new Map();
    const cursor = `cursor-${offset + size}-${Math.random().toString(36).slice(2)}`;
    state.cursors.set(cursor, { entries, offset: offset + size });
    return { entries: slice, cursor, has_more: true };
  }
  return { entries: slice, cursor: '', has_more: false };
}

/** Builds a minimal but real .pptx, for the extraction tests. */
export async function buildPptx({ slides = [['Quarterly Business Review']], title = '', image = null } = {}) {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
  );
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Test Author</dc:creator></cp:coreProperties>`
  );

  slides.forEach((runs, index) => {
    const body = runs.map((run) => `<a:p><a:r><a:t>${run}</a:t></a:r></a:p>`).join('');
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    );
  });

  if (image) {
    zip.file('ppt/media/image1.png', image);
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="image" Target="../media/image1.png"/></Relationships>'
    );
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}
