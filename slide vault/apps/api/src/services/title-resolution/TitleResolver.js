/**
 * Title resolution.
 *
 * A Dropbox filename is not a title. "Untitled (12).pptx" is what a deck is
 * called when nobody named it, and a library full of those is unusable.
 *
 * The pipeline, cheapest and most trustworthy first:
 *
 *   1. the file's own metadata title (dc:title, PDF /Title, <title>)
 *   2. the first meaningful line of extracted text
 *   3. an AI pass over the extracted text
 *   4. an AI vision pass over the title-slide image  <- image-only decks
 *   5. the tidied filename
 *
 * Every candidate must clear validateTitle() before it is accepted: a bad
 * generated title is worse than the honest filename it would replace (§37).
 */
import {
  validateTitle,
  titleFromFileName,
  isGenericName,
  MAX_TITLE_WORDS,
} from '../../integrations/dropbox/genericNames.js';
import { M } from '../metrics/metrics.js';

const TITLE_SYSTEM =
  'You extract the title of a presentation or document. ' +
  'Reply with the title only — no quotes, no preamble, no explanation, no trailing punctuation. ' +
  'Use the wording that appears in the document; do not invent or embellish. ' +
  'Ignore page numbers, dates, company footers, speaker names and boilerplate, unless the ' +
  'company name is genuinely part of the title. ' +
  'If no title can be determined from what you were given, reply with exactly: UNKNOWN';

const VISION_SYSTEM =
  'You are looking at the title slide of a presentation. ' +
  'Read the largest, most prominent heading and reply with it only — no quotes, no preamble, ' +
  'no description of the image. ' +
  'Ignore decorative text, logos, slide numbers, dates and footers unless the company name is ' +
  'genuinely part of the title. ' +
  'Do not guess at text you cannot read. If there is no readable title, reply with exactly: UNKNOWN';

/** Lines that are never a title, however prominent they look. */
const BOILERPLATE = [
  /^(confidential|internal use only|proprietary|draft|agenda|contents|table of contents)$/i,
  /^(page\s*)?\d+$/i,
  /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/,
  /^(q[1-4]\s*)?\d{4}$/i,
  /^(www\.|https?:)/i,
  /^[\W_]+$/,
];

const looksLikeBoilerplate = (line) => BOILERPLATE.some((pattern) => pattern.test(line.trim()));

export class TitleResolver {
  /** @param {{ai: import('../document-analysis/AiProvider.js').AiProvider}} deps */
  constructor({ ai, logger, metrics, visionEnabled = true }) {
    this.ai = ai;
    this.logger = logger?.child?.({ component: 'TitleResolver' }) ?? logger;
    this.metrics = metrics;
    this.visionEnabled = visionEnabled;
  }

  /**
   * @param {import('../content-extraction/ContentExtractionService.js').NormalizedDocument} document
   * @param {{fileName: string, images?: Array<{mediaType: string, data: Buffer}>,
   *          allowAi?: boolean}} context
   * @returns {Promise<{title: string, source: string, confidence: number}>}
   */
  async resolve(document, { fileName, images = [], allowAi } = {}) {
    const started = process.hrtime.bigint();

    /**
     * The model is only worth asking when the filename carries no information.
     *
     * Two reasons, and the second is the important one: running vision over
     * every file in a ten-thousand-deck library is ruinously expensive, and a
     * generated title that *replaces* a perfectly good filename is a downgrade
     * the user never asked for. A meaningful name stays unless the file's own
     * metadata or text offers something better.
     */
    const aiAllowed = allowAi ?? isGenericName(fileName);
    const record = (source, title, confidence) => {
      this.metrics?.increment(M.titleResolution, { source, outcome: title ? 'resolved' : 'fallback' });
      this.metrics?.observe(M.titleLatency, Number(process.hrtime.bigint() - started) / 1e9, { source });
      return { title, source, confidence };
    };

    /* 1 — the document's own metadata */
    const embedded = validateTitle(document?.title ?? '', { originalName: fileName });
    if (embedded.ok) return record('metadata', embedded.title, 0.9);

    /* 2 — the first meaningful line of text */
    const heading = this.#firstMeaningfulLine(document);
    if (heading) {
      const verdict = validateTitle(heading, { originalName: fileName });
      if (verdict.ok) return record('text', verdict.title, 0.75);
    }

    /* 3 — AI over the extracted text */
    const text = (document?.text ?? '').trim();
    if (aiAllowed && this.ai?.available && text) {
      const candidate = await this.#askText(document);
      const verdict = validateTitle(candidate, { originalName: fileName });
      if (verdict.ok) return record('ai_text', verdict.title, 0.7);
    }

    /* 4 — vision over the title slide, for decks whose text is pixels */
    const candidateImages = images.length ? images : (document?.images ?? []);
    if (aiAllowed && this.visionEnabled && this.ai?.available && candidateImages.length) {
      const candidate = await this.#askVision(candidateImages[0], fileName);
      const verdict = validateTitle(candidate, { originalName: fileName });
      if (verdict.ok) return record('ai_vision', verdict.title, 0.65);
    }

    /* 5 — the filename, tidied. Honest, and never misleading. */
    return record('filename', titleFromFileName(fileName), isGenericName(fileName) ? 0.1 : 0.5);
  }

  /** True when this file is worth running the pipeline over at all. */
  static needsResolution({ fileName, currentTitle, titleSource }) {
    if (!currentTitle) return true;
    // A title that is still just a generic filename should be retried even
    // when the file itself has not changed (spec §25).
    if (titleSource === 'filename' && isGenericName(currentTitle)) return true;
    return isGenericName(fileName) && titleSource === 'filename';
  }

  #firstMeaningfulLine(document) {
    const lines = [...(document?.lines ?? [])];
    // A deck's first slide often starts with a kicker ("Q3 2024") above the
    // real title, so take the first line that is neither boilerplate nor a
    // fragment, rather than blindly taking lines[0].
    for (const line of lines.slice(0, 8)) {
      const trimmed = String(line ?? '').replace(/\s+/g, ' ').trim();
      if (trimmed.length < 4 || trimmed.length > 160) continue;
      if (looksLikeBoilerplate(trimmed)) continue;
      if (trimmed.split(/\s+/).length > MAX_TITLE_WORDS) continue;
      return trimmed;
    }
    return '';
  }

  async #askText(document) {
    const firstSlide = document.slides?.[0]?.text ?? '';
    const excerpt = (firstSlide || document.text || '').slice(0, 3000);
    try {
      return await this.ai.complete({
        system: TITLE_SYSTEM,
        prompt:
          'Here is the text from the opening of a presentation or document.\n\n' +
          `---\n${excerpt}\n---\n\n` +
          'What is its title?',
        maxTokens: 64,
      });
    } catch (error) {
      this.logger?.warn?.('AI title extraction failed', { error: error.message });
      return '';
    }
  }

  async #askVision(image, fileName) {
    try {
      return await this.ai.completeWithImage({
        system: VISION_SYSTEM,
        prompt:
          'This is the first slide of a presentation whose filename is ' +
          `"${fileName}", which carries no meaning. What is the presentation's title?`,
        image,
        maxTokens: 64,
      });
    } catch (error) {
      this.logger?.warn?.('Vision title extraction failed', { error: error.message });
      return '';
    }
  }
}
