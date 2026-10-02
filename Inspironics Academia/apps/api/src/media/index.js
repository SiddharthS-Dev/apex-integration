import { config } from '../config.js';
import { unavailable } from '../lib/errors.js';
import none from './providers/none.js';
import base44 from './providers/base44.js';

// Pluggable lesson-media providers, selected by MEDIA_PROVIDER (config.mediaProvider).
// A provider implements (either method may be omitted if unsupported):
//   generateVideo({ prompt, durationSeconds, aspectRatio })  → { bytes: Buffer, contentType } | { url }
//   generateNarration({ text, voice })                        → { bytes: Buffer, contentType } | { url }
// See providers/README.md for how to add one.

const PROVIDERS = {
  none,
  base44,
};

function provider() {
  return PROVIDERS[config.mediaProvider] || null;
}

export function mediaEnabled() {
  const p = provider();
  return !!p && p.enabled !== false;
}

export function mediaUnavailableError() {
  if (!provider()) return unavailable(`Unknown MEDIA_PROVIDER "${config.mediaProvider}" (available: ${Object.keys(PROVIDERS).join(', ')})`);
  if (config.mediaProvider === 'base44') return unavailable('Base44 media needs BASE44_APP_ID on the API server');
  return unavailable('Media generation is disabled (MEDIA_PROVIDER=none)');
}

function checkResult(kind, res) {
  if (res && Buffer.isBuffer(res.bytes) && res.bytes.length) return { bytes: res.bytes, contentType: res.contentType || 'application/octet-stream' };
  if (res && typeof res.url === 'string' && /^(https?:\/\/|\/api\/media\/)/.test(res.url)) return { url: res.url };
  throw new Error(`${config.mediaProvider} returned no ${kind}`);
}

export async function generateVideo({ prompt, durationSeconds = 8, aspectRatio = '16:9' }) {
  const p = provider();
  if (!mediaEnabled()) throw mediaUnavailableError();
  if (!p.generateVideo) throw unavailable(`MEDIA_PROVIDER=${config.mediaProvider} does not support video`);
  return checkResult('video', await p.generateVideo({ prompt, durationSeconds, aspectRatio }));
}

export async function generateNarration({ text, voice }) {
  const p = provider();
  if (!mediaEnabled()) throw mediaUnavailableError();
  if (!p.generateNarration) throw unavailable(`MEDIA_PROVIDER=${config.mediaProvider} does not support narration`);
  return checkResult('narration', await p.generateNarration({ text, voice }));
}
