/**
 * Claude-backed AI provider.
 *
 * Title resolution and classification are short, bounded tasks: a small
 * max_tokens, low effort, no streaming. Vision is used only when a document
 * has no extractable text — the image path costs meaningfully more, so it is a
 * fallback, never the first choice.
 *
 * The SDK is imported lazily so a deployment with AI_ENABLED=false does not
 * need the package at all.
 */
import { AiProvider } from './AiProvider.js';

export class AnthropicProvider extends AiProvider {
  #clientPromise = null;

  constructor({ apiKey, model = 'claude-opus-5', maxTokens = 1024, timeoutMs = 60_000, logger, metrics }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.timeoutMs = timeoutMs;
    this.logger = logger?.child?.({ component: 'AnthropicProvider' }) ?? logger;
    this.metrics = metrics;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async #client() {
    if (!this.available) return null;
    if (!this.#clientPromise) {
      this.#clientPromise = import('@anthropic-ai/sdk')
        .then(({ default: Anthropic }) => new Anthropic({ apiKey: this.apiKey, timeout: this.timeoutMs }))
        .catch((error) => {
          this.logger?.warn?.('The Anthropic SDK is not installed — AI features are disabled.', {
            error: error.message,
          });
          return null;
        });
    }
    return this.#clientPromise;
  }

  /** @param {{system: string, prompt: string, maxTokens?: number, effort?: string}} request */
  async complete({ system, prompt, maxTokens, effort = 'low' }) {
    const client = await this.#client();
    if (!client) return '';

    const response = await client.messages.create({
      model: this.model,
      max_tokens: maxTokens ?? this.maxTokens,
      // These are short extraction tasks; low effort is both faster and
      // cheaper, and the quality ceiling is set by the input, not by thinking.
      output_config: { effort },
      system,
      messages: [{ role: 'user', content: prompt }],
    });

    return textOf(response);
  }

  /** @param {{system: string, prompt: string, image: {mediaType: string, data: Buffer}}} request */
  async completeWithImage({ system, prompt, image, maxTokens, effort = 'low' }) {
    const client = await this.#client();
    if (!client || !image?.data?.length) return '';

    const response = await client.messages.create({
      model: this.model,
      max_tokens: maxTokens ?? this.maxTokens,
      output_config: { effort },
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType || 'image/jpeg',
                data: Buffer.from(image.data).toString('base64'),
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    return textOf(response);
  }
}

/**
 * Pulls the text out of a Messages response.
 *
 * `stop_reason` is checked first: a refusal or a truncation must not be read as
 * an answer, or a half-sentence ends up as a deck's title.
 */
function textOf(response) {
  if (!response) return '';
  if (response.stop_reason === 'refusal') return '';
  if (response.stop_reason === 'max_tokens') return '';
  return (response.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
