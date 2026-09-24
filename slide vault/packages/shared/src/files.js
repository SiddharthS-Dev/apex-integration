/**
 * File-type contracts.
 *
 * SYNCABLE_EXTENSIONS is the set the sync pipeline can actually ingest, and is
 * the default behind DROPBOX_SUPPORTED_EXTENSIONS on the API. DISPLAY_TYPES is
 * wider: the catalog can hold and badge a type that the current sync does not
 * fetch, so the two lists are related but deliberately not the same.
 */

/** Extensions the Dropbox sync will index. Mirrors the API's default. */
export const SYNCABLE_EXTENSIONS = Object.freeze(['pdf', 'pptx', 'ppt', 'html']);

/** Every type the catalog knows how to badge. */
export const DISPLAY_TYPES = Object.freeze(['pdf', 'pptx', 'ppt', 'html', 'docx', 'xlsx', 'mp4']);

/** The lowercase extension of a filename, without the dot. */
export function extensionOf(filename = '') {
  const dot = String(filename).lastIndexOf('.');
  return dot === -1 ? '' : String(filename).slice(dot + 1).toLowerCase();
}

/** True when the sync pipeline would pick this file up. */
export function isSyncable(filename) {
  return SYNCABLE_EXTENSIONS.includes(extensionOf(filename));
}
