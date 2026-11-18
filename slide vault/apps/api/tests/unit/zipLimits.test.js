/**
 * Zip-bomb and file-signature defences for .pptx/.ppt extraction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  ContentExtractionService,
  matchesSignature,
} from '../../src/services/content-extraction/ContentExtractionService.js';
import { extractPptx, inspectZip, ExtractionLimitError } from '../../src/services/content-extraction/pptx.js';
import { buildPptx } from '../helpers/fakeDropbox.js';

const MB = 1024 * 1024;

/** A deck whose first slide is `size` bytes of one character: tiny compressed, huge inflated. */
async function bombDeck(size) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/slides/slide1.xml', `<p:sld><a:t>${'a'.repeat(size)}</a:t></p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/** Rewrites every central-directory "uncompressed size" to `value` — a lying archive. */
function lieAboutSizes(buffer, value = 1) {
  const out = Buffer.from(buffer);
  for (let i = 0; i + 46 <= out.length; i += 1) {
    if (out.readUInt32LE(i) === 0x02014b50) out.writeUInt32LE(value, i + 24);
  }
  return out;
}

test('a real deck passes the archive inspection', async () => {
  const buffer = await buildPptx({ slides: [['Hello']] });
  const result = inspectZip(buffer, { maxEntries: 5000, maxUncompressedBytes: 300 * MB });
  assert.ok(result.entries > 0);
});

test('too many entries is refused before anything is inflated', async () => {
  const zip = new JSZip();
  for (let i = 0; i < 20; i += 1) zip.file(`ppt/media/f${i}.txt`, 'x');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  assert.throws(
    () => inspectZip(buffer, { maxEntries: 10, maxUncompressedBytes: 300 * MB }),
    (error) => error instanceof ExtractionLimitError && error.code === 'TOO_MANY_ENTRIES'
  );
});

test('a declared uncompressed total over the limit is refused', async () => {
  const buffer = await bombDeck(4 * MB);
  assert.ok(buffer.length < 200 * 1024, 'the bomb is small on disk');
  await assert.rejects(
    extractPptx(buffer, { maxUncompressedBytes: 1 * MB }),
    (error) => error instanceof ExtractionLimitError && error.code === 'TOO_LARGE_UNCOMPRESSED'
  );
});

test('an archive that lies about its sizes is stopped while inflating', async () => {
  const buffer = lieAboutSizes(await bombDeck(4 * MB));
  // The central directory now claims 1 byte per entry, so the up-front check passes...
  assert.doesNotThrow(() => inspectZip(buffer, { maxEntries: 5000, maxUncompressedBytes: 1 * MB }));
  // ...and the streaming budget catches the real size.
  await assert.rejects(
    extractPptx(buffer, { maxUncompressedBytes: 1 * MB }),
    (error) => error instanceof ExtractionLimitError && error.code === 'TOO_LARGE_UNCOMPRESSED'
  );
});

test('the service degrades a bomb to a metadata-only record instead of throwing', async () => {
  const service = new ContentExtractionService({ zipLimits: { maxUncompressedBytes: 1 * MB } });
  const document = await service.extract(await bombDeck(4 * MB), { extension: 'pptx', name: 'bomb.pptx' });
  assert.equal(document.slides.length, 0);
  assert.match(document.metadata.extractionError, /uncompressed/);
});

test('a non-ZIP archive is refused by the inspection', () => {
  assert.throws(
    () => inspectZip(Buffer.from('PK\x03\x04 but no directory'), { maxEntries: 10, maxUncompressedBytes: MB }),
    (error) => error.code === 'NOT_ZIP'
  );
});

/* ------------------------------------------------------------- signatures */

test('file signatures: pptx is a ZIP, ppt is an OLE compound file', () => {
  assert.equal(matchesSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), 'pptx'), true);
  assert.equal(matchesSignature(Buffer.from('%PDF-1.7'), 'pptx'), false);
  assert.equal(matchesSignature(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'ppt'), true);
  assert.equal(matchesSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'ppt'), false);
  assert.equal(matchesSignature(Buffer.alloc(2), 'ppt'), false, 'too short to carry the signature');
  assert.equal(matchesSignature(Buffer.from('anything'), 'html'), true, 'formats without a signature are not checked');
});

test('a .pptx whose bytes are not a ZIP is never parsed, and the reason is logged', async () => {
  const warnings = [];
  const logger = { warn: (message, fields) => warnings.push({ message, fields }) };
  const service = new ContentExtractionService({ logger });
  const document = await service.extract(Buffer.from('MZ\x90\x00 an executable renamed'), {
    extension: 'pptx',
    name: 'deck.pptx',
  });
  assert.match(document.metadata.extractionError, /signature mismatch/);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].fields.reason, 'signature_mismatch');
});

test('config reads the zip limits from the environment', async () => {
  const { testConfig } = await import('../helpers/testEnv.js');
  const cfg = testConfig({ PPTX_MAX_ZIP_ENTRIES: '42', PPTX_MAX_UNZIP_MB: '7' });
  assert.deepEqual({ ...cfg.extraction }, { maxEntries: 42, maxUncompressedBytes: 7 * MB });
});
