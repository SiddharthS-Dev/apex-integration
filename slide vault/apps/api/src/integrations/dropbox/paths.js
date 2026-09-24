/**
 * Dropbox path handling.
 *
 * Dropbox is strict: a path is either "" (the account root) or an absolute
 * path with no trailing slash. Everything that reaches the API goes through
 * normalizePath first, and everything that comes *from* a user — a folder the
 * admin typed, a path in a callback — goes through assertSafePath as well.
 *
 * The one rule that constrains the implementation: never silently rewrite a
 * legitimate folder name. "  My Deck  / 2024 " must normalize to
 * "/My Deck/2024", not to "/MyDeck/2024".
 */
import { DropboxInvalidPathError } from './errors.js';

/**
 * Canonical form: leading slash, no trailing slash, no duplicate separators,
 * surrounding whitespace on each segment trimmed. The account root is "".
 *
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function normalizePath(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw === '/') return '';

  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) return '';
  return `/${segments.join('/')}`;
}

/** Lowercased form, for the case-insensitive comparisons Dropbox itself uses. */
export function normalizeForCompare(input) {
  return normalizePath(input).toLowerCase();
}

/**
 * Rejects paths that are not safe to send to Dropbox.
 *
 * Traversal is the important one: "/Decks/../../Private" would let an admin —
 * or anything that can reach the folder endpoint — escape the configured root.
 * Dropbox would resolve it server-side, so it must never be sent.
 */
export function assertSafePath(input, { field = 'path' } = {}) {
  const path = normalizePath(input);
  if (!path) return '';

  if (path.length > 700) {
    throw new DropboxInvalidPathError(`${field} is longer than Dropbox allows.`);
  }
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new DropboxInvalidPathError(`${field} may not contain relative path segments.`);
  }
  // Control characters and the characters Dropbox rejects outright.
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new DropboxInvalidPathError(`${field} contains control characters.`);
  }
  if (/[\\:?*<>"|]/.test(path)) {
    throw new DropboxInvalidPathError(`${field} contains characters Dropbox does not allow.`);
  }
  return path;
}

/** True when `child` is `root` or sits underneath it. Case-insensitive. */
export function isWithinRoot(child, root) {
  const normalizedRoot = normalizeForCompare(root);
  if (!normalizedRoot) return true; // whole account is the root
  const normalizedChild = normalizeForCompare(child);
  return normalizedChild === normalizedRoot || normalizedChild.startsWith(`${normalizedRoot}/`);
}

/** Joins a folder and a name into a normalized absolute path. */
export function joinPath(folder, name) {
  const base = normalizePath(folder);
  const leaf = String(name ?? '').trim();
  if (!leaf) return base;
  return normalizePath(`${base}/${leaf}`);
}

/** The folder containing `path` ("" when `path` is a top-level entry). */
export function parentOf(path) {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '' : normalized.slice(0, index);
}

/** The final segment of a path. */
export function basename(path) {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Lowercased extension without the dot, or "" when there is none. */
export function extensionOf(name) {
  const leaf = basename(name) || String(name ?? '');
  const index = leaf.lastIndexOf('.');
  if (index <= 0) return '';
  return leaf.slice(index + 1).toLowerCase();
}

/** Filename without its extension. */
export function stripExtension(name) {
  const leaf = String(name ?? '');
  const index = leaf.lastIndexOf('.');
  return index <= 0 ? leaf : leaf.slice(0, index);
}

/**
 * Makes a title usable as a Dropbox filename.
 *
 * Only characters Dropbox actually rejects are replaced — an aggressive
 * slugifier would turn "Q3: Revenue & Growth" into something unrecognisable.
 */
export function toSafeFileName(title, extension) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:?*<>"|]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180)
    .trim();

  const base = cleaned || 'Untitled';
  return extension ? `${base}.${extension}` : base;
}

/**
 * Deterministic collision suffixes: "Name.pptx", "Name (1).pptx", …
 * Mirrors what Dropbox and Windows do, so the result looks unremarkable.
 */
export function withCollisionSuffix(fileName, index) {
  if (index <= 0) return fileName;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName} (${index})`;
  return `${fileName.slice(0, dot)} (${index})${fileName.slice(dot)}`;
}
