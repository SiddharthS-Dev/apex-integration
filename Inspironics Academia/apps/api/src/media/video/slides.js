// Slide templates for rendered videos: one SVG per visual state of a scene (how many of its items are
// revealed, which subtitle is showing, whether the teacher's mouth is open), at 1280×720 design
// pixels. The look follows the in-app player: dark stage, a per-scene accent, a header with the
// course and scene progress, the slide in the layout the scene asks for, the animated teacher on the
// right and the subtitle band at the bottom.

export const TEMPLATE_VERSION = 'slides-v2';
const W = 1280;
const H = 720;
const FONT = "'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Cascadia Mono', Consolas, 'Courier New', monospace";

const ACCENTS = [
  ['#818cf8', '#a78bfa'], ['#22d3ee', '#818cf8'], ['#e879f9', '#8b5cf6'],
  ['#34d399', '#22d3ee'], ['#f472b6', '#a78bfa'], ['#60a5fa', '#c084fc'],
];
export const accentFor = (i) => ACCENTS[i % ACCENTS.length];

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Word-wraps `text` to lines no wider than `width` px at `size` px (estimated glyph widths). */
export function wrap(text, width, size, maxLines = 99, mono = false) {
  const per = Math.max(4, Math.floor(width / (size * (mono ? 0.6 : 0.53))));
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w0 of words) {
    let w = w0;
    while (w.length > per) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, per)); w = w.slice(per); }
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= per) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+$/, '')}…`;
    return kept;
  }
  return lines;
}

/** The header line, upper-cased and shortened so it never runs into the scene-progress dots. */
export function fitEyebrow(eyebrow, count) {
  const text = String(eyebrow || 'Inspironics Academia').toUpperCase();
  const dotsStart = 1040 - count * 26 - 20; // left edge of the progress dots
  const maxChars = Math.max(12, Math.floor((dotsStart - 110) / 12.5)); // ≈12.5 px per letter-spaced capital at 16 px
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

const textLines = (lines, x, y, size, lh, attrs = '') => lines.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-size="${size}" ${attrs}>${esc(l)}</text>`).join('');

/** Items a scene reveals one by one (same rule as the player). */
export function itemCount(scene) {
  switch (scene?.layout) {
    case 'rule': case 'definition': return 1;
    case 'cover': return 0;
    case 'compare': return (scene.columns || []).reduce((n, c) => n + (c.items || []).length, 0);
    case 'decision': return (scene.branches || []).length;
    case 'table': return scene.table?.rows?.length || 0;
    case 'timeline': return (scene.events || []).length;
    case 'code': return String(scene.code || '').split('\n').length;
    default: return (scene?.points || []).length;
  }
}

// ---- body layouts ------------------------------------------------------------------------------

function listBody(scene, shown, box, accent, kind) {
  const points = scene.points || [];
  const n = points.length;
  const size = n <= 3 ? 28 : n === 4 ? 25 : 22;
  const lh = size * 1.3;
  const gap = n <= 3 ? 26 : 16;
  let y = box.y;
  let out = '';
  points.slice(0, shown).forEach((p, i) => {
    const lines = wrap(p, box.w - 70, size, 3);
    const cy = y + size * 0.15;
    if (kind === 'steps') {
      out += `<circle cx="${box.x + 20}" cy="${cy - size * 0.35}" r="19" fill="url(#accent)"/><text x="${box.x + 20}" y="${cy - size * 0.35 + 7}" font-size="19" font-weight="700" fill="#0b1026" text-anchor="middle">${i + 1}</text>`;
    } else if (kind === 'checklist') {
      out += `<rect x="${box.x + 4}" y="${cy - size * 0.35 - 15}" width="30" height="30" rx="7" fill="none" stroke="${accent[1]}" stroke-width="3"/><path d="M${box.x + 11} ${cy - size * 0.35} l7 7 l12 -14" fill="none" stroke="${accent[0]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      out += `<circle cx="${box.x + 18}" cy="${cy - size * 0.35}" r="8" fill="url(#accent)"/>`;
    }
    out += textLines(lines, box.x + 60, y + size * 0.15, size, lh, 'fill="#eef0ff"');
    y += lines.length * lh + gap;
  });
  return out;
}

function tableBody(scene, shown, box, accent) {
  const { headers = [], rows = [] } = scene.table || {};
  if (!headers.length) return listBody(scene, shown, box, accent, 'points');
  const weights = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => String(r[c] ?? '').length), 6));
  const total = weights.reduce((a, b) => a + Math.min(b, 40), 0);
  const widths = weights.map((w) => (Math.min(w, 40) / total) * box.w);
  const size = rows.length > 4 ? 18 : 20;
  let out = `<rect x="${box.x}" y="${box.y - 30}" width="${box.w}" height="44" rx="10" fill="#ffffff" fill-opacity="0.08"/>`;
  let x = box.x;
  headers.forEach((h, c) => { out += `<text x="${x + 14}" y="${box.y - 2}" font-size="15" font-weight="700" fill="${accent[1]}" letter-spacing="1.5">${esc(String(h).toUpperCase())}</text>`; x += widths[c]; });
  let y = box.y + 26;
  rows.slice(0, shown).forEach((r) => {
    const cells = r.map((cell, c) => wrap(cell, widths[c] - 24, size, 2));
    const height = Math.max(...cells.map((l) => l.length)) * size * 1.25 + 18;
    out += `<rect x="${box.x}" y="${y - 4}" width="${box.w}" height="${height}" rx="8" fill="#ffffff" fill-opacity="0.04"/>`;
    out += `<rect x="${box.x}" y="${y - 4}" width="4" height="${height}" rx="2" fill="${accent[0]}"/>`;
    let cx = box.x;
    cells.forEach((lines, c) => { out += textLines(lines, cx + 14, y + size + 2, size, size * 1.25, `fill="#eef0ff"${c === 0 ? ' font-weight="600"' : ''}`); cx += widths[c]; });
    y += height + 8;
  });
  return out;
}

function ruleBody(scene, box, accent) {
  const quote = scene.quote || (scene.points || [])[0] || '';
  const lines = wrap(quote, box.w - 90, 30, 6);
  const h = lines.length * 42 + 60;
  return `<rect x="${box.x}" y="${box.y - 10}" width="${box.w}" height="${h}" rx="18" fill="#ffffff" fill-opacity="0.06" stroke="${accent[0]}" stroke-opacity="0.6"/>`
    + `<rect x="${box.x}" y="${box.y - 10}" width="6" height="${h}" rx="3" fill="url(#accent)"/>`
    + `<text x="${box.x + 28}" y="${box.y + 40}" font-size="64" fill="${accent[1]}" opacity="0.6">“</text>`
    + textLines(lines, box.x + 66, box.y + 34, 30, 42, 'fill="#f5f6ff" font-style="italic"');
}

function definitionBody(scene, box, accent) {
  const term = scene.term || scene.title;
  const def = scene.definition || (scene.points || [])[0] || '';
  return `<text x="${box.x}" y="${box.y + 20}" font-size="36" font-weight="700" fill="${accent[1]}">${esc(term)}</text>`
    + textLines(wrap(def, box.w, 26, 6), box.x, box.y + 76, 26, 36, 'fill="#eef0ff"');
}

function compareBody(scene, shown, box) {
  const cols = (scene.columns || []).slice(0, 2);
  if (cols.length < 2) return listBody(scene, shown, box, ['#818cf8', '#a78bfa'], 'points');
  const colW = (box.w - 24) / 2;
  const tone = { do: '#34d399', dont: '#f87171', neutral: '#a5b4fc' };
  let left = shown;
  let out = '';
  cols.forEach((c, i) => {
    const x = box.x + i * (colW + 24);
    const color = tone[c.tone] || tone.neutral;
    out += `<rect x="${x}" y="${box.y - 30}" width="${colW}" height="300" rx="16" fill="#ffffff" fill-opacity="0.05" stroke="${color}" stroke-opacity="0.5"/>`;
    out += `<text x="${x + 20}" y="${box.y + 2}" font-size="20" font-weight="700" fill="${color}">${esc(c.label)}</text>`;
    let y = box.y + 42;
    (c.items || []).slice(0, Math.max(0, left)).forEach((it) => {
      const lines = wrap(it, colW - 50, 20, 3);
      out += `<circle cx="${x + 26}" cy="${y - 6}" r="5" fill="${color}"/>` + textLines(lines, x + 42, y, 20, 26, 'fill="#eef0ff"');
      y += lines.length * 26 + 12;
    });
    left -= (c.items || []).length;
  });
  return out;
}

function timelineBody(scene, shown, box, accent) {
  const events = scene.events || [];
  let y = box.y;
  let out = `<line x1="${box.x + 12}" y1="${box.y - 20}" x2="${box.x + 12}" y2="${box.y + 300}" stroke="${accent[0]}" stroke-opacity="0.4" stroke-width="3"/>`;
  events.slice(0, shown).forEach((e) => {
    const lines = wrap(e.text, box.w - 230, 22, 2);
    out += `<circle cx="${box.x + 12}" cy="${y - 7}" r="9" fill="url(#accent)"/>`
      + `<text x="${box.x + 40}" y="${y}" font-size="20" font-weight="700" fill="${accent[1]}">${esc(e.label)}</text>`
      + textLines(lines, box.x + 220, y, 22, 28, 'fill="#eef0ff"');
    y += Math.max(1, lines.length) * 28 + 18;
  });
  return out;
}

function decisionBody(scene, shown, box, accent) {
  let out = scene.question ? textLines(wrap(scene.question, box.w, 24, 2), box.x, box.y, 24, 30, 'fill="#f5f6ff" font-weight="600"') : '';
  let y = box.y + (scene.question ? 70 : 0);
  (scene.branches || []).slice(0, shown).forEach((b) => {
    const when = wrap(b.when, box.w * 0.42, 20, 2);
    const then = wrap(b.then, box.w * 0.48, 20, 2);
    out += `<rect x="${box.x}" y="${y - 24}" width="${box.w}" height="${Math.max(when.length, then.length) * 26 + 22}" rx="10" fill="#ffffff" fill-opacity="0.05"/>`
      + textLines(when, box.x + 16, y, 20, 26, `fill="${accent[1]}"`)
      + `<text x="${box.x + box.w * 0.46}" y="${y}" font-size="22" fill="${accent[0]}">→</text>`
      + textLines(then, box.x + box.w * 0.5, y, 20, 26, 'fill="#eef0ff"');
    y += Math.max(when.length, then.length) * 26 + 32;
  });
  return out;
}

function codeBody(scene, shown, box) {
  const lines = String(scene.code || '').split('\n').slice(0, Math.min(shown, 12));
  return `<rect x="${box.x}" y="${box.y - 30}" width="${box.w}" height="${Math.max(80, lines.length * 26 + 40)}" rx="12" fill="#0b0f1f" stroke="#ffffff" stroke-opacity="0.12"/>`
    + lines.map((l, i) => `<text x="${box.x + 20}" y="${box.y + i * 26}" font-size="18" font-family="${MONO}" fill="#c7d2fe" xml:space="preserve">${esc(l.slice(0, 80))}</text>`).join('');
}

// Title card for a video's opening: the subtitle lines (module, course) under the title.
function coverBody(scene, box, accent) {
  const lines = (scene.subtitle || []).filter(Boolean).slice(0, 3);
  return lines.map((l, i) => `<text x="${box.x}" y="${box.y + 20 + i * 44}" font-size="${i === 0 ? 30 : 24}" font-weight="${i === 0 ? 700 : 500}" fill="${i === 0 ? accent[1] : '#c7d2fe'}">${esc(l.length > 70 ? `${l.slice(0, 69)}…` : l)}</text>`).join('');
}

function body(scene, shown, box, accent) {
  switch (scene.layout) {
    case 'cover': return coverBody(scene, box, accent);
    case 'steps': case 'checklist': return listBody(scene, shown, box, accent, scene.layout);
    case 'table': return tableBody(scene, shown, box, accent);
    case 'rule': return ruleBody(scene, box, accent);
    case 'definition': return definitionBody(scene, box, accent);
    case 'compare': return compareBody(scene, shown, box);
    case 'timeline': return timelineBody(scene, shown, box, accent);
    case 'decision': return decisionBody(scene, shown, box, accent);
    case 'code': return codeBody(scene, shown, box);
    default: return listBody(scene, shown, box, accent, 'points');
  }
}

// ---- the teacher ---------------------------------------------------------------------------------

function teacher(accent, mouthOpen) {
  const [a, b] = accent;
  const mouth = mouthOpen ? '<ellipse cx="102" cy="134" rx="9" ry="6.5" fill="#7f1d1d"/>' : '<path d="M93 133 Q102 138 111 133" stroke="#9f3a3a" stroke-width="3" fill="none" stroke-linecap="round"/>';
  return `<g transform="translate(985 205) scale(1.5)">
  <ellipse cx="100" cy="150" rx="100" ry="115" fill="${b}" fill-opacity="0.22"/>
  <path d="M38 260 C40 200 62 176 100 172 C138 176 160 200 162 260 Z" fill="url(#jacket)"/>
  <path d="M84 176 L100 214 L116 176 Z" fill="#f8fafc"/>
  <path d="M96 182 L100 196 L104 182 L100 178 Z" fill="#1e1b4b"/>
  <rect x="118" y="214" width="26" height="10" rx="3" fill="#f8fafc" fill-opacity="0.9"/>
  <path d="M52 196 C34 206 26 224 30 238 L44 240 C44 226 50 214 62 206 Z" fill="url(#jacket)"/>
  <circle cx="36" cy="240" r="7" fill="#f2c4a0"/>
  <line x1="34" y1="238" x2="-6" y2="${mouthOpen ? 190 : 200}" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round"/>
  <circle cx="-6" cy="${mouthOpen ? 190 : 200}" r="3" fill="${b}"/>
  <path d="M148 196 C164 208 168 226 164 244 L150 244 C152 228 148 214 138 206 Z" fill="url(#jacket)"/>
  <rect x="90" y="150" width="20" height="26" rx="8" fill="#e8b48f"/>
  <path d="M58 98 C56 54 84 34 106 36 C134 38 150 62 146 102 C146 132 140 150 134 158 L66 158 C60 146 58 124 58 98 Z" fill="#2b1d16"/>
  <ellipse cx="102" cy="108" rx="38" ry="44" fill="#f2c4a0"/>
  <ellipse cx="64" cy="112" rx="6" ry="9" fill="#e8b48f"/><ellipse cx="140" cy="112" rx="6" ry="9" fill="#e8b48f"/>
  <path d="M64 96 C68 64 92 52 112 56 C126 58 138 68 142 86 C126 76 104 74 86 82 C76 86 68 92 64 96 Z" fill="#2b1d16"/>
  <path d="M80 94 Q88 89 96 93 M108 93 Q116 89 124 94" stroke="#2b1d16" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="88" cy="106" rx="4.2" ry="5" fill="#1e1b2e"/><circle cx="89.5" cy="104" r="1.3" fill="#fff"/>
  <ellipse cx="116" cy="106" rx="4.2" ry="5" fill="#1e1b2e"/><circle cx="117.5" cy="104" r="1.3" fill="#fff"/>
  <g stroke="#334155" stroke-width="2" fill="#ffffff" fill-opacity="0.08"><rect x="76" y="96" width="24" height="19" rx="7"/><rect x="104" y="96" width="24" height="19" rx="7"/><path d="M100 104 L104 104" fill="none"/></g>
  <path d="M102 112 Q99 121 104 123" stroke="#d29b78" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="78" cy="124" r="5" fill="#f19c94" fill-opacity="0.35"/><circle cx="126" cy="124" r="5" fill="#f19c94" fill-opacity="0.35"/>
  ${mouth}
  ${mouthOpen ? `<circle cx="150" cy="128" r="12" fill="none" stroke="${a}" stroke-width="2" stroke-opacity="0.6"/>` : ''}
</g>`;
}

// ---- the slide -------------------------------------------------------------------------------------

/**
 * SVG for one visual state of scene `index` of `count`.
 * opts: { eyebrow, shown, caption (text|null), mouthOpen, presenter (bool), progress (0..1), backgroundImage (data URI) }
 */
export function renderSlideSvg(scene, index, count, opts = {}) {
  const accent = accentFor(index);
  const [a, b] = accent;
  const presenter = opts.presenter !== false;
  const shown = Math.max(0, Math.min(itemCount(scene), opts.shown ?? itemCount(scene)));
  const box = { x: 90, y: 300, w: presenter ? 820 : 1100 };
  const titleLines = wrap(scene.title || `Part ${index + 1}`, box.w, 48, 2);
  box.y = 236 + titleLines.length * 56;
  const source = [scene.playbook, scene.source].filter(Boolean).join('  ·  ');
  const caption = opts.caption ? wrap(opts.caption, presenter ? 800 : 1060, 24, 2) : [];
  const captionW = presenter ? 860 : 1120;
  const progress = Math.max(0, Math.min(1, opts.progress ?? 0));
  const dots = Array.from({ length: count }, (_, i) => {
    const x = 1040 - (count - i) * 26;
    const w = i === index ? 40 : 14;
    return `<rect x="${i === index ? x - 13 : x}" y="44" width="${w}" height="6" rx="3" fill="#ffffff" fill-opacity="${i < index ? 0.7 : 0.18}"/>${i === index ? `<rect x="${x - 13}" y="44" width="${Math.max(6, w * progress)}" height="6" rx="3" fill="url(#accent)"/>` : ''}`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<defs>
  <radialGradient id="bg" cx="50%" cy="0%" r="120%"><stop offset="0" stop-color="#0f1035"/><stop offset="0.7" stop-color="#060714"/></radialGradient>
  <radialGradient id="glowA" cx="85%" cy="5%" r="55%"><stop offset="0" stop-color="${a}" stop-opacity="0.35"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="5%" cy="100%" r="55%"><stop offset="0" stop-color="${b}" stop-opacity="0.3"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="jacket" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0 L0 0 0 52" fill="none" stroke="#ffffff" stroke-opacity="0.045"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${opts.backgroundImage ? `<image href="${opts.backgroundImage}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity="0.28"/>` : ''}
<rect width="${W}" height="${H}" fill="url(#glowA)"/><rect width="${W}" height="${H}" fill="url(#glowB)"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect x="58" y="30" width="38" height="38" rx="10" fill="url(#accent)"/>
<path d="M67 46 L77 41 L87 46 L77 51 Z M71 48 L71 55 Q77 59 83 55 L83 48" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
<text x="110" y="56" font-size="16" font-weight="700" letter-spacing="2.4" fill="#c7d2fe">${esc(fitEyebrow(opts.eyebrow, count))}</text>
${dots}
<text x="1222" y="54" font-size="16" font-weight="700" fill="#ffffff" fill-opacity="0.7" text-anchor="end">${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}</text>
<rect x="90" y="140" width="52" height="3" rx="1.5" fill="url(#accent)"/>
<text x="156" y="147" font-size="16" font-weight="700" letter-spacing="3" fill="${b}">${scene.kicker ? esc(String(scene.kicker).toUpperCase()) : `PART ${String(index + 1).padStart(2, '0')}`}</text>
${source ? `<text x="270" y="147" font-size="16" fill="#ffffff" fill-opacity="0.6">${esc(source.length > 70 ? `${source.slice(0, 69)}…` : source)}</text>` : ''}
${textLines(titleLines, 90, 214, 48, 56, 'font-weight="800" fill="#ffffff"')}
${body(scene, shown, box, accent)}
${presenter ? teacher(accent, !!opts.mouthOpen) : ''}
${caption.length ? `<rect x="${(presenter ? 60 : 80)}" y="${H - 72 - caption.length * 32}" width="${captionW}" height="${caption.length * 32 + 26}" rx="12" fill="#000000" fill-opacity="0.62"/>
${caption.map((l, i) => `<text x="${(presenter ? 60 : 80) + captionW / 2}" y="${H - 72 - caption.length * 32 + 34 + i * 32}" font-size="24" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(l)}</text>`).join('')}` : ''}
</svg>`;
}
