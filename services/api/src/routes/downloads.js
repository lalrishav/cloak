'use strict'
const crypto = require('crypto')

function hashIp(ip) {
  if (!ip) return ''
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16)
}

module.exports = async function downloadRoutes(fastify) {
  // Public download landing page (served from public/download/index.html).
  fastify.get('/download', (request, reply) => {
    return reply.sendFile('download/index.html')
  })

  // Tiny endpoint the landing page fetches to show the current version.
  fastify.get('/v1/release-info', async () => {
    let release = null
    try {
      release = await fastify.db.getLatestRelease('stable')
    } catch {
      /* ignore — page still renders without a version */
    }
    return {
      version: release ? release.version : null,
      channel: release ? release.channel : 'stable',
      platforms: release && release.assets ? Object.keys(release.assets) : []
    }
  })

  // Record a download click, then 302 to the release artifact.
  fastify.get('/v1/download/:os', async (request, reply) => {
    const os = String(request.params.os || '').toLowerCase()

    let release
    try {
      release = await fastify.db.getLatestRelease('stable')
    } catch (err) {
      request.log.error({ err }, 'download: db unavailable')
      reply.code(503)
      return { error: 'service unavailable' }
    }

    try {
      await fastify.db.recordDownload({
        os,
        version: release ? release.version : null,
        channel: release ? release.channel : 'stable',
        referrer: request.headers.referer || request.headers.referrer || '',
        ua: request.headers['user-agent'] || '',
        ipHash: hashIp(request.ip)
      })
    } catch (err) {
      request.log.error({ err }, 'download: recordDownload failed (non-fatal)')
    }

    const asset = release && release.assets && release.assets[os]
    if (!asset || !asset.url) {
      reply.code(404)
      return { error: 'no release artifact available for ' + os }
    }
    reply.code(302).header('Location', asset.url)
    return reply.send()
  })
}
