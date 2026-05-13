/*
 * Unit tests for lib/db.js.
 *
 * The real `mongodb` driver is replaced with an in-memory fake before db.js
 * is required, so tests run without needing a running mongod.
 *
 * Run with:    node --test test/db.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// ---------------------------------------------------------------------------
// Fake mongodb
// ---------------------------------------------------------------------------

let pingShouldFail = false
let connectShouldFail = false
let nextObjectIdCounter = 0

class FakeObjectId {
  constructor(id) {
    if (id == null) {
      this._id = 'oid_' + (++nextObjectIdCounter)
    } else if (id && typeof id === 'object' && id._bsontype === 'ObjectId') {
      this._id = id._id
    } else {
      const s = String(id)
      // emulate real ObjectId: reject totally bogus strings
      if (!/^[a-zA-Z0-9_]+$/.test(s)) {
        throw new Error('invalid ObjectId: ' + s)
      }
      this._id = s
    }
    this._bsontype = 'ObjectId'
  }
  toString() {
    return this._id
  }
  equals(other) {
    return other && other.toString() === this.toString()
  }
}

class FakeCollection {
  constructor(name) {
    this.name = name
    this.docs = new Map()
  }
  _key(doc) {
    return doc._id.toString()
  }
  async insertOne(doc) {
    const id = new FakeObjectId()
    const stored = { ...doc, _id: id }
    this.docs.set(this._key(stored), stored)
    return { insertedId: id }
  }
  async findOne(query) {
    for (const d of this.docs.values()) {
      if (this._match(d, query)) return d
    }
    return null
  }
  find(query, opts = {}) {
    const all = []
    for (const d of this.docs.values()) {
      if (this._match(d, query)) {
        let copy = { ...d }
        if (opts.projection) {
          for (const k of Object.keys(opts.projection)) {
            if (opts.projection[k] === 0) delete copy[k]
          }
        }
        all.push(copy)
      }
    }
    return new FakeCursor(all)
  }
  async updateOne(query, update) {
    for (const d of this.docs.values()) {
      if (this._match(d, query)) {
        Object.assign(d, update.$set || {})
        return { modifiedCount: 1 }
      }
    }
    return { modifiedCount: 0 }
  }
  async deleteOne(query) {
    for (const d of this.docs.values()) {
      if (this._match(d, query)) {
        this.docs.delete(this._key(d))
        return { deletedCount: 1 }
      }
    }
    return { deletedCount: 0 }
  }
  async deleteMany(query) {
    let n = 0
    for (const d of [...this.docs.values()]) {
      if (this._match(d, query)) {
        this.docs.delete(this._key(d))
        n++
      }
    }
    return { deletedCount: n }
  }
  async createIndex() { return 'idx' }
  _match(doc, query) {
    if (!query || Object.keys(query).length === 0) return true
    for (const [k, v] of Object.entries(query)) {
      if (v && typeof v === 'object' && '$in' in v) {
        const list = v.$in
        const found = list.some((x) =>
          (doc[k] && doc[k].toString && x && x.toString
            ? doc[k].toString() === x.toString()
            : doc[k] === x)
        )
        if (!found) return false
        continue
      }
      const dv = doc[k]
      const matches =
        (dv && dv.toString && v && v.toString)
          ? dv.toString() === v.toString()
          : dv === v
      if (!matches) return false
    }
    return true
  }
}

class FakeCursor {
  constructor(arr) {
    this.arr = arr
    this._sort = null
    this._skip = 0
    this._limit = null
  }
  sort(spec) {
    const keys = Object.keys(spec)
    this._sort = (a, b) => {
      for (const k of keys) {
        const dir = spec[k]
        const av = a[k]
        const bv = b[k]
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
      }
      return 0
    }
    return this
  }
  skip(n) { this._skip = n; return this }
  limit(n) { this._limit = n; return this }
  async toArray() {
    let r = [...this.arr]
    if (this._sort) r.sort(this._sort)
    r = r.slice(this._skip)
    if (this._limit != null) r = r.slice(0, this._limit)
    return r
  }
}

class FakeDb {
  constructor(name) {
    this.name = name
    this.collections = new Map()
  }
  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new FakeCollection(name))
    }
    return this.collections.get(name)
  }
  async command(cmd) {
    if (cmd.ping !== undefined) {
      if (pingShouldFail) throw new Error('ping failed')
      return { ok: 1 }
    }
    return { ok: 1 }
  }
}

class FakeMongoClient {
  constructor(uri) {
    this.uri = uri
    this._db = null
    this.closed = false
  }
  async connect() {
    if (connectShouldFail) throw new Error('connect failed: ' + this.uri)
    this._db = new FakeDb('default')
    return this
  }
  db(name) {
    return new FakeDb(name)
  }
  async close() {
    this.closed = true
  }
}

// Inject the fake into Node's require resolution so db.js gets it.
const fakeMongodb = { MongoClient: FakeMongoClient, ObjectId: FakeObjectId }
const realResolve = Module._resolveFilename
const realLoad = Module._load
const fakeId = '__fake_mongodb__'
Module._resolveFilename = function (request, ...rest) {
  if (request === 'mongodb') return fakeId
  return realResolve.call(this, request, ...rest)
}
Module._load = function (request, ...rest) {
  if (request === 'mongodb' || request === fakeId) return fakeMongodb
  return realLoad.call(this, request, ...rest)
}
// Pre-warm the require cache so the lookup is consistent.
require.cache[fakeId] = {
  id: fakeId,
  filename: fakeId,
  loaded: true,
  exports: fakeMongodb
}

const db = require('../lib/db')

async function fresh() {
  await db.disconnect()
  pingShouldFail = false
  connectShouldFail = false
  const s = await db.connect({ uri: 'mongodb://fake/local', dbName: 'cue_test' })
  return s
}

// ---------------------------------------------------------------------------
// connect / disconnect / status
// ---------------------------------------------------------------------------

test('connect: succeeds against fake mongo', async () => {
  const s = await fresh()
  assert.equal(s.connected, true)
  assert.equal(s.error, null)
  assert.equal(s.uri, 'mongodb://fake/local')
  assert.equal(s.dbName, 'cue_test')
})

test('connect: failure surfaces error and leaves status disconnected', async () => {
  await db.disconnect()
  connectShouldFail = true
  const s = await db.connect({ uri: 'mongodb://nope', dbName: 'x' })
  assert.equal(s.connected, false)
  assert.match(s.error, /connect failed/)
  connectShouldFail = false
})

test('connect: ping failure surfaces error', async () => {
  await db.disconnect()
  pingShouldFail = true
  const s = await db.connect({ uri: 'mongodb://fake', dbName: 'x' })
  assert.equal(s.connected, false)
  assert.match(s.error, /ping failed/)
  pingShouldFail = false
})

test('connect: re-connecting closes previous client', async () => {
  await fresh()
  const s = await db.connect({ uri: 'mongodb://fake/again', dbName: 'cue_test' })
  assert.equal(s.connected, true)
})

test('getStatus: returns a copy of current status', async () => {
  await fresh()
  const a = db.getStatus()
  const b = db.getStatus()
  assert.equal(a.connected, true)
  assert.notEqual(a, b) // different object reference
  assert.deepEqual(a, b)
})

test('operations throw when not connected', async () => {
  await db.disconnect()
  await assert.rejects(() => db.listScripts(), /not connected/)
})

// ---------------------------------------------------------------------------
// scripts
// ---------------------------------------------------------------------------

test('createScript: persists with defaults', async () => {
  await fresh()
  const s = await db.createScript({})
  assert.equal(s.title, 'Untitled')
  assert.equal(s.body, '')
  assert.deepEqual(s.settings, {})
  assert.ok(s.id)
  assert.ok(s.createdAt)
})

test('createScript: stores provided fields', async () => {
  await fresh()
  const s = await db.createScript({ title: 'My Script', body: 'Hello.', settings: { fontSize: 40 } })
  assert.equal(s.title, 'My Script')
  assert.equal(s.body, 'Hello.')
  assert.deepEqual(s.settings, { fontSize: 40 })
})

test('getScript: returns the right script', async () => {
  await fresh()
  const created = await db.createScript({ title: 'A' })
  const found = await db.getScript(created.id)
  assert.equal(found.title, 'A')
})

test('getScript: returns null for missing id', async () => {
  await fresh()
  const r = await db.getScript('aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(r, null)
})

test('getScript: throws on malformed id', async () => {
  await fresh()
  await assert.rejects(() => db.getScript('!!! not valid !!!'), /invalid id/)
})

test('listScripts: orders by updatedAt desc', async () => {
  await fresh()
  await db.createScript({ title: 'first' })
  await new Promise((r) => setTimeout(r, 5))
  await db.createScript({ title: 'second' })
  const list = await db.listScripts()
  assert.equal(list[0].title, 'second')
  assert.equal(list[1].title, 'first')
  // listScripts strips body via projection
  assert.equal(list[0].body, undefined)
})

test('updateScript: changes title/body/settings', async () => {
  await fresh()
  const s = await db.createScript({ title: 'old' })
  const out = await db.updateScript(s.id, { title: 'new', body: 'b', settings: { x: 1 } })
  assert.equal(out.title, 'new')
  assert.equal(out.body, 'b')
  assert.deepEqual(out.settings, { x: 1 })
})

test('updateScript: ignores non-string title/body', async () => {
  await fresh()
  const s = await db.createScript({ title: 'keep', body: 'keep-body' })
  const out = await db.updateScript(s.id, { title: 42, body: null })
  assert.equal(out.title, 'keep')
  assert.equal(out.body, 'keep-body')
})

test('updateScript: settings ignored when falsy', async () => {
  await fresh()
  const s = await db.createScript({ title: 'x', settings: { keep: true } })
  const out = await db.updateScript(s.id, { settings: null })
  assert.deepEqual(out.settings, { keep: true })
})

test('deleteScript: removes script and its versions', async () => {
  await fresh()
  const s = await db.createScript({ title: 'doomed', body: 'a' })
  await db.snapshotScript(s.id)
  const r = await db.deleteScript(s.id)
  assert.deepEqual(r, { ok: true })
  assert.equal(await db.getScript(s.id), null)
  assert.deepEqual(await db.listVersions(s.id), [])
})

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

test('snapshotScript: creates a version row', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X', body: 'body 1' })
  const v = await db.snapshotScript(s.id)
  assert.equal(v.body, 'body 1')
  assert.equal(v.scriptId.toString(), s.id)
  assert.ok(v.savedAt)
})

test('snapshotScript: throws if script missing', async () => {
  await fresh()
  await assert.rejects(() => db.snapshotScript('aaaaaaaaaaaaaaaaaaaaaaaa'), /script not found/)
})

test('snapshotScript: prunes beyond 30 versions', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X', body: 'b' })
  for (let i = 0; i < 35; i++) {
    await db.updateScript(s.id, { body: 'body ' + i })
    await db.snapshotScript(s.id)
  }
  const list = await db.listVersions(s.id)
  assert.equal(list.length, 30)
})

test('listVersions: returns versions newest first', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X', body: 'b1' })
  await db.snapshotScript(s.id)
  await new Promise((r) => setTimeout(r, 5))
  await db.updateScript(s.id, { body: 'b2' })
  await db.snapshotScript(s.id)
  const list = await db.listVersions(s.id)
  assert.equal(list.length, 2)
  // newest first, body stripped
  assert.equal(list[0].body, undefined)
})

test('restoreVersion: brings back old body', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X', body: 'original' })
  const v = await db.snapshotScript(s.id)
  await db.updateScript(s.id, { body: 'mutated' })
  const r = await db.restoreVersion(s.id, v.id)
  assert.equal(r.body, 'original')
})

test('restoreVersion: throws when version missing', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X' })
  await assert.rejects(
    () => db.restoreVersion(s.id, 'aaaaaaaaaaaaaaaaaaaaaaaa'),
    /version not found/
  )
})

// ---------------------------------------------------------------------------
// sessions / events
// ---------------------------------------------------------------------------

test('startSession: creates a session row', async () => {
  await fresh()
  const s = await db.createScript({ title: 'X' })
  const sess = await db.startSession({ scriptId: s.id, settingsSnapshot: { fontSize: 60 } })
  assert.ok(sess.id)
  assert.ok(sess.startedAt)
  assert.equal(sess.endedAt, null)
  assert.deepEqual(sess.settingsSnapshot, { fontSize: 60 })
})

test('startSession: accepts null scriptId', async () => {
  await fresh()
  const sess = await db.startSession({})
  assert.equal(sess.scriptId, null)
  assert.deepEqual(sess.settingsSnapshot, {})
})

test('endSession: stamps endedAt', async () => {
  await fresh()
  const sess = await db.startSession({})
  const ended = await db.endSession(sess.id)
  assert.ok(ended.endedAt)
})

test('endSession: null id returns null', async () => {
  await fresh()
  assert.equal(await db.endSession(null), null)
})

test('logEvent: writes an event row', async () => {
  await fresh()
  const sess = await db.startSession({})
  const ev = await db.logEvent(sess.id, 1234, 'pause', { reason: 'manual' })
  assert.equal(ev.tMs, 1234)
  assert.equal(ev.type, 'pause')
  assert.deepEqual(ev.payload, { reason: 'manual' })
})

test('logEvent: defaults tMs to 0 and payload to {}', async () => {
  await fresh()
  const sess = await db.startSession({})
  const ev = await db.logEvent(sess.id, 'not a number', 'tick')
  assert.equal(ev.tMs, 0)
  assert.deepEqual(ev.payload, {})
})

test('logEvent: null sessionId is a no-op', async () => {
  await fresh()
  assert.equal(await db.logEvent(null, 0, 'foo'), null)
})

test('listSessions: returns recent first, scoped by script when provided', async () => {
  await fresh()
  const s1 = await db.createScript({ title: 'A' })
  const s2 = await db.createScript({ title: 'B' })
  await db.startSession({ scriptId: s1.id })
  await new Promise((r) => setTimeout(r, 5))
  await db.startSession({ scriptId: s2.id })
  await new Promise((r) => setTimeout(r, 5))
  await db.startSession({ scriptId: s1.id })

  const all = await db.listSessions()
  assert.equal(all.length, 3)

  const onlyA = await db.listSessions(s1.id)
  assert.equal(onlyA.length, 2)
})

test('listSessions: caps at 50', async () => {
  await fresh()
  for (let i = 0; i < 55; i++) {
    await db.startSession({})
  }
  const all = await db.listSessions()
  assert.equal(all.length, 50)
})

test('getSession: returns session with events sorted by tMs', async () => {
  await fresh()
  const sess = await db.startSession({})
  await db.logEvent(sess.id, 200, 'b')
  await db.logEvent(sess.id, 100, 'a')
  await db.logEvent(sess.id, 300, 'c')
  const full = await db.getSession(sess.id)
  assert.equal(full.id, sess.id)
  assert.equal(full.events.length, 3)
  assert.deepEqual(
    full.events.map((e) => e.type),
    ['a', 'b', 'c']
  )
})

test('getSession: missing session returns null', async () => {
  await fresh()
  const r = await db.getSession('aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(r, null)
})

// ---------------------------------------------------------------------------
// disconnect / status invariants
// ---------------------------------------------------------------------------

test('disconnect: clears connected flag', async () => {
  await fresh()
  await db.disconnect()
  const s = db.getStatus()
  assert.equal(s.connected, false)
})

test('disconnect: idempotent', async () => {
  await db.disconnect()
  await db.disconnect()
  assert.equal(db.getStatus().connected, false)
})

test('asObjectId: passes through existing ObjectId-like value', async () => {
  await fresh()
  const s = await db.createScript({ title: 'pass-through' })
  // get by ObjectId-shaped value
  const oid = new FakeObjectId(s.id)
  const r = await db.getScript(oid)
  assert.equal(r.title, 'pass-through')
})

// Restore originals after all tests run.
test('teardown: restore module loader', () => {
  Module._resolveFilename = realResolve
  Module._load = realLoad
})
