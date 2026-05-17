'use strict'
const versionLib = require('../lib/version')

const bootBodySchema = {
  type: 'object',
  required: ['installId', 'appVersion', 'platform'],
  properties: {
    installId: { type: 'string', minLength: 1, maxLength: 128 },
    appVersion: { type: 'string', minLength: 1, maxLength: 32 },
    platform: { type: 'string', enum: ['darwin', 'win32', 'linux'] },
    arch: { type: 'string', maxLength: 16 },
    buildChannel: { type: 'string', maxLength: 16 }
  },
  additionalProperties: false
}

/*
 * POST /v1/app/boot — the version gate.
 *
 * Resolves the most-specific versionPolicies row, computes the gate decision
 * with real semver, records the boot, and returns EVERY gate field explicitly
 * so the desktop never has to infer one from another.
 */
module.exports = async function bootRoutes(fastify) {
  fastify.post(
    '/v1/app/boot',
    { schema: { body: bootBodySchema } },
    async (request, reply) => {
      const { installId, appVersion, platform } = request.body
      const arch = request.body.arch || 'unknown'
      const channel = request.body.buildChannel || 'stable'

      let policy
      try {
        policy = await fastify.db.resolvePolicy({ version: appVersion, channel, platform })
      } catch (err) {
        request.log.error({ err }, 'boot: db unavailable')
        reply.code(503)
        return { error: 'service unavailable' }
      }

      const status = policy ? policy.status : 'allowed'
      const minVersion = policy ? policy.minVersion : '1.0.0'
      const latestVersion = policy ? policy.latestVersion : appVersion
      const features = (policy && policy.featureFlags) || {}

      const killSwitch = status === 'blocked'
      const updateRequired = versionLib.isUpdateRequired(appVersion, minVersion)
      const allowed = !killSwitch
      const decision = killSwitch
        ? 'blocked'
        : updateRequired
          ? 'update-required'
          : 'allowed'

      const downloadUrl =
        (policy && policy.updateUrl) ||
        `${fastify.config.downloadBaseUrl}/v1/download/${platform}`

      // record the boot (install upsert + appBoot row + version_* event).
      // a logging failure must not fail the gate.
      try {
        await fastify.db.recordBoot({
          installId,
          version: appVersion,
          os: platform,
          arch,
          channel,
          decision,
          message: (policy && policy.message) || ''
        })
      } catch (err) {
        request.log.error({ err }, 'boot: recordBoot failed (non-fatal)')
      }

      return {
        allowed,
        status,
        updateRequired,
        killSwitch,
        minVersion,
        latestVersion,
        message: (policy && policy.message) || null,
        updateUrl: killSwitch || updateRequired ? downloadUrl : null,
        features
      }
    }
  )
}
