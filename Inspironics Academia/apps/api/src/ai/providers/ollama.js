import { config } from '../../config.js';
import { postJson } from './http.js';

// Ollama (optional): a model served by your own Ollama server (OLLAMA_BASE_URL, OLLAMA_MODEL), e.g.
// on a GPU machine on the network. Structured output via Ollama's `format` (a JSON schema). Not meant
// for this laptop: local inference needs far more memory than it has.

export default {
  name: 'ollama',
  ready: () => !!(config.ai.ollama.baseUrl && config.ai.ollama.model),
  model: () => config.ai.ollama.model,

  async generate({ system, prompt, schema, maxTokens = 32000, images = [] }) {
    const { baseUrl, model } = config.ai.ollama;
    const data = await postJson(`${baseUrl}/api/chat`, {
      model,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt, ...(images.length ? { images: images.map((i) => i.base64) } : {}) },
      ],
      ...(schema ? { format: schema } : {}),
      options: { num_predict: maxTokens },
    }, { label: 'Ollama' });
    return {
      text: data.message?.content || '',
      usage: { input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0 },
      model: data.model || model,
    };
  },
};
