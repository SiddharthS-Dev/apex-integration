// Minimal MPEG audio (MP3) frame walker: exact durations and gap-free concatenation of narration
// segments, without an external encoder. Handles MPEG-1/2/2.5 Layer III, CBR or VBR.

const BITRATES = {
  // [version][bitrateIndex] in kbps for Layer III
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

function id3v2Size(buf) {
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  return 0;
}

function parseHeader(buf, i) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (buf[i + 1] >> 3) & 3;
  const layerBits = (buf[i + 1] >> 1) & 3;
  if (versionBits === 1 || layerBits !== 1) return null; // reserved version / not Layer III
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const bitrate = BITRATES[version === 1 ? 1 : 2][(buf[i + 2] >> 4) & 0xf];
  const sampleRate = SAMPLE_RATES[version][(buf[i + 2] >> 2) & 3];
  if (!bitrate || !sampleRate) return null;
  const padding = (buf[i + 2] >> 1) & 1;
  const samples = version === 1 ? 1152 : 576;
  const length = Math.floor((samples / 8) * (bitrate * 1000) / sampleRate) + padding;
  const mono = ((buf[i + 3] >> 6) & 3) === 3;
  const sideInfo = version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  return { length, samples, sampleRate, sideInfo };
}

/** Audio frames only (no ID3 tags, no Xing/Info/VBRI header frame) + their exact duration. */
export function mp3Frames(buf) {
  let i = id3v2Size(buf);
  const end = buf.length >= 128 && buf.toString('latin1', buf.length - 128, buf.length - 125) === 'TAG' ? buf.length - 128 : buf.length;
  const chunks = [];
  let seconds = 0;
  let first = true;
  while (i < end) {
    const h = parseHeader(buf, i);
    if (!h || i + h.length > end) { i++; continue; } // resync past junk
    const tagAt = i + 4 + h.sideInfo;
    const tag = buf.toString('latin1', tagAt, tagAt + 4);
    const isInfoFrame = first && (tag === 'Xing' || tag === 'Info' || buf.toString('latin1', i + 36, i + 40) === 'VBRI');
    if (!isInfoFrame) {
      chunks.push(buf.subarray(i, i + h.length));
      seconds += h.samples / h.sampleRate;
    }
    first = false;
    i += h.length;
  }
  return { bytes: Buffer.concat(chunks), seconds };
}

/** Joins MP3 segments into one stream and reports where each segment starts and ends (seconds). */
export function concatMp3(buffers) {
  let t = 0;
  const parts = buffers.map((b) => mp3Frames(b));
  const spans = parts.map((p) => {
    const span = { start: t, end: t + p.seconds };
    t += p.seconds;
    return span;
  });
  return { bytes: Buffer.concat(parts.map((p) => p.bytes)), seconds: t, spans };
}
