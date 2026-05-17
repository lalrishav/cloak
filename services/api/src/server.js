'use strict'
const path = require('path')
const Fastify = require('fastify')

/*
 * Builds a configured Fastify instance but does NOT listen — index.js calls
 * listen() for the real server, tests use app.inject().
 *
 * Pass { db } (real db module or the in-memory fake) and { config }.
 * Pass { logger: false } in tests to silence output.
 */
async function buildServer({ db, config, logger } = {}) {
  const app = Fastify({
    logger: logger === undefined ? { level: 'info' } : logger,
    trustProxy: true
  })

  app.decorate('db', db)
  app.decorate('config', config)

  await app.register(require('@fastify/helmet'), {
    // the download landing page uses a small inline <style>/<script>; this is an
    // internal tool, so a strict CSP is not worth the friction here.
    contentSecurityPolicy: false
  })
  await app.register(require('@fastify/cors'), {
    origin: config.adminOrigin,
    credentials: true
  })
  await app.register(require('@fastify/cookie'), {
    secret: config.sessionSecret
  })
  await app.register(require('@fastify/rate-limit'), {
    max: 300,
    timeWindow: '1 minute'
  })
  await app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/'
  })

  await app.register(require('./routes/health'))
  await app.register(require('./routes/boot'))
  await app.register(require('./routes/events'))
  await app.register(require('./routes/downloads'))
  await app.register(require('./routes/ai'))
  await app.register(require('./routes/admin'))

  return app
}

module.exports = { buildServer }
