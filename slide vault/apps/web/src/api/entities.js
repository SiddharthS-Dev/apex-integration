import { getClient } from './base44Client';

/** Wraps one entity so every method resolves the backend client lazily. */
function entityProxy(name) {
  const call = (method) => async (...args) => {
    const client = await getClient();
    const entity = client.entities?.[name];
    if (!entity || typeof entity[method] !== 'function') {
      throw new Error(`Entity ${name}.${method} is not available on this backend.`);
    }
    return entity[method](...args);
  };

  return {
    entityName: name,
    list: call('list'),
    filter: call('filter'),
    get: call('get'),
    create: call('create'),
    bulkCreate: call('bulkCreate'),
    update: call('update'),
    delete: call('delete'),
  };
}

export const Presentation = entityProxy('Presentation');
export const DropboxConfig = entityProxy('DropboxConfig');
export const SyncLog = entityProxy('SyncLog');
export const PresentationAnalytics = entityProxy('PresentationAnalytics');
export const LoginHistory = entityProxy('LoginHistory');

export const User = {
  ...entityProxy('User'),
  async me() {
    const client = await getClient();
    return client.auth.me();
  },
  async updateMyUserData(data) {
    const client = await getClient();
    return client.auth.updateMyUserData(data);
  },
  async logout() {
    const client = await getClient();
    return client.auth.logout();
  },
};

const DEFAULT_PAGE_SIZE = 200;
const MAX_RECORDS = 10000;

/**
 * Reads every matching record, page by page.
 *
 * A single list()/filter() call is capped server-side, so asking for "the whole
 * catalog" in one request quietly truncates it once the library outgrows that
 * cap. This walks the pages with skip until a short page comes back.
 */
export async function listAll(entity, { query = null, sort, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const rows = [];
  const seen = new Set();
  let skip = 0;

  for (;;) {
    const page = query
      ? await entity.filter(query, sort, pageSize, skip)
      : await entity.list(sort, pageSize, skip);

    if (!Array.isArray(page) || page.length === 0) break;

    let added = 0;
    for (const row of page) {
      const key = row?.id;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows.push(row);
      added += 1;
    }

    // A short page means the end; zero new rows means the backend ignored skip,
    // and paging further would just re-read the same records.
    if (page.length < pageSize || added === 0 || rows.length >= MAX_RECORDS) break;
    skip += pageSize;
  }

  return rows;
}

export async function auth() {
  const client = await getClient();
  return client.auth;
}
