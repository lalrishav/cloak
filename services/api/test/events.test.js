'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const fakeMongo = require('./helpers/fake-mongo')
fakeMongo.install()

const db = require('../src/db')
const { buildServer } = require('../src/server')
const { loadConfig } = require('../src/config')

const config = loadConfig({
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

test('events: accepts a batch', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: {
      installId: 'i1',
      appVersion: '1.0.0',
      batchId: 'b1',
      events: [
        { type: 'session_started', tMs: 0, sessionId: 's1' },
        { type: 'play', tMs: 10, sessionId: 's1' },
        { type: 'pause', tMs: 999, sessionId: 's1' }
      ]
    }
  })
  assert.equal(res.statusCode, 200)
  const b = res.json()
  assert.equal(b.ok, true)
  assert.equal(b.accepted, 3)
  assert.equal(b.duplicate, false)
})

test('events: batchId makes re-sends idempotent', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const payload = {
    installId: 'i1',
    batchId: 'dup-batch',
    events: [{ type: 'play', tMs: 1, sessionId: 's1' }]
  }
  const r1 = await app.inject({ method: 'POST', url: '/v1/events', payload })
  assert.equal(r1.json().accepted, 1)
  const r2 = await app.inject({ method: 'POST', url: '/v1/events', payload })
  assert.equal(r2.json().accepted, 0)
  assert.equal(r2.json().duplicate, true)
  const usage = await db.usageStats({})
  assert.equal(usage.totalEvents, 1)
})

test('events: unknown event types are accepted (forward-compat)', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: { installId: 'i1', events: [{ type: 'some-future-event', sessionId: 's1' }] }
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().accepted, 1)
})

test('events: existing granular desktop events pass through as-is', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: {
      installId: 'i1',
      events: [
        { type: 'speed-change', tMs: 5, sessionId: 's1', payload: { speed: 4 } },
        { type: 'stumble', tMs: 50, sessionId: 's1' },
        { type: 'cue-hit', tMs: 80, sessionId: 's1' }
      ]
    }
  })
  const usage = await db.usageStats({})
  assert.equal(usage.byType['speed-change'], 1)
  assert.equal(usage.byType.stumble, 1)
  assert.equal(usage.byType['cue-hit'], 1)
})

test('events: empty events array -> 400', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: { installId: 'i1', events: [] }
  })
  assert.equal(res.statusCode, 400)
})

test('events: missing installId -> 400', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  const res = await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: { events: [{ type: 'play' }] }
  })
  assert.equal(res.statusCode, 400)
})

test('events: error events are ingested and queryable', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: {
      installId: 'i1',
      events: [{ type: 'error', payload: { message: 'boom', where: 'main' } }]
    }
  })
  const errs = await db.listErrors({})
  assert.equal(errs.length, 1)
  assert.equal(errs[0].type, 'error')
  assert.equal(errs[0].payload.message, 'boom')
})

test('events: sessionId stays a plain string (cloud does not mint identity)', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())
  await app.inject({
    method: 'POST',
    url: '/v1/events',
    payload: { installId: 'i1', events: [{ type: 'play', sessionId: 'local-sess-123' }] }
  })
  const session = await db.getCloudSession('local-sess-123')
  assert.ok(session)
  assert.equal(session.sessionId, 'local-sess-123')
  assert.equal(typeof session.sessionId, 'string')
})
