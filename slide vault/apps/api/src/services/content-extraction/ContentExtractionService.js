/**
 * Content extraction: bytes in, NormalizedDocument out.
 *
 * Deliberately free of AI and of Dropbox. It knows file formats and nothing
 * else, which is what lets the title resolver and the classifier be written
 * once against one shape regardless of where the file came from (spec §61/§62).
 *
 *   File -> Extractor -> NormalizedDocument -> AI
 */
import { extractPptx } from './pptx.js';
import { extractPdf } from './pdf.js';
import { extractHtml } from './html.js';

/**
 * @typedef {object} NormalizedDocument
 * @property {string} title       best title found in the file's own metadata
 * @property {string} text        readable text, truncated
 * @property {string[]} lines     the leading lines, in reading order
 * @property {Array<{index: number, text: string}>} slides
 * @property {Array<{mediaType: string, data: Buffer, size: number}>} images
 * @property {object} metadata
 * @property {{provider: string, externalId: string, path: string}} source
 */

export class ContentExtractionService {
  constructor({ logger, maxTextLength = 20_000 } = {}) {
    this.logger = logger?.child?.({ component: 'ContentExtractionService' }) ?? logger;
    this.maxTextLength = maxTextLength;
  }

  /** Extensions this service can do anything useful with. */
  supports(extension) {
    return ['pptx', 'ppt', 'pdf', 'html', 'htm'].includes(String(extension ?? '').toLowerCase());
  }

  /**
   * @param {Buffer} buffer
   * @param {{extension: string, name?: string, source?: object}} descriptor
   * @returns {Promise<NormalizedDocument>}
   */
  async extract(buffer, { extension, name = '', source = {} }) {
    const format = String(extension ?? '').toLowerCase();

    const empty = {
      title: '',
      text: '',
      lines: [],
      slides: [],
      images: [],
      metadata: {},
      format,
      source: { provider: source.provider ?? '', externalId: source.externalId ?? '', path: source.path ?? '' },
    };

    try {
      if (format === 'pptx') return { ...empty, ...(await this.#pptx(buffer)) };
      if (format === 'pdf') return { ...empty, ...(await this.#pdf(buffer)) };
      if (format === 'html' || format === 'htm') return { ...empty, ...this.#html(buffer) };
      // .ppt is the legacy binary format; there is no pure-JS reader for it, so
      // it is indexed by metadata and handled by the image/vision path instead.
      return empty;
    } catch (error) {
      // A corrupt file must not abort a sync run — it is indexed with whatever
      // is known and reported in the sync log (spec §55).
      this.logger?.warn?.('Content extraction failed', { name, format, error: error.message });
      return { ...empty, metadata: { extractionError: error.message } };
    }
  }

  async #pptx(buffer) {
    const parsed = await extractPptx(buffer);

    const slides = parsed.slides.map((slide) => ({
      index: slide.index,
      text: slide.runs.join('\n'),
      runs: slide.runs,
    }));

    const text = slides
      .map((slide) => slide.text)
      .filter(Boolean)
      .join('\n\n')
      .slice(0, this.maxTextLength);

    return {
      title: parsed.metadata.title ?? '',
      text,
      // The first slide's runs are the strongest title signal in a deck.
      lines: slides[0]?.runs ?? [],
      slides,
      images: parsed.images,
      metadata: { ...parsed.metadata, slideCount: parsed.slideCount },
      slideCount: parsed.slideCount,
      /** True when the deck's slides are pictures, not text (spec §35). */
      isImageOnly: slides.every((slide) => !slide.text.trim()) && parsed.images.length > 0,
    };
  }

  async #pdf(buffer) {
    const parsed = await extractPdf(buffer);
    const lines = parsed.pages[0]?.lines ?? [];
    const text = parsed.pages
      .map((page) => page.lines.join('\n'))
      .join('\n\n')
      .slice(0, this.maxTextLength);

    return {
      title: parsed.metadata.title ?? '',
      text,
      lines,
      slides: parsed.pages.map((page) => ({ index: page.index, text: page.lines.join('\n'), runs: page.lines })),
      images: [],
      metadata: { ...parsed.metadata, extractor: parsed.extractor, pageCount: parsed.pageCount },
      slideCount: parsed.pageCount,
      isImageOnly: !text.trim(),
    };
  }

  #html(buffer) {
    const parsed = extractHtml(buffer, { maxTextLength: this.maxTextLength });
    return {
      title: parsed.metadata.title ?? '',
      text: parsed.text,
      lines: parsed.headings.length ? parsed.headings.map((heading) => heading.text) : parsed.lines.slice(0, 20),
      slides: [],
      images: [],
      metadata: parsed.metadata,
      slideCount: 0,
      isImageOnly: !parsed.text.trim(),
    };
  }
}
