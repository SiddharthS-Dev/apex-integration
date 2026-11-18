// Splits long narration into pieces a TTS API accepts (by UTF-8 bytes), only at sentence ends where
// possible, then at commas/spaces, preserving the order and every character.

export function chunkText(text, maxBytes) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  if (bytes(clean) <= maxBytes) return [clean];
  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [clean];
  const parts = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (const s of sentences) {
    if (bytes(cur + s) <= maxBytes) { cur += s; continue; }
    push();
    if (bytes(s) <= maxBytes) { cur = s; continue; }
    // A single sentence longer than the limit: split at commas, then at spaces.
    let piece = '';
    for (const word of s.split(/(?<=,)\s+|\s+/)) {
      if (bytes(`${piece} ${word}`) > maxBytes) { if (piece) parts.push(piece.trim()); piece = word; }
      else piece = piece ? `${piece} ${word}` : word;
    }
    cur = piece;
  }
  push();
  return parts;
}
