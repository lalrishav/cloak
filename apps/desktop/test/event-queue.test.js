'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createEventQueue, QUEUE_FILE } = require('../lib/event-queue')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cue-evq-'))
}

// a fetch that records the bodies it received and resolves ok/not-ok
function recordingFetch({ ok = true } = {}) {
  const calls = []
  const fn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok, status: ok ? 200 : 503, json: async () => ({ ok }) }
  }
  fn.calls = calls
  return fn
}

const baseOpts = (dir, fetchImpl) => ({
  queueDir: dir,
  apiUrl: 'http://localhost:8787',
  getInstallId: () => 'install-1',
  getAppVersion: () => '1.0.0',
  fetchImpl
})

test('enqueue: appends JSON lines to the queue file', (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const q = createEventQueue(baseOpts(dir, recordingFetch()))
  q.enqueue({ type: 'play', tMs: 1, sessionId: 's1' })
  q.enqueue({ type: 'pause', tMs: 2, sessionId: 's1' })
  assert.equal(q.size(), 2)
  const lines = fs.readFileSync(path.join(dir, QUEUE_FILE), 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).type, 'play')
})

test('flush: posts a batch and clears the queue on success', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fetchImpl = recordingFetch({ ok: true })
  const q = createEventQueue(baseOpts(dir, fetchImpl))
  q.enqueue({ type: 'play', sessionId: 's1' })
  q.enqueue({ type: 'pause', sessionId: 's1' })
  const r = await q.flush()
  assert.equal(r.flushed, 2)
  assert.equal(q.size(), 0)
  assert.equal(fetchImpl.calls.length, 1)
  const sent = fetchImpl.calls[0].body
  assert.equal(sent.installId, 'install-1')
  assert.equal(sent.appVersion, '1.0.0')
  assert.equal(sent.events.length, 2)
  assert.ok(sent.batchId)
})

test('flush: leaves the queue intact when offline', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const q = createEventQueue(baseOpts(dir, recordingFetch({ ok: false })))
  q.enqueue({ type: 'play', sessionId: 's1' })
  const r = await q.flush()
  assert.equal(r.flushed, 0)
  assert.equal(r.offline, true)
  assert.equal(q.size(), 1, 'events stay queued for the next flush')
})

test('flush: survives a throwing fetch (offline) without losing events', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const q = createEventQueue(
    baseOpts(dir, async () => {
      throw new Error('network down')
    })
  )
  q.enqueue({ type: 'play', sessionId: 's1' })
  const r = await q.flush()
  assert.equal(r.flushed, 0)
  assert.equal(q.size(), 1)
})

test('flush: empty queue is a no-op', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const q = createEventQueue(baseOpts(dir, recordingFetch()))
  const r = await q.flush()
  assert.equal(r.flushed, 0)
})

test('flush: batchId is content-derived (stable for the same events)', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  // first run: offline so the events stay queued, capture the batchId
  const offline = recordingFetch({ ok: false })
  const q1 = createEventQueue(baseOpts(dir, offline))
  q1.enqueue({ type: 'play', tMs: 1, sessionId: 's1' })
  q1.enqueue({ type: 'pause', tMs: 2, sessionId: 's1' })
  await q1.flush()
  const batchIdA = offline.calls[0].body.batchId

  // second run: same queued content, now online — same batchId
  const online = recordingFetch({ ok: true })
  const q2 = createEventQueue(baseOpts(dir, online))
  await q2.flush()
  const batchIdB = online.calls[0].body.batchId

  assert.equal(batchIdA, batchIdB, 'same content -> same batchId -> server can dedupe')
})

test('flush: events queued during offline drain once back online', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  // offline phase — queue grows
  const q = createEventQueue(baseOpts(dir, recordingFetch({ ok: false })))
  q.enqueue({ type: 'play', sessionId: 's1' })
  q.enqueue({ type: 'pause', sessionId: 's1' })
  await q.flush()
  assert.equal(q.size(), 2)

  // back online — a fresh queue instance over the same dir drains it
  const online = recordingFetch({ ok: true })
  const q2 = createEventQueue(baseOpts(dir, online))
  const r = await q2.flush()
  assert.equal(r.flushed, 2)
  assert.equal(q2.size(), 0)
})

test('flush: a corrupt line does not block the rest', async (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fetchImpl = recordingFetch({ ok: true })
  const q = createEventQueue(baseOpts(dir, fetchImpl))
  q.enqueue({ type: 'play', sessionId: 's1' })
  // inject a corrupt line directly
  fs.appendFileSync(path.join(dir, QUEUE_FILE), 'not-json\n')
  q.enqueue({ type: 'pause', sessionId: 's1' })
  const r = await q.flush()
  // 2 valid events sent, corrupt one skipped, queue cleared
  assert.equal(r.flushed, 2)
  assert.equal(q.size(), 0)
})
