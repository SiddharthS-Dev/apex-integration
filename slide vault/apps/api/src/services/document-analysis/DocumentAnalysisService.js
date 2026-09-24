/**
 * Classification of an extracted document.
 *
 * Kept separate from title resolution because they fail differently: a wrong
 * title is visible and damaging, a wrong tag is cosmetic. So this service is
 * allowed to return nothing at all and the sync carries on.
 */

import { DOMAIN_NAMES } from '@slidesvault/shared';

const SYSTEM =
  'You classify internal presentations for a company knowledge library. ' +
  'Reply with a single JSON object and nothing else — no prose, no code fences. ' +
  'Use only what the document actually says; leave a field empty rather than guessing.';

export class DocumentAnalysisService {
  /** @param {{ai: import('./AiProvider.js').AiProvider}} deps */
  constructor({ ai, logger, domains = DOMAIN_NAMES }) {
    this.ai = ai;
    this.logger = logger?.child?.({ component: 'DocumentAnalysisService' }) ?? logger;
    this.domains = domains;
  }

  get available() {
    return Boolean(this.ai?.available);
  }

  /**
   * @param {import('../content-extraction/ContentExtractionService.js').NormalizedDocument} document
   * @param {{title: string}} context
   * @returns {Promise<object|null>} null when classification was not possible
   */
  async classify(document, { title }) {
    const text = (document?.text ?? '').trim();
    if (!this.available || !text) return null;

    const prompt =
      `Title: ${title}\n\n` +
      `Content:\n---\n${text.slice(0, 8000)}\n---\n\n` +
      'Return JSON with exactly these keys:\n' +
      `{"primary_domain": one of ${JSON.stringify(this.domains)},\n` +
      ' "sub_domain": "2-4 words",\n' +
      ' "category": "1-3 words",\n' +
      ' "tags": ["3-6 short tags"],\n' +
      ' "keywords": ["5-10 keywords"],\n' +
      ' "learning_objectives": ["2-4 objectives, each one sentence"],\n' +
      ' "summary": "two sentences",\n' +
      ' "confidence": 0.0-1.0}';

    let raw = '';
    try {
      raw = await this.ai.complete({ system: SYSTEM, prompt, maxTokens: 800, effort: 'low' });
    } catch (error) {
      this.logger?.warn?.('Classification failed', { error: error.message });
      return null;
    }

    const parsed = parseJsonObject(raw);
    if (!parsed) return null;

    // A domain outside the library's five is dropped rather than stored: the
    // UI maps domains to colours and layouts, and an unknown one renders blank.
    const domain = this.domains.includes(parsed.primary_domain) ? parsed.primary_domain : '';

    return {
      primary_domain: domain,
      sub_domain: stringOf(parsed.sub_domain, 60),
      category: stringOf(parsed.category, 40),
      tags: arrayOf(parsed.tags, 6, 30),
      keywords: arrayOf(parsed.keywords, 10, 40),
      learning_objectives: arrayOf(parsed.learning_objectives, 4, 200),
      summary: stringOf(parsed.summary, 600),
      confidence: clamp(Number(parsed.confidence), 0, 1, 0.5),
    };
  }
}

/** Models sometimes wrap JSON in prose or a code fence; recover the object. */
export function parseJsonObject(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const stringOf = (value, maxLength) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';

const arrayOf = (value, maxItems, maxLength) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, maxLength))
        .slice(0, maxItems)
    : [];

const clamp = (value, min, max, fallback) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
