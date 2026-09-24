/**
 * What the sync indexes, and how each kind is served back.
 *
 * `kind` picks the pipeline branch: an image is its own preview and its own
 * vision input; a document needs text extraction first.
 */
export const FILE_TYPES = {
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  pptx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  html: { kind: 'document', mime: 'text/html' },
}

export const SUPPORTED_EXTENSIONS = Object.keys(FILE_TYPES)

/** Lower-case extension without the dot, or '' for none. */
export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

export const isSupported = (name) => Object.hasOwn(FILE_TYPES, extensionOf(name))

export const fileTypeOf = (name) => FILE_TYPES[extensionOf(name)] || null
