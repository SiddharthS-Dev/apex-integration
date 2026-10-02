import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// Local object store under data/objects. Keys are content-addressed by their parts, e.g.
//   ['upload', sha256]                     → an uploaded playbook
//   ['dropbox', fileId, rev, 'source']     → a Dropbox file at a given revision
// A changed Dropbox revision simply produces a new key; stale derivatives are never looked up again.

export function objectKey(...parts) {
  return crypto.createHash('sha256').update(parts.map(String).join('\u0000')).digest('hex');
}

function filePath(key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid object key');
  return path.join(config.objectDir, key.slice(0, 2), key);
}

export async function putObject(key, buffer, meta = {}) {
  const p = filePath(key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, p);
  await fsp.writeFile(`${p}.json`, JSON.stringify({ ...meta, size: buffer.length, stored_at: new Date().toISOString() }));
  return { key, size: buffer.length };
}

export async function hasObject(key) {
  try {
    await fsp.access(filePath(key));
    return true;
  } catch {
    return false;
  }
}

export async function getObject(key) {
  try {
    return await fsp.readFile(filePath(key));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function objectMeta(key) {
  try {
    return JSON.parse(await fsp.readFile(`${filePath(key)}.json`, 'utf8'));
  } catch {
    return null;
  }
}

// `range` = { start, end } (inclusive byte offsets) for HTTP Range responses.
export function objectStream(key, range) {
  return fs.createReadStream(filePath(key), range);
}

export async function deleteObject(key) {
  await fsp.rm(filePath(key), { force: true });
  await fsp.rm(`${filePath(key)}.json`, { force: true });
}
