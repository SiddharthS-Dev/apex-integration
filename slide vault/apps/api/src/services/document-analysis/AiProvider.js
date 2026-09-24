/**
 * The AI seam.
 *
 * The document-analysis service is written against this interface, never
 * against a vendor SDK, so the AI layer can be swapped, disabled or stubbed
 * without touching the sync pipeline — and so the Dropbox client never grows
 * an AI dependency (spec §60).
 */

/* eslint-disable no-unused-vars */

export class AiProvider {
  get available() {
    return false;
  }

  /**
   * A single text completion.
   * @param {{system: string, prompt: string, maxTokens?: number}} request
   * @returns {Promise<string>}
   */
  async complete(request) {
    throw new Error('AiProvider.complete() must be implemented.');
  }

  /**
   * A completion that can see an image.
   * @param {{system: string, prompt: string, image: {mediaType: string, data: Buffer}}} request
   * @returns {Promise<string>}
   */
  async completeWithImage(request) {
    throw new Error('AiProvider.completeWithImage() must be implemented.');
  }
}

/** Used when AI is switched off or unconfigured: every call declines, loudly enough to log. */
export class NullAiProvider extends AiProvider {
  constructor(reason = 'AI is not configured.') {
    super();
    this.reason = reason;
  }

  get available() {
    return false;
  }

  async complete() {
    return '';
  }

  async completeWithImage() {
    return '';
  }
}
