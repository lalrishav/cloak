'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { checkBoot, CACHE_FILE } = require('../lib/boot-gate')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cue-bootgate-'))
}

// a fetch that resolves with the given JSON body
function okFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body })
}
// a fetch that rejects (offline)
function offlineFetch() {
  return async () => {
    throw new Error('network unreachable')
  }
}
// a fetch that hangs until aborted (for timeout testing)
function hangFetch() {
  return (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }
    })
}

const PAYLOAD = { installId: 'i1', appVersion: '1.0.0', platform: 'darwin', arch: 'arm64' }

test('checkBoot: fresh success returns the response and caches it', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const server = {
    allowed: true,
    status: 'allowed',
    updateRequired: false,
    killSwitch: false,
    minVersion: '1.0.0',
    latestVersion: '1.2.0',
    message: null,
    updateUrl: null,
    features: { aiProxy: false }
  }
  const r = await checkBoot(PAYLOAD, { cacheDir: dir, fetchImpl: okFetch(server) })
  assert.equal(r.allowed, true)
  assert.equal(r.stale, false)
  assert.equal(r.offline, false)
  assert.equal(r.latestVersion, '1.2.0')
  // cache file written
  const cache = JSON.parse(fs.readFileSync(path.join(dir, CACHE_FILE), 'utf8'))
  assert.equal(cache.response.latestVersion, '1.2.0')
  assert.ok(cache.fetchedAt)
})

test('checkBoot: a fresh online response CAN enforce killSwitch', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const server = {
    allowed: false,
    status: 'blocked',
    updateRequired: false,
    killSwitch: true,
    minVersion: '1.0.0',
    latestVersion: '1.0.0',
    message: 'disabled',
    updateUrl: 'http://x/dl',
    features: {}
  }
  const r = await checkBoot(PAYLOAD, { cacheDir: dir, fetchImpl: okFetch(server) })
  assert.equal(r.killSwitch, true)
  assert.equal(r.allowed, false)
})

test('checkBoot: offline with a cached BLOCKED response never enforces', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  // first, a fresh response that blocks — gets cached
  await checkBoot(PAYLOAD, {
    cacheDir: dir,
    fetchImpl: okFetch({
      allowed: false,
      status: 'blocked',
      updateRequired: true,
      killSwitch: true,
      minVersion: '9.0.0',
      latestVersion: '9.0.0',
      message: 'must update',
      updateUrl: 'http://x/dl',
      features: { aiProxy: true }
    })
  })
  // now go offline — the cached block must be DOWNGRADED, never enforced
  const r = await checkBoot(PAYLOAD, { cacheDir: dir, fetchImpl: offlineFetch() })
  assert.equal(r.killSwitch, false, 'offline must not enforce killSwitch')
  assert.equal(r.updateRequired, false, 'offline must not enforce updateRequired')
  assert.equal(r.allowed, true, 'offline must let the app open')
  assert.equal(r.stale, true)
  assert.equal(r.offline, true)
  // the cached intent is preserved for display only
  assert.equal(r.cachedKillSwitch, true)
  assert.equal(r.cachedUpdateRequired, true)
  assert.equal(r.cachedStatus, 'blocked')
  assert.equal(r.cachedMessage, 'must update')
  // non-blocking metadata still carried through
  assert.equal(r.latestVersion, '9.0.0')
  assert.deepEqual(r.features, { aiProxy: true })
})

test('checkBoot: offline with NO cache returns fully permissive', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = await checkBoot(PAYLOAD, { cacheDir: dir, fetchImpl: offlineFetch() })
  assert.equal(r.allowed, true)
  assert.equal(r.killSwitch, false)
  assert.equal(r.updateRequired, false)
  assert.equal(r.status, 'allowed')
  assert.equal(r.offline, true)
  assert.equal(r.stale, true)
})

test('checkBoot: a non-ok HTTP status is treated as offline', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = await checkBoot(PAYLOAD, {
    cacheDir: dir,
    fetchImpl: okFetch({}, { ok: false, status: 503 })
  })
  assert.equal(r.allowed, true)
  assert.equal(r.offline, true)
})

test('checkBoot: a timeout is treated as offline', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = await checkBoot(PAYLOAD, {
    cacheDir: dir,
    fetchImpl: hangFetch(),
    timeoutMs: 40
  })
  assert.equal(r.allowed, true)
  assert.equal(r.offline, true)
})

test('checkBoot: with no cacheDir, success still returns cleanly', async () => {
  const r = await checkBoot(PAYLOAD, {
    fetchImpl: okFetch({
      allowed: true,
      status: 'allowed',
      updateRequired: false,
      killSwitch: false,
      features: {}
    })
  })
  assert.equal(r.allowed, true)
  assert.equal(r.stale, false)
})
