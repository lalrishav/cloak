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
  CUE_SESSION_SECRET: 'test-secret-needs-to-be-reasonably-long-1234'
})

async function freshApp() {
  await db.disconnect()
  fakeMongo.reset()
  await db.connect({ uri: 'mongodb://fake', dbName: 'cue_cloud_test' })
  const app = await buildServer({ db, config, logger: false })
  await app.ready()
  return app
}

function jarFrom(res) {
  const jar = {}
  for (const c of res.cookies || []) jar[c.name] = c.value
  return jar
}

async function login(app) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { user: 'admin', pass: 'pw' }
  })
  assert.equal(res.statusCode, 200)
  return jarFrom(res)
}

// preset a content-bearing helper
function csrf(jar) {
  return { 'x-csrf-token': jar.cue_csrf }
}

test('login: wrong credentials -> 401', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { user: 'admin', pass: 'wrong' }
  })
  assert.equal(res.statusCode, 401)
})

test('login: correct credentials -> 200 and sets session + csrf cookies', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { user: 'admin', pass: 'pw' }
  })
  assert.equal(res.statusCode, 200)
  const jar = jarFrom(res)
  assert.ok(jar.cue_admin)
  assert.ok(jar.cue_csrf)
})

test('me: 401 without cookie, 200 with', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const noAuth = await app.inject({ method: 'GET', url: '/admin/me' })
  assert.equal(noAuth.statusCode, 401)
  const jar = await login(app)
  const authed = await app.inject({ method: 'GET', url: '/admin/me', cookies: jar })
  assert.equal(authed.statusCode, 200)
  assert.equal(authed.json().user, 'admin')
})

test('protected route requires auth', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const noAuth = await app.inject({ method: 'GET', url: '/admin/stats/overview' })
  assert.equal(noAuth.statusCode, 401)
  const jar = await login(app)
  const ok = await app.inject({ method: 'GET', url: '/admin/stats/overview', cookies: jar })
  assert.equal(ok.statusCode, 200)
})

test('csrf: write route rejected without token, accepted with', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const jar = await login(app)
  const noCsrf = await app.inject({
    method: 'POST',
    url: '/admin/version-policies',
    cookies: jar,
    payload: { version: '1.2.3', status: 'allowed' }
  })
  assert.equal(noCsrf.statusCode, 403)
  const withCsrf = await app.inject({
    method: 'POST',
    url: '/admin/version-policies',
    cookies: jar,
    headers: csrf(jar),
    payload: { version: '1.2.3', status: 'allowed' }
  })
  assert.equal(withCsrf.statusCode, 200)
})

test('version policies: upsert, then the boot gate respects it', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const jar = await login(app)
  const up = await app.inject({
    method: 'POST',
    url: '/admin/version-policies',
    cookies: jar,
    headers: csrf(jar),
    payload: { version: '1.0.0', channel: '*', platform: '*', status: 'blocked', message: 'no' }
  })
  assert.equal(up.statusCode, 200)
  const list = await app.inject({ method: 'GET', url: '/admin/version-policies', cookies: jar })
  assert.ok(list.json().items.some((p) => p.version === '1.0.0' && p.status === 'blocked'))
  const boot = await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'i1', appVersion: '1.0.0', platform: 'darwin' }
  })
  assert.equal(boot.json().killSwitch, true)
})

test('version policies: cannot delete the default */*/* policy', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const jar = await login(app)
  const list = await app.inject({ method: 'GET', url: '/admin/version-policies', cookies: jar })
  const def = list
    .json()
    .items.find((p) => p.version === '*' && p.channel === '*' && p.platform === '*')
  assert.ok(def)
  const del = await app.inject({
    method: 'DELETE',
    url: '/admin/version-policies/' + def.id,
    cookies: jar,
    headers: csrf(jar)
  })
  assert.equal(del.statusCode, 400)
})

test('releases: create and list', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const jar = await login(app)
  const created = await app.inject({
    method: 'POST',
    url: '/admin/releases',
    cookies: jar,
    headers: csrf(jar),
    payload: {
      version: '1.1.0',
      channel: 'stable',
      notes: 'first signed build',
      assets: { darwin: { url: 'https://example.com/cue.dmg' } }
    }
  })
  assert.equal(created.statusCode, 200)
  const list = await app.inject({ method: 'GET', url: '/admin/releases', cookies: jar })
  assert.equal(list.json().items.length, 1)
  assert.equal(list.json().items[0].version, '1.1.0')
})

test('stats/overview: reflects boots and installs', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'a', appVersion: '1.0.0', platform: 'darwin' }
  })
  await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'b', appVersion: '1.0.0', platform: 'win32' }
  })
  const jar = await login(app)
  const res = await app.inject({ method: 'GET', url: '/admin/stats/overview', cookies: jar })
  const b = res.json()
  assert.equal(b.totalInstalls, 2)
  assert.equal(b.totalBoots, 2)
  assert.equal(b.dau, 2)
  assert.equal(b.versionDist['1.0.0'], 2)
})

test('installs list + privacy export + delete', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/app/boot',
    payload: { installId: 'p1', appVersion: '1.0.0', platform: 'darwin' }
  })
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: { installId: 'p1', events: [{ type: 'play', sessionId: 's1' }] }
  })
  const jar = await login(app)

  const installs = await app.inject({ method: 'GET', url: '/admin/installs', cookies: jar })
  assert.equal(installs.json().total, 1)

  const exported = await app.inject({
    method: 'GET',
    url: '/admin/installs/p1/export',
    cookies: jar
  })
  assert.equal(exported.statusCode, 200)
  assert.equal(exported.json().installId, 'p1')
  assert.ok(exported.json().events.length >= 1)

  const del = await app.inject({
    method: 'DELETE',
    url: '/admin/installs/p1',
    cookies: jar,
    headers: csrf(jar)
  })
  assert.equal(del.statusCode, 200)
  assert.equal(del.json().ok, true)

  const after = await app.inject({ method: 'GET', url: '/admin/installs', cookies: jar })
  assert.equal(after.json().total, 0)
})

test('cloud sessions: grouped from events, drill-down sorted by tMs', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: {
      installId: 'i1',
      events: [
        { type: 'pause', tMs: 200, sessionId: 'sess-A' },
        { type: 'session_started', tMs: 0, sessionId: 'sess-A' },
        { type: 'play', tMs: 100, sessionId: 'sess-A' }
      ]
    }
  })
  const jar = await login(app)
  const sessions = await app.inject({ method: 'GET', url: '/admin/sessions', cookies: jar })
  assert.equal(sessions.json().items.length, 1)
  assert.equal(sessions.json().items[0].sessionId, 'sess-A')

  const detail = await app.inject({ method: 'GET', url: '/admin/sessions/sess-A', cookies: jar })
  assert.equal(detail.statusCode, 200)
  assert.deepEqual(
    detail.json().events.map((e) => e.type),
    ['session_started', 'play', 'pause']
  )
})

test('errors view: lists only error-type events', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: {
      installId: 'i1',
      events: [
        { type: 'play', sessionId: 's1' },
        { type: 'error', payload: { message: 'kaboom' } }
      ]
    }
  })
  const jar = await login(app)
  const res = await app.inject({ method: 'GET', url: '/admin/errors', cookies: jar })
  assert.equal(res.json().items.length, 1)
  assert.equal(res.json().items[0].type, 'error')
})

test('logout returns ok', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const jar = await login(app)
  const out = await app.inject({ method: 'POST', url: '/admin/logout', cookies: jar })
  assert.equal(out.statusCode, 200)
  assert.equal(out.json().ok, true)
})
