/**
 * Derived-content store: cached thumbnails and rendered previews.
 *
 * These are cache, not data. Dropbox stays the source of truth, so anything in
 * here can be deleted at any time and will be regenerated on the next request
 * (spec §45/§71). That is why the key is content-addressed by (file id,
 * revision, kind) — when a file changes in Dropbox, its cached derivatives are
 * simply never looked up again instead of needing invalidation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/html': 'html',
};

export class ObjectStore {
  constructor({ dir, publicBase = '/api/assets', logger }) {
    this.dir = dir;
    this.publicBase = publicBase.replace(/\/$/, '');
    this.logger = logger?.child?.({ component: 'ObjectStore' }) ?? logger;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * A stable, unguessable key for a derivative.
   *
   * Hashed rather than readable: object keys end up in URLs, and a readable key
   * would leak the Dropbox path of every file in the library.
   */
  key(externalId, revision, kind, contentType) {
    const digest = crypto
      .createHash('sha256')
      .update(`${externalId}|${revision}|${kind}`)
      .digest('hex')
      .slice(0, 32);
    const extension = EXTENSIONS[contentType] ?? 'bin';
    return `${kind}-${digest}.${extension}`;
  }

  /** Absolute path for a key, guarded against traversal. */
  pathFor(key) {
    const safe = path.basename(String(key ?? ''));
    if (!safe || safe.startsWith('.')) throw new Error('Invalid object key.');
    const full = path.join(this.dir, safe);
    // basename() already prevents traversal; this is the belt to its braces,
    // because a mistake here serves arbitrary files over HTTP.
    if (path.dirname(full) !== path.resolve(this.dir)) throw new Error('Invalid object key.');
    return full;
  }

  async has(key) {
    try {
      const stat = await fsp.stat(this.pathFor(key));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  /** Writes a buffer and returns its public URL. */
  async putBuffer(key, buffer) {
    const target = this.pathFor(key);
    // Write to a temp file and rename: a reader must never see a half-written
    // thumbnail, and two syncs racing on the same key must not interleave.
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temporary, buffer);
    await fsp.rename(temporary, target);
    return this.urlFor(key);
  }

  /** Streams a response body to disk without buffering it. */
  async putStream(key, stream) {
    const target = this.pathFor(key);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      const source = stream instanceof Readable ? stream : Readable.fromWeb(stream);
      await pipeline(source, fs.createWriteStream(temporary));
      await fsp.rename(temporary, target);
      return this.urlFor(key);
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async readBuffer(key) {
    return fsp.readFile(this.pathFor(key));
  }

  createReadStream(key) {
    return fs.createReadStream(this.pathFor(key));
  }

  async stat(key) {
    return fsp.stat(this.pathFor(key));
  }

  async remove(key) {
    await fsp.rm(this.pathFor(key), { force: true });
  }

  urlFor(key) {
    return `${this.publicBase}/${key}`;
  }

  /** The key inside a URL this store produced, or null. */
  keyFromUrl(url) {
    const value = String(url ?? '');
    if (!value.startsWith(`${this.publicBase}/`)) return null;
    return value.slice(this.publicBase.length + 1) || null;
  }

  /** Retention sweep: drops derivatives nothing has asked for in a long time. */
  async purgeOlderThan(hours) {
    const cutoff = Date.now() - hours * 3600_000;
    let removed = 0;
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      const full = path.join(this.dir, name);
      try {
        const stat = await fsp.stat(full);
        // atime, not mtime: a preview written once and read daily is live.
        if (stat.isFile() && Math.max(stat.atimeMs, stat.mtimeMs) < cutoff) {
          await fsp.rm(full, { force: true });
          removed += 1;
        }
      } catch {
        // Raced with another sweep or a write; nothing to do.
      }
    }
    return removed;
  }
}

export const contentTypeExtension = (contentType) => EXTENSIONS[contentType] ?? 'bin';
