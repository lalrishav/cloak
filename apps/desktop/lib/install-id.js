'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/*
 * Stable anonymous install id.
 *
 * Reads (or creates) install-id.json in the given userData dir. No PII — just a
 * random UUID that lets the backend count installs and tie boots/telemetry
 * together without any account.
 *
 * On any filesystem error this falls back to an in-memory ephemeral id so app
 * startup never hard-fails; in that (rare) case the id just won't be stable
 * across launches.
 */
function getInstallId(userDataDir) {
  const file = path.join(userDataDir, 'install-id.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed.installId === 'string' && parsed.installId) {
      return parsed.installId
    }
  } catch {
    // missing or unreadable — fall through and create one
  }
  const installId = crypto.randomUUID()
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ installId, createdAt: new Date().toISOString() }, null, 2)
    )
  } catch {
    // could not persist — return the ephemeral id anyway
  }
  return installId
}

module.exports = { getInstallId }
