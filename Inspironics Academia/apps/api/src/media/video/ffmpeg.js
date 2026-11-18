import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { config } from '../../config.js';
import { unavailable } from '../../lib/errors.js';

// FFmpeg: the system binary at FFMPEG_PATH when set, otherwise the one bundled by ffmpeg-static.

const require = createRequire(import.meta.url);

export function ffmpegPath() {
  if (config.video.ffmpegPath) return config.video.ffmpegPath;
  try {
    const p = require('ffmpeg-static');
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

export function ffmpegAvailable() {
  const p = ffmpegPath();
  return !!p && fs.existsSync(p);
}

/**
 * Runs ffmpeg with `args`. Resolves with stderr (ffmpeg logs there); rejects with the tail of stderr.
 * `signal` (AbortSignal) kills the process, e.g. when a render job is cancelled.
 */
export function runFfmpeg(args, { timeoutMs = 30 * 60_000, signal, input } = {}) {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(unavailable('FFmpeg is not available: install ffmpeg-static or set FFMPEG_PATH'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(Object.assign(new Error('Rendering was cancelled'), { cancelled: true }));
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Duration in seconds of a media file (0 when unreadable), read from ffmpeg's own report. */
export async function mediaDuration(file) {
  const bin = ffmpegPath();
  if (!bin) return 0;
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
    child.on('error', () => resolve(0));
  });
}
