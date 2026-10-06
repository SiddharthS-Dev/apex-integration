/**
 * IndexedDB wrapper backing the offline-first experience.
 *
 * Two stores:
 *   files    — the encrypted-at-rest-by-the-browser blob for each downloaded
 *              presentation, keyed by presentation id. Never written to disk as
 *              a loose file, so downloads stay inside the app sandbox.
 *   activity — per-user reading state: bookmarks, progress, favourites, views.
 */

/**
 * One database per signed-in user, named after their id.
 *
 * Offline copies and reading history are personal, and a browser is often
 * shared — a kiosk, a meeting-room PC, a colleague's laptop. With one
 * database per origin, the next person to sign in would see (and could open)
 * everything the last one downloaded. The AuthProvider sets the owner on
 * sign-in and deletes the database on sign-out or when a different user signs
 * in; until an owner is set, every call fails closed.
 */
const DB_PREFIX = 'slidesvault:';
/** The unscoped database earlier builds wrote; its owner is unknown. */
const LEGACY_DB_NAME = 'slidesvault';
const DB_VERSION = 1;
const FILES = 'files';
const ACTIVITY = 'activity';

let owner = null;
let dbPromise = null;

const dbName = (userId) => `${DB_PREFIX}${userId}`;

function closeCurrent() {
  const pending = dbPromise;
  dbPromise = null;
  pending?.then((db) => db.close()).catch(() => {});
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(false);
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // Another tab still has it open; it is deleted once that tab lets go.
    request.onblocked = () => resolve(false);
  });
}

/** Points every call below at this user's database (or none, with null). */
export function setOfflineOwner(userId) {
  const next = userId ? String(userId) : null;
  if (next === owner) return;
  closeCurrent();
  owner = next;
}

/** Deletes a user's offline copies and reading state from this browser. */
export async function deleteOfflineData(userId) {
  if (!userId) return false;
  if (String(userId) === owner) closeCurrent();
  return deleteDatabase(dbName(userId));
}

/** Drops the pre-scoping database: nothing says whose files are in it. */
export function deleteLegacyOfflineData() {
  return deleteDatabase(LEGACY_DB_NAME);
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (!owner) return Promise.reject(new Error('No signed-in user owns the offline library.'));

  const name = dbName(owner);
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: 'id' });
        store.createIndex('cached_at', 'cached_at');
      }
      if (!db.objectStoreNames.contains(ACTIVITY)) {
        const store = db.createObjectStore(ACTIVITY, { keyPath: 'id' });
        store.createIndex('last_viewed', 'last_viewed');
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Lets deleteOfflineData() in another tab proceed instead of blocking.
      db.onversionchange = () => {
        db.close();
        if (owner && dbName(owner) === name) dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

function tx(storeName, mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
          result = run(store);
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve(result?.__request ? result.__request.result : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function request(req) {
  return { __request: req };
}

/* ------------------------------------------------------------ files store */

export async function cacheFile(id, blob, metadata = {}) {
  const entry = {
    id,
    blob,
    size: blob?.size || 0,
    type: blob?.type || 'application/pdf',
    cached_at: new Date().toISOString(),
    rev: metadata.rev || null,
    title: metadata.title || '',
    file_type: metadata.file_type || 'pdf',
    ...metadata,
  };
  await tx(FILES, 'readwrite', (store) => request(store.put(entry)));
  return entry;
}

export async function getCachedFile(id) {
  try {
    return (await tx(FILES, 'readonly', (store) => request(store.get(id)))) || null;
  } catch {
    return null;
  }
}

export async function removeCachedFile(id) {
  await tx(FILES, 'readwrite', (store) => request(store.delete(id)));
  return true;
}

export async function getAllCached() {
  try {
    const rows = (await tx(FILES, 'readonly', (store) => request(store.getAll()))) || [];
    return rows.sort((a, b) => String(b.cached_at).localeCompare(String(a.cached_at)));
  } catch {
    return [];
  }
}

export async function getAllCachedIds() {
  try {
    return (await tx(FILES, 'readonly', (store) => request(store.getAllKeys()))) || [];
  } catch {
    return [];
  }
}

export async function getCacheSize() {
  const rows = await getAllCached();
  return rows.reduce((sum, r) => sum + (r.size || 0), 0);
}

/**
 * LRU eviction. When the origin is close to its storage quota, drops the
 * least-recently cached files until there is 1.5x the requested space free.
 */
export async function ensureCacheSpace(neededBytes = 0) {
  const estimate = await getStorageEstimate();
  if (!estimate.quota) return { evicted: [] };

  const target = neededBytes * 1.5;
  let free = estimate.quota - estimate.usage;
  if (free >= target) return { evicted: [] };

  const rows = (await getAllCached()).sort((a, b) =>
    String(a.cached_at).localeCompare(String(b.cached_at))
  );

  const evicted = [];
  for (const row of rows) {
    if (free >= target) break;
    await removeCachedFile(row.id);
    free += row.size || 0;
    evicted.push(row.id);
  }
  return { evicted };
}

/* --------------------------------------------------------- activity store */

export const DEFAULT_ACTIVITY = {
  bookmarks: [],
  progress: 0,
  current_page: 1,
  favorite: false,
  last_viewed: null,
  views: 0,
  reading_time: 0,
};

export async function getActivity(id) {
  try {
    const row = await tx(ACTIVITY, 'readonly', (store) => request(store.get(id)));
    return { id, ...DEFAULT_ACTIVITY, ...(row || {}) };
  } catch {
    return { id, ...DEFAULT_ACTIVITY };
  }
}

export async function updateActivity(id, updates = {}) {
  const current = await getActivity(id);
  const next = { ...current, ...updates, id, updated_at: new Date().toISOString() };
  await tx(ACTIVITY, 'readwrite', (store) => request(store.put(next)));
  return next;
}

export async function getAllActivity() {
  try {
    return (await tx(ACTIVITY, 'readonly', (store) => request(store.getAll()))) || [];
  } catch {
    return [];
  }
}

export async function getRecentActivity(limit = 20) {
  const rows = await getAllActivity();
  return rows
    .filter((r) => r.last_viewed)
    .sort((a, b) => new Date(b.last_viewed) - new Date(a.last_viewed))
    .slice(0, limit);
}

export async function getInProgress(limit = 20) {
  const rows = await getAllActivity();
  return rows
    .filter((r) => (r.progress || 0) > 0 && (r.progress || 0) < 98)
    .sort((a, b) => new Date(b.last_viewed || 0) - new Date(a.last_viewed || 0))
    .slice(0, limit);
}

export async function getFavorites() {
  const rows = await getAllActivity();
  return rows.filter((r) => r.favorite === true);
}

export async function toggleFavorite(id) {
  const current = await getActivity(id);
  return updateActivity(id, { favorite: !current.favorite });
}

export async function toggleBookmark(id, page) {
  const current = await getActivity(id);
  const bookmarks = current.bookmarks || [];
  const exists = bookmarks.includes(page);
  return updateActivity(id, {
    bookmarks: exists ? bookmarks.filter((p) => p !== page) : [...bookmarks, page].sort((a, b) => a - b),
  });
}

export async function getStorageEstimate() {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch {
    /* ignore */
  }
  return { usage: 0, quota: 0 };
}

export async function clearAllOffline() {
  await tx(FILES, 'readwrite', (store) => request(store.clear()));
  return true;
}
