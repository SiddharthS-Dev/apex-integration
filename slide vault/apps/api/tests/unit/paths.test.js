import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSafePath,
  basename,
  extensionOf,
  isWithinRoot,
  joinPath,
  normalizePath,
  parentOf,
  stripExtension,
  toSafeFileName,
  withCollisionSuffix,
} from '../../src/integrations/dropbox/paths.js';
import { DropboxInvalidPathError } from '../../src/integrations/dropbox/errors.js';

test('normalizePath produces the canonical Dropbox form', () => {
  assert.equal(normalizePath('IIPL / App / SlidesVault'), '/IIPL/App/SlidesVault');
  assert.equal(normalizePath('/IIPL/App/SlidesVault/'), '/IIPL/App/SlidesVault');
  assert.equal(normalizePath('/IIPL/App/SlidesVault'), '/IIPL/App/SlidesVault');
  assert.equal(normalizePath('IIPL//App///SlidesVault'), '/IIPL/App/SlidesVault');
});

test('normalizePath maps every spelling of the account root to ""', () => {
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath('/'), '');
  assert.equal(normalizePath('   '), '');
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(undefined), '');
});

test('normalizePath does not mangle legitimate folder names', () => {
  // Spaces, dots, ampersands and unicode are all legal in Dropbox names, and a
  // normalizer that "cleans" them would point the sync at a folder that does
  // not exist.
  assert.equal(normalizePath('/Q3 2024 & Beyond'), '/Q3 2024 & Beyond');
  assert.equal(normalizePath('/R&D/v1.2 final'), '/R&D/v1.2 final');
  assert.equal(normalizePath('/Übersicht/Präsentationen'), '/Übersicht/Präsentationen');
});

test('assertSafePath rejects traversal', () => {
  assert.throws(() => assertSafePath('/Decks/../../Private'), DropboxInvalidPathError);
  assert.throws(() => assertSafePath('/Decks/./Secret'), DropboxInvalidPathError);
  assert.throws(() => assertSafePath('..'), DropboxInvalidPathError);
});

test('assertSafePath rejects control characters and illegal characters', () => {
  assert.throws(() => assertSafePath('/Decks/bad\u0000name'), DropboxInvalidPathError);
  assert.throws(() => assertSafePath('/Decks/a:b'), DropboxInvalidPathError);
  assert.throws(() => assertSafePath('/Decks/a|b'), DropboxInvalidPathError);
  assert.throws(() => assertSafePath('/Decks/'.padEnd(800, 'x')), DropboxInvalidPathError);
});

test('assertSafePath passes normal paths through unchanged', () => {
  assert.equal(assertSafePath(' /Engineering/Decks/ '), '/Engineering/Decks');
  assert.equal(assertSafePath(''), '');
});

test('isWithinRoot contains the root and its descendants only', () => {
  assert.equal(isWithinRoot('/A/B/c.pptx', '/A'), true);
  assert.equal(isWithinRoot('/A', '/A'), true);
  assert.equal(isWithinRoot('/AB/c.pptx', '/A'), false, 'a prefix match is not containment');
  assert.equal(isWithinRoot('/B/c.pptx', '/A'), false);
  assert.equal(isWithinRoot('/anything', ''), true, 'an empty root is the whole account');
});

test('path decomposition helpers', () => {
  assert.equal(parentOf('/A/B/c.pptx'), '/A/B');
  assert.equal(parentOf('/c.pptx'), '');
  assert.equal(basename('/A/B/c.pptx'), 'c.pptx');
  assert.equal(extensionOf('Deck.FINAL.PPTX'), 'pptx');
  assert.equal(extensionOf('noextension'), '');
  assert.equal(extensionOf('.hidden'), '', 'a dotfile has no extension');
  assert.equal(stripExtension('Deck.pptx'), 'Deck');
  assert.equal(joinPath('/A/B', 'c.pptx'), '/A/B/c.pptx');
  assert.equal(joinPath('', 'c.pptx'), '/c.pptx');
});

test('toSafeFileName replaces only what Dropbox rejects', () => {
  assert.equal(toSafeFileName('Q3: Revenue & Growth', 'pptx'), 'Q3- Revenue & Growth.pptx');
  assert.equal(toSafeFileName('A/B\\C', 'pdf'), 'A-B-C.pdf');
  assert.equal(toSafeFileName('  spaced  out  ', 'pptx'), 'spaced out.pptx');
  assert.equal(toSafeFileName('', 'pptx'), 'Untitled.pptx');
  assert.equal(toSafeFileName('...', 'pptx'), 'Untitled.pptx');
});

test('withCollisionSuffix mirrors what Dropbox and Windows do', () => {
  assert.equal(withCollisionSuffix('Architecture.pptx', 0), 'Architecture.pptx');
  assert.equal(withCollisionSuffix('Architecture.pptx', 1), 'Architecture (1).pptx');
  assert.equal(withCollisionSuffix('Architecture.pptx', 12), 'Architecture (12).pptx');
  assert.equal(withCollisionSuffix('README', 1), 'README (1)');
});
