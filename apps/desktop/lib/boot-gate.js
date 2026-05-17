'use strict'
const fs = require('fs')
const path = require('path')

const DEFAULT_TIMEOUT_MS = 4000
const CACHE_FILE = 'boot-cache.json'

/*
 * The startup version gate.
 *
 * checkBoot() POSTs to /v1/app/boot with a short timeout. The crucial rule:
 *
 *   Only a FRESH ONLINE response can enforce killSwitch / updateRequired.
 *   Offline (or a stale cache) can WARN, but it must NEVER block — a backend
 *   outage must never brick the app.
 *
 * - success: cache the response verbatim, return it (stale:false).
 * - failure/offline WITH a cache: return the cache with killSwitch and
 *   updateRequired forced false; the cached status/message are preserved on
 *   `cached*` fields for display only (diagnostics panel).
 * - failure/offline with NO cache: return a fully-permissive result.
 */

function permissive(extra) {
  return {
    allowed: true,
    status: 'allowed',
    updateRequired: false,
    killSwitch: false,
    minVersion: null,
    latestVersion: null,
    message: null,
    updateUrl: null,
    features: {},
    ...extra
  }
}

// Neuter a cached response's enforcement — offline can only warn.
function downgradeForOffline(cached) {
  return {
    allowed: true,
    status: 'allowed',
    updateRequired: false,
    killSwitch: false,
    minVersion: cached.minVersion || null,
    latestVersion: cached.latestVersion || null,
    message: null,
    updateUrl: null,
    features: cached.features || {},
    stale: true,
    offline: true,
    // what the cache *would* have enforced, kept for display only
    cachedStatus: cached.status || null,
    cachedMessage: cached.message || null,
    cachedKillSwitch: !!cached.killSwitch,
    cachedUpdateRequired: !!cached.updateRequired
  }
}

function readCache(cacheDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, CACHE_FILE), 'utf8'))
    if (parsed && parsed.response) return parsed
  } catch {
    /* no cache */
  }
  return null
}

function writeCache(cacheDir, response) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(
      path.join(cacheDir, CACHE_FILE),
      JSON.stringify({ fetchedAt: new Date().toISOString(), response }, null, 2)
    )
  } catch {
    /* best effort */
  }
}

async function checkBoot(payload, opts = {}) {
  const {
    apiUrl = 'http://localhost:8787',
    cacheDir,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = opts

  const url = apiUrl.replace(/\/+$/, '') + '/v1/app/boot'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!res || !res.ok) throw new Error('boot endpoint returned ' + (res && res.status))
    const data = await res.json()
    // fresh, authoritative response — the ONLY path that can enforce
    if (cacheDir) writeCache(cacheDir, data)
    return { ...data, stale: false, offline: false }
  } catch {
    clearTimeout(timer)
    const cached = cacheDir ? readCache(cacheDir) : null
    if (cached && cached.response) return downgradeForOffline(cached.response)
    return permissive({ stale: true, offline: true })
  }
}

module.exports = { checkBoot, permissive, downgradeForOffline, CACHE_FILE }
