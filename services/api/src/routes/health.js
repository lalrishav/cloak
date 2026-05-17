'use strict'

const pkg = require('../../package.json')

module.exports = async function healthRoutes(fastify) {
  fastify.get('/healthz', async () => {
    const status = fastify.db.getStatus()
    return {
      ok: true,
      mongo: status.connected,
      uptime: Math.round(process.uptime()),
      version: pkg.version
    }
  })
}
