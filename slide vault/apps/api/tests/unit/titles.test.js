import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isGenericName,
  validateTitle,
  titleFromFileName,
} from '../../src/integrations/dropbox/genericNames.js';
import { TitleResolver } from '../../src/services/title-resolution/TitleResolver.js';
import { NullAiProvider } from '../../src/services/document-analysis/AiProvider.js';

test('isGenericName catches the names tools generate', () => {
  for (const name of [
    'Untitled.pptx',
    'Untitled (1).pptx',
    'Untitled (12).pptx',
    'Presentation1.pptx',
    'Presentation 2.pptx',
    'Copy of Presentation.pptx',
    'New Presentation.pptx',
    'Deck.pptx',
    'Slides.pdf',
    '2024-03-11.pdf',
    'a1b2c3d4e5f60718.pdf',
    '550e8400-e29b-41d4-a716-446655440000.pptx',
    'Gamma.pptx',
    'image_01.png',
    'ab.pdf',
  ]) {
    assert.equal(isGenericName(name), true, `expected "${name}" to be generic`);
  }
});

test('isGenericName leaves real titles alone', () => {
  for (const name of [
    'Autonomous Sustainable Infrastructure Platform.pptx',
    'Q3 Revenue Review.pdf',
    'Onboarding Handbook.html',
    'Presentation Skills Workshop.pptx',
    'Deck Design Guidelines.pptx',
    'Copy Editing Standards.pdf',
  ]) {
    assert.equal(isGenericName(name), false, `expected "${name}" to be meaningful`);
  }
});

test('validateTitle accepts a good title and strips decoration', () => {
  assert.deepEqual(validateTitle('"Autonomous Infrastructure Platform"'), {
    ok: true,
    title: 'Autonomous Infrastructure Platform',
  });
  assert.deepEqual(validateTitle('Title: Q3 Revenue Review'), {
    ok: true,
    title: 'Q3 Revenue Review',
  });
  assert.deepEqual(validateTitle('  Onboarding   Handbook  '), {
    ok: true,
    title: 'Onboarding Handbook',
  });
});

test('validateTitle rejects titles that are no better than the filename', () => {
  const cases = {
    '': 'empty',
    'ab': 'too_short',
    Untitled: 'generic',
    Presentation: 'generic',
    'Slide 1': 'generic',
    'No Title': 'generic',
    'I cannot determine the title from this image.': 'refusal',
    'Based on the slide, the presentation appears to cover revenue.': 'refusal',
    '12345': 'no_letters',
  };
  for (const [input, reason] of Object.entries(cases)) {
    const verdict = validateTitle(input);
    assert.equal(verdict.ok, false, `expected "${input}" to be rejected`);
    assert.equal(verdict.reason, reason, `wrong reason for "${input}"`);
  }
});

test('validateTitle rejects a whole sentence masquerading as a title', () => {
  const verdict = validateTitle(
    'This presentation covers the quarterly results for the engineering organisation and the plans for next year'
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'too_long');
});

test('validateTitle rejects a title identical to the filename it would replace', () => {
  const verdict = validateTitle('Quarterly Review', { originalName: 'Quarterly Review.pptx' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'unchanged');
});

test('titleFromFileName tidies separators without destroying words', () => {
  assert.equal(titleFromFileName('q3_revenue_review.pptx'), 'q3 revenue review');
  assert.equal(titleFromFileName('Well-Known Brand.pdf'), 'Well Known Brand');
  assert.equal(titleFromFileName('Untitled.pptx'), 'Untitled');
});

/* ------------------------------------------------------------ resolver -- */

const resolver = (ai = new NullAiProvider()) => new TitleResolver({ ai, visionEnabled: true });

test('the resolver prefers the document metadata title', async () => {
  const result = await resolver().resolve(
    { title: 'Autonomous Infrastructure Platform', lines: ['Something else'], text: 'body' },
    { fileName: 'Untitled (3).pptx' }
  );
  assert.equal(result.title, 'Autonomous Infrastructure Platform');
  assert.equal(result.source, 'metadata');
});

test('the resolver falls back to the first meaningful line', async () => {
  const result = await resolver().resolve(
    { title: '', lines: ['CONFIDENTIAL', '2024', 'Zero Trust Network Architecture'], text: 'body' },
    { fileName: 'Untitled.pptx' }
  );
  assert.equal(result.title, 'Zero Trust Network Architecture');
  assert.equal(result.source, 'text');
});

test('the resolver asks the model when the text yields nothing usable', async () => {
  const ai = {
    available: true,
    complete: async () => 'Platform Reliability Review',
    completeWithImage: async () => '',
  };
  const result = await resolver(ai).resolve(
    { title: '', lines: ['Agenda'], text: 'slide body text goes here' },
    { fileName: 'Untitled.pptx' }
  );
  assert.equal(result.title, 'Platform Reliability Review');
  assert.equal(result.source, 'ai_text');
});

test('the resolver uses vision for an image-only deck', async () => {
  const ai = {
    available: true,
    complete: async () => 'UNKNOWN',
    completeWithImage: async () => 'Autonomous Sustainable Infrastructure Platform',
  };
  const result = await resolver(ai).resolve(
    { title: '', lines: [], text: '', images: [{ mediaType: 'image/png', data: Buffer.from('x') }] },
    { fileName: 'Untitled (12).pptx' }
  );
  assert.equal(result.title, 'Autonomous Sustainable Infrastructure Platform');
  assert.equal(result.source, 'ai_vision');
});

test('the resolver keeps the filename rather than accept a bad generated title', async () => {
  const ai = {
    available: true,
    complete: async () => 'Untitled',
    completeWithImage: async () => 'I cannot read this image.',
  };
  const result = await resolver(ai).resolve(
    { title: '', lines: [], text: 'some text', images: [{ mediaType: 'image/png', data: Buffer.from('x') }] },
    { fileName: 'Untitled (12).pptx' }
  );
  assert.equal(result.source, 'filename');
  assert.equal(result.title, 'Untitled (12)');
});

test('needsResolution reprocesses a still-generic title even when nothing changed', () => {
  assert.equal(
    TitleResolver.needsResolution({
      fileName: 'Untitled.pptx',
      currentTitle: 'Untitled',
      titleSource: 'filename',
    }),
    true
  );
  assert.equal(
    TitleResolver.needsResolution({
      fileName: 'Untitled.pptx',
      currentTitle: 'Zero Trust Architecture',
      titleSource: 'ai_vision',
    }),
    false
  );
  assert.equal(
    TitleResolver.needsResolution({
      fileName: 'Q3 Review.pptx',
      currentTitle: 'Q3 Review',
      titleSource: 'filename',
    }),
    false
  );
});
