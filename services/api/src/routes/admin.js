'use strict'
const { createAuth } = require('../plugins/auth')

function clampInt(v, min, max, dflt) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.floor(n)))
}

const versionPolicyBodySchema = {
  type: 'object',
  properties: {
    version: { type: 'string', maxLength: 32 },
    channel: { type: 'string', maxLength: 16 },
    platform: { type: 'string', maxLength: 16 },
    status: { type: 'string', enum: ['allowed', 'deprecated', 'blocked'] },
    minVersion: { type: 'string', maxLength: 32 },
    latestVersion: { type: 'string', maxLength: 32 },
    message: { type: 'string', maxLength: 1000 },
    updateUrl: { type: 'string', maxLength: 500 },
    featureFlags: { type: 'object' }
  },
  additionalProperties: false
}

const releaseBodySchema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'string', minLength: 1, maxLength: 32 },
    channel: { type: 'string', maxLength: 16 },
    notes: { type: 'string', maxLength: 5000 },
    assets: { type: 'object' }
  },
  additionalProperties: false
}

/*
 * All /admin/* routes. login/logout/me are public; everything else is behind
 * authGuard (which also enforces CSRF on write methods) via a scoped preHandler.
 */
module.exports = async function adminRoutes(fastify) {
  const auth = createAuth(fastify.config)
  const PUBLIC = new Set(['/admin/login', '/admin/logout', '/admin/me'])

  fastify.addHook('preHandler', async (request, reply) => {
    const url = (request.routeOptions && request.routeOptions.url) || request.routerPath
    if (PUBLIC.has(url)) return
    return auth.authGuard(request, reply)
  })

  // ---------- auth (public) ----------
  fastify.post(
    '/admin/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['user', 'pass'],
          properties: { user: { type: 'string' }, pass: { type: 'string' } },
          additionalProperties: false
        }
      }
    },
    auth.loginHandler
  )
  fastify.post('/admin/logout', auth.logoutHandler)
  fastify.get('/admin/me', auth.meHandler)

  // ---------- stats ----------
  fastify.get('/admin/stats/overview', async () => fastify.db.statsOverview())

  fastify.get('/admin/version-health', async () => fastify.db.versionHealth())

  fastify.get('/admin/usage', async (request) => {
    const { from, to } = request.query
    return fastify.db.usageStats({ from, to })
  })

  // ---------- installs ----------
  fastify.get('/admin/installs', async (request) => {
    const limit = clampInt(request.query.limit, 1, 500, 100)
    const skip = clampInt(request.query.skip, 0, 1e9, 0)
    return fastify.db.listInstalls({ limit, skip })
  })

  fastify.get('/admin/installs/:installId', async (request, reply) => {
    const install = await fastify.db.getInstall(request.params.installId)
    if (!install) {
      reply.code(404)
      return { error: 'not found' }
    }
    return install
  })

  // ---------- privacy & data ----------
  fastify.get('/admin/installs/:installId/export', async (request) => {
    return fastify.db.exportInstallData(request.params.installId)
  })

  fastify.delete('/admin/installs/:installId', async (request) => {
    return fastify.db.deleteInstallData(request.params.installId)
  })

  // ---------- downloads ----------
  fastify.get('/admin/downloads', async (request) => {
    const { from, to } = request.query
    const items = await fastify.db.listDownloads({ from, to })
    return { items }
  })

  // ---------- errors ----------
  fastify.get('/admin/errors', async (request) => {
    const limit = clampInt(request.query.limit, 1, 500, 200)
    const items = await fastify.db.listErrors({ limit })
    return { items }
  })

  // ---------- event explorer ----------
  fastify.get('/admin/events', async (request) => {
    const { installId, type, sessionId } = request.query
    const limit = clampInt(request.query.limit, 1, 500, 200)
    const skip = clampInt(request.query.skip, 0, 1e9, 0)
    const items = await fastify.db.listEvents({ installId, type, sessionId, limit, skip })
    return { items }
  })

  // ---------- cloud sessions ----------
  fastify.get('/admin/sessions', async (request) => {
    const limit = clampInt(request.query.limit, 1, 200, 50)
    const items = await fastify.db.listCloudSessions({ limit })
    return { items }
  })

  fastify.get('/admin/sessions/:sessionId', async (request, reply) => {
    const session = await fastify.db.getCloudSession(request.params.sessionId)
    if (!session) {
      reply.code(404)
      return { error: 'not found' }
    }
    return session
  })

  fastify.get('/admin/active', async () => {
    const items = await fastify.db.activeSessions({})
    return { items }
  })

  // ---------- version policies (interactive) ----------
  fastify.get('/admin/version-policies', async () => {
    const items = await fastify.db.listVersionPolicies()
    return { items }
  })

  fastify.post(
    '/admin/version-policies',
    { schema: { body: versionPolicyBodySchema } },
    async (request) => {
      return fastify.db.upsertVersionPolicy(request.body, request.adminUser)
    }
  )

  fastify.delete('/admin/version-policies/:id', async (request, reply) => {
    try {
      const r = await fastify.db.deleteVersionPolicy(request.params.id)
      if (!r.ok) reply.code(404)
      return r
    } catch (err) {
      reply.code(400)
      return { error: err.message }
    }
  })

  // ---------- releases ----------
  fastify.get('/admin/releases', async (request) => {
    const items = await fastify.db.listReleases(request.query.channel)
    return { items }
  })

  fastify.post(
    '/admin/releases',
    { schema: { body: releaseBodySchema } },
    async (request) => {
      return fastify.db.createRelease(request.body, request.adminUser)
    }
  )
}
