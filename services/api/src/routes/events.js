'use strict'
const { isKnownEventType } = require('@cue/shared')

const eventsBodySchema = {
  type: 'object',
  required: ['installId', 'events'],
  properties: {
    installId: { type: 'string', minLength: 1, maxLength: 128 },
    appVersion: { type: 'string', maxLength: 32 },
    batchId: { type: 'string', maxLength: 128 },
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', minLength: 1, maxLength: 64 },
          tMs: { type: 'number' },
          sessionId: { type: ['string', 'null'], maxLength: 128 },
          ts: { type: 'string' },
          payload: { type: 'object' }
        },
        // forward-compat: tolerate extra keys on individual events
        additionalProperties: true
      }
    }
  },
  additionalProperties: false
}

/*
 * POST /v1/events — batched telemetry + error ingestion.
 *
 * Unknown event types are accepted (forward-compat) but flagged in the log.
 * `error`-type events flow through this same pipe; the dashboard's Errors view
 * just filters type:"error".
 */
module.exports = async function eventsRoutes(fastify) {
  fastify.post(
    '/v1/events',
    { schema: { body: eventsBodySchema } },
    async (request, reply) => {
      const { installId, appVersion, batchId, events } = request.body

      const unknown = [...new Set(events.map((e) => e.type).filter((t) => !isKnownEventType(t)))]
      if (unknown.length) {
        request.log.warn({ installId, unknown }, 'events: unknown types accepted (forward-compat)')
      }

      try {
        const r = await fastify.db.insertEventBatch({
          installId,
          version: appVersion,
          batchId,
          events
        })
        return { ok: true, accepted: r.accepted, duplicate: !!r.duplicate }
      } catch (err) {
        request.log.error({ err }, 'events: ingestion failed')
        reply.code(503)
        return { error: 'service unavailable' }
      }
    }
  )
}
