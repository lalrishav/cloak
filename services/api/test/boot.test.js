'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const fakeMongo = require('./helpers/fake-mongo')
fakeMongo.install()

const db = require('../src/db')
const { buildServer } = require('../src/server')
const { loadConfig } = require('../src/config')

const config = loadConfig({
  CUE_ADMIN_USER: 'admin',
  CUE_ADMIN_PASS: 'pw',
  CUE_SESSION_SECRET: 'test-secret-needs-to-be-reasonably-long-1234',
  CUE_DOWNLOAD_BASE_URL: 'http://localhost:8787'
})

async function freshApp() {
  await db.disconnect()
  fakeMongo.reset()
  await db.connect({ uri: 'mongodb://fake', dbName: 'cue_cloud_test' })
  const app = await buildServer({ db, config, logger: false })
  await app.ready()
  return app
}

test('boot: happy path -> allowed', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i1', appVersion: '1.0.0', platform: 'darwin', arch: 'arm64' }
  })
  assert.equal(res.statusCode, 200)
  const b = res.json()
  assert.equal(b.allowed, true)
  assert.equal(b.killSwitch, false)
  assert.equal(b.updateRequired, false)
  assert.equal(b.status, 'allowed')
  assert.equal(b.updateUrl, null)
  assert.ok('features' in b)
})

test('boot: records the install and increments bootCount', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const payload = { installId: 'i1', appVersion: '1.0.0', platform: 'darwin' }
  await app.inject({ method: 'POST', url: '/v1/app/boot', payload })
  await app.inject({ method: 'POST', url: '/v1/app/boot', payload })
  const { items, total } = await db.listInstalls()
  assert.equal(total, 1)
  assert.equal(items[0].installId, 'i1')
  assert.equal(items[0].bootCount, 2)
})

test('boot: blocked policy -> killSwitch, not allowed', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await db.upsertVersionPolicy(
    { version: '0.9.0', status: 'blocked', message: 'this build is disabled' },
    'test'
  )
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i2', appVersion: '0.9.0', platform: 'darwin' }
  })
  const b = res.json()
  assert.equal(b.killSwitch, true)
  assert.equal(b.allowed, false)
  assert.equal(b.status, 'blocked')
  assert.equal(b.message, 'this build is disabled')
  assert.ok(b.updateUrl)
})

test('boot: appVersion below minVersion -> updateRequired (still allowed, not killed)', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await db.upsertVersionPolicy(
    {
      version: '*',
      channel: '*',
      platform: '*',
      status: 'allowed',
      minVersion: '2.0.0',
      latestVersion: '2.0.0'
    },
    'test'
  )
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i3', appVersion: '1.0.0', platform: 'darwin' }
  })
  const b = res.json()
  assert.equal(b.updateRequired, true)
  assert.equal(b.killSwitch, false)
  assert.equal(b.allowed, true)
  assert.equal(b.minVersion, '2.0.0')
  assert.ok(b.updateUrl)
})

test('boot: deprecated policy -> allowed with a non-blocking message', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await db.upsertVersionPolicy(
    { version: '1.0.0', status: 'deprecated', message: 'please update soon' },
    'test'
  )
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i4', appVersion: '1.0.0', platform: 'darwin' }
  })
  const b = res.json()
  assert.equal(b.status, 'deprecated')
  assert.equal(b.allowed, true)
  assert.equal(b.killSwitch, false)
  assert.equal(b.updateRequired, false)
  assert.equal(b.message, 'please update soon')
})

test('boot: feature flags pass through from the resolved policy', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await db.upsertVersionPolicy(
    {
      version: '*',
      channel: '*',
      platform: '*',
      status: 'allowed',
      minVersion: '1.0.0',
      latestVersion: '1.0.0',
      featureFlags: { aiProxy: true, voicePacing: false }
    },
    'test'
  )
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i5', appVersion: '1.0.0', platform: 'darwin' }
  })
  assert.equal(res.json().features.aiProxy, true)
  assert.equal(res.json().features.voicePacing, false)
})

test('boot: a more specific policy row wins over */*/*', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  // default stays allowed; a darwin-specific row blocks
  await db.upsertVersionPolicy(
    { version: '*', channel: '*', platform: 'darwin', status: 'blocked', message: 'mac paused' },
    'test'
  )
  const mac = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'm', appVersion: '1.0.0', platform: 'darwin' }
  })
  assert.equal(mac.json().killSwitch, true)
  const win = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'w', appVersion: '1.0.0', platform: 'win32' }
  })
  assert.equal(win.json().killSwitch, false)
})

test('boot: a version_blocked event is written when blocked', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await db.upsertVersionPolicy({ version: '1.0.0', status: 'blocked' }, 'test')
  await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i6', appVersion: '1.0.0', platform: 'darwin' }
  })
  const events = await db.listEvents({ installId: 'i6' })
  assert.ok(events.some((e) => e.type === 'version_blocked'))
})

test('boot: missing installId -> 400', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { appVersion: '1.0.0', platform: 'darwin' }
  })
  assert.equal(res.statusCode, 400)
})

test('boot: invalid platform -> 400', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'x', appVersion: '1.0.0', platform: 'amiga' }
  })
  assert.equal(res.statusCode, 400)
})

test('healthz: reports ok and mongo connected', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(res.statusCode, 200)
  const b = res.json()
  assert.equal(b.ok, true)
  assert.equal(b.mongo, true)
  assert.ok(b.version)
})
