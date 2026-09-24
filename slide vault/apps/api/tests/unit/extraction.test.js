import test from 'node:test';
import assert from 'node:assert/strict';

import { ContentExtractionService } from '../../src/services/content-extraction/ContentExtractionService.js';
import { textRunsFromSlideXml } from '../../src/services/content-extraction/pptx.js';
import { extractHtml } from '../../src/services/content-extraction/html.js';
import { decodePdfString, scanDocumentInfo } from '../../src/services/content-extraction/pdf.js';
import { parseJsonObject } from '../../src/services/document-analysis/DocumentAnalysisService.js';
import { buildPptx } from '../helpers/fakeDropbox.js';

const extraction = new ContentExtractionService();

/* ------------------------------------------------------------------ pptx */

test('slide XML text runs are read in document order', () => {
  const xml =
    '<p:sld><a:p><a:r><a:t>Zero Trust</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>Network Architecture</a:t></a:r></a:p></p:sld>';
  assert.deepEqual(textRunsFromSlideXml(xml), ['Zero Trust', 'Network Architecture']);
});

test('slide XML entities are decoded', () => {
  const xml = '<a:t>R&amp;D &lt;Roadmap&gt; &#8212; 2024</a:t>';
  assert.deepEqual(textRunsFromSlideXml(xml), ['R&D <Roadmap> — 2024']);
});

test('a pptx yields its slides in numeric order, not lexicographic', async () => {
  const slides = Array.from({ length: 12 }, (_, index) => [`Slide ${index + 1}`]);
  const buffer = await buildPptx({ slides, title: '' });

  const document = await extraction.extract(buffer, { extension: 'pptx', name: 'deck.pptx' });

  assert.equal(document.slideCount, 12);
  // slide10 must not sort before slide2.
  assert.deepEqual(
    document.slides.map((slide) => slide.text),
    slides.map(([text]) => text)
  );
});

test('a pptx exposes its core properties and first-slide lines', async () => {
  const buffer = await buildPptx({
    slides: [['Platform Reliability Review', 'Engineering'], ['Agenda']],
    title: 'Platform Reliability Review 2024',
  });

  const document = await extraction.extract(buffer, { extension: 'pptx', name: 'Untitled.pptx' });

  assert.equal(document.title, 'Platform Reliability Review 2024');
  assert.equal(document.metadata.author, 'Test Author');
  assert.deepEqual(document.lines, ['Platform Reliability Review', 'Engineering']);
  assert.equal(document.isImageOnly, false);
});

test('an image-only pptx is detected and its slide image extracted', async () => {
  // A deck whose slides are pictures — Gamma, Canva, "export as images".
  const image = Buffer.from('89504E470D0A1A0A' + '00'.repeat(200), 'hex');
  const buffer = await buildPptx({ slides: [[]], title: '', image });

  const document = await extraction.extract(buffer, { extension: 'pptx', name: 'Untitled (12).pptx' });

  assert.equal(document.isImageOnly, true, 'a deck with no text runs is image-only');
  assert.equal(document.images.length, 1);
  assert.equal(document.images[0].mediaType, 'image/png');
  assert.ok(document.images[0].data.length > 0);
});

test('a corrupt file degrades instead of throwing', async () => {
  const document = await extraction.extract(Buffer.from('not a zip at all'), {
    extension: 'pptx',
    name: 'broken.pptx',
  });
  assert.equal(document.title, '');
  assert.ok(document.metadata.extractionError, 'the failure is recorded, not raised');
});

/* ------------------------------------------------------------------ html */

test('html extraction prefers og:title and ignores script and style', () => {
  const parsed = extractHtml(`
    <html><head>
      <title>Fallback Title</title>
      <meta property="og:title" content="Sustainable Infrastructure Platform">
      <style>h1 { color: red }</style>
      <script>var secret = "should not appear";</script>
    </head><body>
      <h1>Sustainable Infrastructure Platform</h1>
      <p>Body copy here.</p>
    </body></html>`);

  assert.equal(parsed.metadata.title, 'Sustainable Infrastructure Platform');
  assert.equal(parsed.metadata.documentTitle, 'Fallback Title');
  assert.doesNotMatch(parsed.text, /should not appear/);
  assert.doesNotMatch(parsed.text, /color: red/);
  assert.equal(parsed.headings[0].text, 'Sustainable Infrastructure Platform');
});

test('html block boundaries become line breaks', () => {
  const parsed = extractHtml('<p>First block</p><p>Second block</p>');
  assert.deepEqual(parsed.lines, ['First block', 'Second block']);
});

test('the extraction service routes html through the html extractor', async () => {
  const document = await extraction.extract(Buffer.from('<html><title>Onboarding</title><h1>Onboarding Handbook</h1></html>'), {
    extension: 'html',
    name: 'untitled.html',
  });
  assert.equal(document.title, 'Onboarding');
  assert.deepEqual(document.lines, ['Onboarding Handbook']);
});

/* ------------------------------------------------------------------- pdf */

test('PDF literal and hex strings decode, including UTF-16', () => {
  assert.equal(decodePdfString('(Quarterly Review)'), 'Quarterly Review');
  assert.equal(decodePdfString('(Escaped \\(parens\\))'), 'Escaped (parens)');
  assert.equal(decodePdfString('<FEFF00510033>'), 'Q3');
});

test('a PDF /Title is recovered from the raw bytes', () => {
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
      'trailer\n<< /Info << /Title (Autonomous Infrastructure Platform) /Author (Avery Raman) >> >>\n%%EOF'
  );
  const info = scanDocumentInfo(pdf);
  assert.equal(info.title, 'Autonomous Infrastructure Platform');
  assert.equal(info.author, 'Avery Raman');
});

test('the extraction service reads a PDF title even without pdfjs installed', async () => {
  const pdf = Buffer.from('%PDF-1.4\ntrailer\n<< /Info << /Title (Zero Trust Architecture) >> >>\n%%EOF');
  const document = await extraction.extract(pdf, { extension: 'pdf', name: 'Untitled (3).pdf' });
  assert.equal(document.title, 'Zero Trust Architecture');
});

/* ----------------------------------------------------- model JSON parsing */

test('parseJsonObject recovers JSON from a fenced or chatty reply', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.equal(parseJsonObject('no json here'), null);
  assert.equal(parseJsonObject('[1,2,3]'), null, 'an array is not the object shape we asked for');
});
