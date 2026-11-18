import fs from 'node:fs';
import os from 'node:os';
import { config } from '../config.js';
import { log } from './logger.js';

// Temporary files of the whole API process. Rendering and voice conversion already write into
// TEMP_PROCESSING_DIR, but other writers use the system temp folder: FFmpeg child processes, SQLite's
// temporary files (sorts, statement journals) and libraries calling os.tmpdir(). On a nearly full
// system drive one of those failed a render with ENOSPC. When TEMP_PROCESSING_DIR is set, the process
// environment (TMP, TEMP, TMPDIR) is pointed at it too, so every one of them — and every child
// process, which inherits the environment — uses the same, roomier folder.

const LOW_SPACE_BYTES = 1024 ** 3; // warn below 1 GB

export function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export function setupProcessTemp() {
  const configured = !!process.env.TEMP_PROCESSING_DIR;
  const dir = config.storage.tempDir;
  if (configured) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['TMP', 'TEMP', 'TMPDIR']) process.env[name] = dir;
  }
  const free = freeBytes(dir);
  const systemFree = configured ? null : freeBytes(os.tmpdir());
  if (free != null && free < LOW_SPACE_BYTES) {
    log.warn('storage.temp_low_space', { dir, free_mb: Math.round(free / 1048576), hint: 'Video renders and voice-over need temporary space: free some space or set TEMP_PROCESSING_DIR to a drive with room' });
  }
  return { dir, configured, os_tmpdir: os.tmpdir(), free_mb: free == null ? null : Math.round(free / 1048576), system_free_mb: systemFree == null ? null : Math.round(systemFree / 1048576) };
}

/** Throws a clear error before a render when the temp folder is nearly full (instead of ENOSPC mid-way). */
export function assertTempSpace(neededBytes = 300 * 1048576) {
  const free = freeBytes(config.storage.tempDir);
  if (free != null && free < neededBytes) {
    const err = new Error(`Not enough free disk space for temporary files (${Math.round(free / 1048576)} MB free in ${config.storage.tempDir}; about ${Math.round(neededBytes / 1048576)} MB needed). Free some space or set TEMP_PROCESSING_DIR to another drive.`);
    err.status = 507;
    throw err;
  }
}
