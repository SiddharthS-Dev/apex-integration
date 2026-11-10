// Subtitles (SRT and WebVTT) from timed caption cues [{ start, end, text }] (seconds).
// Lines wrap at word boundaries (≤ 42 characters, ≤ 2 lines per cue); a cue too long for two lines is
// split into consecutive cues sharing its time in proportion to their length, so nothing is dropped
// and the timing stays in step with the narration.

const MAX_LINE = 42;
const MAX_LINES = 2;

export function wrapLines(text, max = MAX_LINE) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= max) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Splits cues so each fits in two wrapped lines; times are shared out by text length. */
export function readableCues(cues) {
  const out = [];
  for (const c of cues || []) {
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !String(c.text || '').trim()) continue;
    const lines = wrapLines(c.text);
    const groups = [];
    for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
    const total = groups.reduce((n, g) => n + g.join(' ').length, 0) || 1;
    let t = start;
    groups.forEach((g, i) => {
      const e = i === groups.length - 1 ? end : t + ((end - start) * g.join(' ').length) / total;
      out.push({ start: t, end: e, lines: g });
      t = e;
    });
  }
  return out;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(sec, sep) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues) {
  return readableCues(cues).map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n');
}

export function toVtt(cues, { position = '' } = {}) {
  const settings = position ? ` ${position}` : '';
  return `WEBVTT\n\n${readableCues(cues).map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}${settings}\n${c.lines.join('\n')}\n`).join('\n')}`;
}
