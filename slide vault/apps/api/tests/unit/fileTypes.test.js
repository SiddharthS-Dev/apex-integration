import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNCABLE_EXTENSIONS, isSyncable } from '@slidesvault/shared';
import { testConfig } from '../helpers/testEnv.js';

test('the library syncs PowerPoint only unless configured otherwise', () => {
  assert.deepEqual([...SYNCABLE_EXTENSIONS], ['pptx', 'ppt']);
  assert.ok(isSyncable('Board Review.PPTX'));
  assert.ok(!isSyncable('notes.pdf'));
  assert.ok(!isSyncable('export.html'));
  assert.deepEqual(testConfig({ DROPBOX_SUPPORTED_EXTENSIONS: '' }).sync.supportedExtensions, ['pptx', 'ppt']);
});
