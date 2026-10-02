import { config } from '../../config.js';
import { base44Integration } from '../../ai/base44.js';

// Base44 media provider: the Base44 app's built-in Core.GenerateVideo (8-second silent clip) and
// Core.GenerateSpeech (MP3 narration). Base44 answers with a public media URL; we download the file
// so the lesson keeps it in our own object store instead of depending on that link staying up.

const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_BYTES = 200 * 1024 * 1024;
const MEDIA_HOST = /^https:\/\/([a-z0-9-]+\.)*base44\.(com|app)\//i;

async function download(url, fallbackType) {
  if (typeof url !== 'string' || !MEDIA_HOST.test(url)) throw new Error('Base44 returned no media URL');
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Downloading Base44 media failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('Base44 media file was empty');
  if (bytes.length > MAX_BYTES) throw new Error('Base44 media file is too large');
  return { bytes, contentType: (res.headers.get('content-type') || fallbackType).split(';')[0] };
}

const urlOf = (res) => res?.url || res?.video_url || res?.audio_url || res?.file_url;

export default {
  name: 'base44',
  enabled: !!config.base44.appId,

  async generateVideo({ prompt, durationSeconds, aspectRatio }) {
    const res = await base44Integration('GenerateVideo', { prompt, duration: durationSeconds, aspect_ratio: aspectRatio });
    return download(urlOf(res), 'video/mp4');
  },

  async generateNarration({ text, voice }) {
    const res = await base44Integration('GenerateSpeech', { text, voice });
    return download(urlOf(res), 'audio/mpeg');
  },
};
