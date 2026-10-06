/**
 * HTTP byte ranges (RFC 9110 §14), for the endpoints that serve file bytes.
 *
 * A browser PDF viewer or <video> element asks for the part of a large file it
 * needs instead of the whole thing — the cross-reference table at the end of
 * a PDF, the next few seconds of an MP4. Without range support every one of
 * those becomes a full download.
 *
 * Only a single range is honoured. A multi-range request is legal but rare,
 * needs a multipart body, and a server may answer it with the whole
 * representation instead (§14.2) — which is what happens here.
 */
import { pipeline } from 'node:stream/promises';

/**
 * Parses a Range header against a known size.
 *
 * @returns {null | {start: number, end: number} | 'unsatisfiable'}
 *   null when the header is absent, malformed or multi-range (serve the whole
 *   file, 200); the inclusive byte range to serve (206); or 'unsatisfiable'
 *   (416).
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return null; // multi-range, other units, or garbage
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!Number.isFinite(size) || size < 0) return null;

  if (!rawStart) {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    if (size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (rawEnd && Number(rawEnd) < start) return null; // invalid: ignore the header
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

/** Writes the 416 answer for a range past the end of the file. */
export function sendUnsatisfiable(res, size) {
  res.status(416);
  res.setHeader('Content-Range', `bytes */${size}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.json({ error: 'The requested range is outside the file.' });
}

/**
 * Sets the status and headers for a full (200) or partial (206) body.
 * Content-Type and the rest are the caller's business.
 */
export function setRangeHeaders(res, { range, size }) {
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else if (Number.isFinite(size) && size > 0) {
    res.setHeader('Content-Length', String(size));
  }
}

/**
 * Cuts [start, end] (inclusive) out of a stream that begins at byte 0, as a
 * pipeline() stage.
 *
 * Used when the upstream could not serve the range itself. Returning from the
 * loop ends the iteration, which destroys the source — so a request for the
 * first page of a large file stops pulling as soon as it has it.
 */
export function sliceStream(start, end) {
  return async function* slice(source) {
    let position = 0;
    for await (const chunk of source) {
      const chunkStart = position;
      position += chunk.length;
      if (position - 1 < start) continue;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(chunk.length, end - chunkStart + 1);
      if (to > from) yield chunk.subarray(from, to);
      if (position - 1 >= end) return;
    }
  };
}

/** Parses an upstream "Content-Range: bytes s-e/total" header. */
export function parseContentRange(header) {
  const match = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(String(header ?? ''));
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    size: match[3] === '*' ? null : Number(match[3]),
  };
}

/**
 * Pipes a body to the response, through an optional stage.
 *
 * A client that goes away mid-body — a PDF viewer cancelling a range it no
 * longer needs, a closed tab — is routine, not a server fault, so that one
 * failure is swallowed instead of being logged as an error. Anything else
 * (a read error on the source) still rejects, and the error handler cuts the
 * half-sent response off.
 */
export async function streamBody(res, source, stage) {
  try {
    if (stage) await pipeline(source, stage, res);
    else await pipeline(source, res);
  } catch (error) {
    // Premature close is how pipeline() reports the *response* closing early;
    // a source failure carries its own code and is rethrown.
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    throw error;
  }
}
