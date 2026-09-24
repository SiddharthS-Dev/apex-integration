/**
 * The only component permitted to name a Dropbox endpoint.
 *
 * Everything above this line — sync, content, rename, folder browsing — speaks
 * in terms of these methods. That is what makes the integration testable (one
 * seam to stub) and what keeps authentication in exactly one place: nothing
 * here builds a token or a header, the executor does.
 */
import { assertSafePath, normalizePath } from './paths.js';
import { DropboxInvalidPathError } from './errors.js';

/** Dropbox caps a single list_folder page; asking for more is silently ignored. */
const MAX_PAGE_SIZE = 2000;

export class DropboxClient {
  /** @param {{executor: import('./DropboxRequestExecutor.js').DropboxRequestExecutor}} deps */
  constructor({ executor, logger }) {
    this.executor = executor;
    this.logger = logger?.child?.({ component: 'DropboxClient' }) ?? logger;
  }

  /* --------------------------------------------------------------- account */

  getCurrentAccount() {
    return this.executor.rpc('users/get_current_account', null, { operation: 'get_current_account' });
  }

  getSpaceUsage() {
    return this.executor.rpc('users/get_space_usage', null, { operation: 'get_space_usage' });
  }

  /* --------------------------------------------------------------- listing */

  /**
   * One page of folder contents.
   * @param {string} path "" means the account root
   */
  listFolder(path, { recursive = false, limit = MAX_PAGE_SIZE, includeDeleted = false } = {}) {
    return this.executor.rpc(
      'files/list_folder',
      {
        path: assertSafePath(path, { field: 'folder path' }),
        recursive,
        include_deleted: includeDeleted,
        include_media_info: false,
        include_mounted_folders: true,
        include_non_downloadable_files: false,
        limit: Math.min(limit, MAX_PAGE_SIZE),
      },
      { operation: 'list_folder' }
    );
  }

  listFolderContinue(cursor) {
    if (!cursor) throw new DropboxInvalidPathError('A pagination cursor is required.');
    return this.executor.rpc('files/list_folder/continue', { cursor }, { operation: 'list_folder_continue' });
  }

  /**
   * Walks every page of a listing, yielding entries as they arrive.
   *
   * A generator rather than an array: a 10,000-file library must not be
   * materialised in memory before the first file can be processed (spec §79).
   */
  async *iterateFolder(path, options = {}) {
    let page = await this.listFolder(path, options);
    for (const entry of page.entries ?? []) yield entry;

    while (page.has_more) {
      page = await this.listFolderContinue(page.cursor);
      for (const entry of page.entries ?? []) yield entry;
    }
  }

  /** Subfolders of a path, for the folder browser. */
  async listFolders(path) {
    const entries = [];
    for await (const entry of this.iterateFolder(path, { recursive: false })) {
      if (entry['.tag'] === 'folder') {
        entries.push({
          name: entry.name,
          path_lower: entry.path_lower,
          path_display: entry.path_display,
          id: entry.id,
        });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /* -------------------------------------------------------------- metadata */

  getMetadata(pathOrId) {
    return this.executor.rpc(
      'files/get_metadata',
      { path: toPathArgument(pathOrId), include_deleted: false },
      { operation: 'get_metadata' }
    );
  }

  search(query, { path = '', maxResults = 100 } = {}) {
    return this.executor.rpc(
      'files/search_v2',
      {
        query: String(query).slice(0, 1000),
        options: {
          path: assertSafePath(path, { field: 'search path' }) || undefined,
          max_results: Math.min(maxResults, 1000),
          file_status: 'active',
        },
      },
      { operation: 'search' }
    );
  }

  /* -------------------------------------------------------------- content */

  /** Raw download. Returns the Response so the body can be streamed. */
  download(pathOrId) {
    return this.executor.content(
      'files/download',
      { path: toPathArgument(pathOrId) },
      { operation: 'download' }
    );
  }

  /**
   * A PDF rendering of an Office document (pptx/ppt/doc/docx/xls).
   * Dropbox generates it server-side; PDFs are not supported here (they are
   * already previewable) and return an error, so callers must branch on type.
   */
  getPreview(pathOrId) {
    return this.executor.content(
      'files/get_preview',
      { path: toPathArgument(pathOrId) },
      { operation: 'get_preview' }
    );
  }

  /**
   * A rendered thumbnail.
   * @param {{format?: 'jpeg'|'png', size?: string, mode?: string}} options
   */
  getThumbnail(pathOrId, { format = 'jpeg', size = 'w640h480', mode = 'fitone_bestfit' } = {}) {
    return this.executor.content(
      'files/get_thumbnail_v2',
      {
        resource: { '.tag': 'path', path: toPathArgument(pathOrId) },
        format,
        size,
        mode,
      },
      { operation: 'get_thumbnail' }
    );
  }

  /**
   * A short-lived direct link (Dropbox expires it in ~4 hours).
   *
   * Restricted by policy to administrators — handing one to a normal user
   * would bypass the application's own authorization (spec §42/§43).
   */
  getTemporaryLink(pathOrId) {
    return this.executor.rpc(
      'files/get_temporary_link',
      { path: toPathArgument(pathOrId) },
      { operation: 'get_temporary_link' }
    );
  }

  /* -------------------------------------------------------------- mutation */

  /** Renames or moves. autorename=false so a collision is reported, not hidden. */
  move(fromPath, toPath, { autorename = false } = {}) {
    return this.executor.rpc(
      'files/move_v2',
      {
        from_path: assertSafePath(fromPath, { field: 'source path' }),
        to_path: assertSafePath(toPath, { field: 'destination path' }),
        allow_shared_folder: false,
        autorename,
        allow_ownership_transfer: false,
      },
      { operation: 'move' }
    );
  }

  delete(path) {
    return this.executor.rpc(
      'files/delete_v2',
      { path: assertSafePath(path, { field: 'path' }) },
      { operation: 'delete' }
    );
  }

  createFolder(path) {
    return this.executor.rpc(
      'files/create_folder_v2',
      { path: assertSafePath(path, { field: 'path' }), autorename: false },
      { operation: 'create_folder' }
    );
  }
}

/**
 * Dropbox accepts either a path or an "id:..." handle wherever it says `path`.
 *
 * Ids are preferred by callers because they survive renames — which matters
 * enormously here, since this integration renames files itself.
 */
export function toPathArgument(pathOrId) {
  const value = String(pathOrId ?? '').trim();
  if (!value) throw new DropboxInvalidPathError('A Dropbox path or file id is required.');
  if (value.startsWith('id:') || value.startsWith('rev:') || value.startsWith('ns:')) return value;
  const normalized = normalizePath(value);
  if (!normalized) throw new DropboxInvalidPathError('A Dropbox path or file id is required.');
  return assertSafePath(normalized, { field: 'path' });
}
