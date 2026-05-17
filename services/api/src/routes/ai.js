'use strict'
const aiFormat = require('../lib/ai-format')

const formatBodySchema = {
  type: 'object',
  required: ['text'],
  properties: {
    installId: { type: 'string', maxLength: 128 },
    text: { type: 'string', minLength: 1, maxLength: 100000 }
  },
  additionalProperties: false
}

const deepgramBodySchema = {
  type: 'object',
  properties: {
    installId: { type: 'string', maxLength: 128 }
  },
  additionalProperties: false
}

/*
 * AI proxy — keeps the OpenAI / Deepgram keys server-side so the shipped
 * desktop binary carries ZERO keys. The desktop calls these endpoints only
 * when the `aiProxy` feature flag is on (set via a version policy), so the
 * rollout needs no new desktop build.
 */
module.exports = async function aiRoutes(fastify) {
  // Proxy the OpenAI Responses call. The desktop validates the returned text
  // against its own cue parser before applying it.
  fastify.post(
    '/v1/ai/format',
    { schema: { body: formatBodySchema } },
    async (request, reply) => {
      const apiKey = fastify.config.openaiApiKey
      if (!apiKey) {
        reply.code(503)
        return {
          ok: false,
          error: 'AI proxy is not configured (no OPENAI_API_KEY on the server).'
        }
      }
      return aiFormat.formatRaw(request.body.text, { apiKey })
    }
  )

  // Hand the desktop a Deepgram key at runtime so the key never ships inside
  // the binary. v1 returns the configured key directly; a scoped short-lived
  // key (Deepgram management API) or a full WS relay is the hardening follow-up.
  fastify.post(
    '/v1/ai/deepgram-token',
    { schema: { body: deepgramBodySchema } },
    async (request, reply) => {
      const key = fastify.config.deepgramApiKey
      if (!key) {
        reply.code(503)
        return {
          ok: false,
          error: 'AI proxy is not configured (no DEEPGRAM_API_KEY on the server).'
        }
      }
      return { ok: true, key }
    }
  )
}
