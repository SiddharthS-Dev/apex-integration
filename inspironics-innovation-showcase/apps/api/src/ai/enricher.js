/**
 * The model call behind classification and the title fallback.
 *
 * One request per file: Claude sees the rendered thumbnail (when there is one)
 * plus whatever text was extracted, and answers with a JSON object constrained
 * by `output_config.format` — categories, technologies and products are enums
 * drawn from @inspironics/shared, so it cannot invent a category the gallery
 * has no pill for.
 *
 * Off unless AI_ENABLED=true and ANTHROPIC_API_KEY is set. When off, the
 * pipeline keeps metadata/filename titles and leaves files unclassified.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CATEGORY_NAMES, PRODUCTS, TECHS } from '@inspironics/shared'

/** Text beyond this is summarised by position, not sent whole: titles and themes live up front. */
const MAX_TEXT_CHARS = 24_000

const strArray = (description) => ({ type: 'array', items: { type: 'string' }, description })

export const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'category',
    'technologies',
    'products',
    'esg',
    'ai',
    'iot',
    'objective',
    'flow',
    'components',
    'architecture',
    'business_benefits',
    'technical_benefits',
    'takeaway',
    'keywords',
    'confidence',
  ],
  properties: {
    title: { type: 'string', description: 'The real title printed on the plate or deck, or a precise descriptive one. Never the filename.' },
    category: { type: 'string', enum: CATEGORY_NAMES },
    technologies: { type: 'array', items: { type: 'string', enum: TECHS } },
    products: { type: 'array', items: { type: 'string', enum: PRODUCTS.map((p) => p.key) } },
    esg: { type: 'boolean', description: 'Sustainability, carbon or ESG is a substantive theme.' },
    ai: { type: 'boolean', description: 'AI / ML / agentic systems are a substantive theme.' },
    iot: { type: 'boolean', description: 'IoT sensors, devices or edge hardware are a substantive theme.' },
    objective: { type: 'string', description: 'One sentence: what this plate is for.' },
    flow: strArray('3-6 short stage names describing the flow it depicts, in order.'),
    components: strArray('3-6 key components or building blocks shown.'),
    architecture: { type: 'string', description: 'One or two sentences on how it is structured visually or technically.' },
    business_benefits: strArray('2-4 short business benefits.'),
    technical_benefits: strArray('2-4 short technical benefits.'),
    takeaway: { type: 'string', description: 'One sentence a viewer should remember.' },
    keywords: strArray('5-12 search keywords, including any product or system names printed in the artwork.'),
    confidence: { type: 'number', description: '0 to 1: how sure you are of the category.' },
  },
}

const SYSTEM = `You catalogue Inspironics innovation material: architecture infographics, command-deck dashboards, value frameworks and presentation decks about smart infrastructure, sustainability and AI.

For each file you are given a rendered image and/or extracted text. Read any text printed in the image carefully — product names such as Caleido Kombos, Caleido Xenia, Caleido Domi, Caleido Mints and Cielo Epic often appear only inside the artwork.

Choose the single best category. Only list technologies and products that are genuinely present. Write in plain, specific business English. If the material is unreadable or off-topic, still answer, with a low confidence.`

export function createEnricher({ config, log, metrics, client }) {
  if (!config.ai.enabled) {
    return { enabled: false, async enrich() { return null } }
  }
  const anthropic = client || new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 3 })

  return {
    enabled: true,
    model: config.ai.model,

    /**
     * @param {{ filename: string, text?: string, image?: Buffer, hint?: string }} input
     * @returns {Promise<null | ReturnType<typeof normalise>>} null if the model declined
     */
    async enrich({ filename, text = '', image, hint = '' }) {
      const content = []
      if (image?.length) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } })
      }
      const body = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) + '\n[…text continues…]' : text
      content.push({
        type: 'text',
        text: [`Filename: ${filename}`, hint && `Context: ${hint}`, body ? `Extracted text:\n${body}` : 'No text could be extracted; rely on the image.']
          .filter(Boolean)
          .join('\n\n'),
      })

      const started = Date.now()
      try {
        const response = await anthropic.beta.messages.create({
          model: config.ai.model,
          max_tokens: 4000,
          system: SYSTEM,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: ENRICH_SCHEMA } },
          // a safety-classifier decline re-runs on Anthropic's recommended fallback model
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [{ role: 'user', content }],
        })
        metrics?.observe('ai_request_ms', { op: 'enrich' }, Date.now() - started)
        metrics?.inc('ai_tokens_total', { kind: 'input' }, response.usage?.input_tokens || 0)
        metrics?.inc('ai_tokens_total', { kind: 'output' }, response.usage?.output_tokens || 0)

        if (response.stop_reason === 'refusal') {
          metrics?.inc('ai_requests_total', { op: 'enrich', result: 'refusal' })
          log.warn('Model declined to classify a file', { filename, category: response.stop_details?.category })
          return null
        }
        if (response.stop_reason === 'max_tokens') throw new Error('Classification was cut off at max_tokens.')
        const textBlock = response.content.find((b) => b.type === 'text')
        if (!textBlock) throw new Error('The model returned no text block.')
        metrics?.inc('ai_requests_total', { op: 'enrich', result: 'ok' })
        return normalise(JSON.parse(textBlock.text))
      } catch (error) {
        metrics?.inc('ai_requests_total', { op: 'enrich', result: 'error' })
        if (error instanceof Anthropic.RateLimitError) throw Object.assign(new Error('AI rate limit reached; will retry next sync.'), { retryable: true })
        if (error instanceof Anthropic.APIError) throw new Error(`AI request failed (${error.status}): ${error.message}`)
        throw error
      }
    },
  }
}

/** Model JSON -> the plate field names the gallery uses. Defensive against drift. */
export function normalise(r) {
  const arr = (v, max = 12) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max) : [])
  const s = (v) => (typeof v === 'string' ? v.trim() : '')
  return {
    title: s(r.title),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    meta: {
      cat: CATEGORY_NAMES.includes(r.category) ? r.category : undefined,
      tech: arr(r.technologies).filter((t) => TECHS.includes(t)),
      products: arr(r.products).filter((p) => PRODUCTS.some((x) => x.key === p)),
      esg: !!r.esg,
      ai: !!r.ai,
      iot: !!r.iot,
      objective: s(r.objective),
      flow: arr(r.flow, 6),
      components: arr(r.components, 6),
      architecture: s(r.architecture),
      bizben: arr(r.business_benefits, 4),
      techben: arr(r.technical_benefits, 4),
      takeaway: s(r.takeaway),
      extraKeywords: arr(r.keywords, 12).map((k) => k.toLowerCase()),
    },
  }
}
