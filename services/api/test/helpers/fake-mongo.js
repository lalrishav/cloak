'use strict'
/*
 * In-memory MongoDB fake for @cue/api tests.
 *
 * Same module-swap technique as apps/desktop/test/db.test.js, extended with the
 * operators the API's db.js relies on: upsert + $set/$setOnInsert/$inc/$push in
 * updateOne; $ne/$gte/$gt/$lte/$lt/$in/$exists in queries; insertMany;
 * countDocuments. No aggregation — db.js groups in JS instead.
 *
 * Usage in a test file (before requiring ../src/db):
 *   const fakeMongo = require('./helpers/fake-mongo')
 *   fakeMongo.install()
 *   const db = require('../src/db')
 */
const Module = require('module')

let nextOid = 0
let connectShouldFail = false
let pingShouldFail = false

class FakeObjectId {
  constructor(id) {
    if (id == null) {
      this._id = 'oid' + String(++nextOid).padStart(21, '0')
    } else if (id && typeof id === 'object' && id._bsontype === 'ObjectId') {
      this._id = id._id
    } else {
      const s = String(id)
      if (!/^[a-zA-Z0-9_]+$/.test(s)) throw new Error('invalid ObjectId: ' + s)
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

function valEq(a, b) {
  if (a && b && (a._bsontype || b._bsontype) && a.toString && b.toString) {
    return a.toString() === b.toString()
  }
  if (a instanceof Date || b instanceof Date) {
    if (a == null || b == null) return a === b
    return new Date(a).getTime() === new Date(b).getTime()
  }
  return a === b
}

function cmp(a, b) {
  const av = a instanceof Date ? a.getTime() : a
  const bv = b instanceof Date ? b.getTime() : b
  if (av < bv) return -1
  if (av > bv) return 1
  return 0
}

function isOperatorObject(cond) {
  return (
    cond &&
    typeof cond === 'object' &&
    !(cond instanceof Date) &&
    !cond._bsontype &&
    !Array.isArray(cond)
  )
}

function matchField(docVal, cond) {
  if (isOperatorObject(cond)) {
    for (const [op, v] of Object.entries(cond)) {
      switch (op) {
        case '$in':
          if (!v.some((x) => valEq(docVal, x))) return false
          break
        case '$nin':
          if (v.some((x) => valEq(docVal, x))) return false
          break
        case '$ne':
          if (valEq(docVal, v)) return false
          break
        case '$gte':
          if (docVal == null || cmp(docVal, v) < 0) return false
          break
        case '$gt':
          if (docVal == null || cmp(docVal, v) <= 0) return false
          break
        case '$lte':
          if (docVal == null || cmp(docVal, v) > 0) return false
          break
        case '$lt':
          if (docVal == null || cmp(docVal, v) >= 0) return false
          break
        case '$exists':
          if (v ? docVal === undefined : docVal !== undefined) return false
          break
        default:
          break
      }
    }
    return true
  }
  return valEq(docVal, cond)
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
        const c = cmp(a[k], b[k])
        if (c !== 0) return c * spec[k]
      }
      return 0
    }
    return this
  }
  skip(n) {
    this._skip = n
    return this
  }
  limit(n) {
    this._limit = n
    return this
  }
  async toArray() {
    let r = [...this.arr]
    if (this._sort) r.sort(this._sort)
    r = r.slice(this._skip)
    if (this._limit != null) r = r.slice(0, this._limit)
    return r
  }
}

class FakeCollection {
  constructor(name) {
    this.name = name
    this.docs = []
  }
  _match(doc, query) {
    if (!query) return true
    for (const [k, cond] of Object.entries(query)) {
      if (!matchField(doc[k], cond)) return false
    }
    return true
  }
  async insertOne(doc) {
    const _id = doc._id || new FakeObjectId()
    this.docs.push({ ...doc, _id })
    return { acknowledged: true, insertedId: _id }
  }
  async insertMany(docs) {
    const insertedIds = {}
    docs.forEach((doc, i) => {
      const _id = doc._id || new FakeObjectId()
      this.docs.push({ ...doc, _id })
      insertedIds[i] = _id
    })
    return { acknowledged: true, insertedCount: docs.length, insertedIds }
  }
  async findOne(query) {
    return this.docs.find((d) => this._match(d, query)) || null
  }
  find(query, opts = {}) {
    let arr = this.docs.filter((d) => this._match(d, query)).map((d) => ({ ...d }))
    if (opts.projection) {
      for (const d of arr) {
        for (const [k, v] of Object.entries(opts.projection)) {
          if (v === 0) delete d[k]
        }
      }
    }
    return new FakeCursor(arr)
  }
  async updateOne(query, update, opts = {}) {
    let target = this.docs.find((d) => this._match(d, query))
    let upserted = false
    if (!target && opts.upsert) {
      target = { _id: new FakeObjectId() }
      for (const [k, v] of Object.entries(query)) {
        if (v == null || typeof v !== 'object' || v._bsontype || v instanceof Date) {
          target[k] = v
        }
      }
      this.docs.push(target)
      upserted = true
      if (update.$setOnInsert) Object.assign(target, update.$setOnInsert)
    }
    if (!target) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null }
    }
    if (update.$set) Object.assign(target, update.$set)
    if (update.$inc) {
      for (const [k, n] of Object.entries(update.$inc)) {
        target[k] = (target[k] || 0) + n
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!Array.isArray(target[k])) target[k] = []
        target[k].push(v)
      }
    }
    return {
      matchedCount: upserted ? 0 : 1,
      modifiedCount: upserted ? 0 : 1,
      upsertedCount: upserted ? 1 : 0,
      upsertedId: upserted ? target._id : null
    }
  }
  async deleteOne(query) {
    const i = this.docs.findIndex((d) => this._match(d, query))
    if (i === -1) return { deletedCount: 0 }
    this.docs.splice(i, 1)
    return { deletedCount: 1 }
  }
  async deleteMany(query) {
    const before = this.docs.length
    this.docs = this.docs.filter((d) => !this._match(d, query))
    return { deletedCount: before - this.docs.length }
  }
  async countDocuments(query) {
    return this.docs.filter((d) => this._match(d, query || {})).length
  }
  async createIndex() {
    return 'idx'
  }
}

class FakeDb {
  constructor(name) {
    this.name = name
    this.collections = new Map()
  }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(name))
    return this.collections.get(name)
  }
  async command(cmd) {
    if (cmd.ping !== undefined && pingShouldFail) throw new Error('ping failed')
    return { ok: 1 }
  }
}

class FakeMongoClient {
  constructor(uri) {
    this.uri = uri
    this.closed = false
  }
  async connect() {
    if (connectShouldFail) throw new Error('connect failed: ' + this.uri)
    return this
  }
  // Fresh FakeDb per call — db.js calls client.db() once per connect(), so data
  // persists for a connection's lifetime and a reconnect starts clean.
  db(name) {
    return new FakeDb(name)
  }
  async close() {
    this.closed = true
  }
}

let restoreFn = null

function install() {
  if (restoreFn) return restoreFn
  const fakeMongodb = { MongoClient: FakeMongoClient, ObjectId: FakeObjectId }
  const realResolve = Module._resolveFilename
  const realLoad = Module._load
  const fakeId = '__fake_mongodb_api__'
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'mongodb') return fakeId
    return realResolve.call(this, request, ...rest)
  }
  Module._load = function (request, ...rest) {
    if (request === 'mongodb' || request === fakeId) return fakeMongodb
    return realLoad.call(this, request, ...rest)
  }
  require.cache[fakeId] = {
    id: fakeId,
    filename: fakeId,
    loaded: true,
    exports: fakeMongodb
  }
  restoreFn = () => {
    Module._resolveFilename = realResolve
    Module._load = realLoad
    delete require.cache[fakeId]
    restoreFn = null
  }
  return restoreFn
}

function reset() {
  connectShouldFail = false
  pingShouldFail = false
  nextOid = 0
}

module.exports = {
  install,
  reset,
  FakeObjectId,
  setConnectShouldFail: (v) => {
    connectShouldFail = v
  },
  setPingShouldFail: (v) => {
    pingShouldFail = v
  }
}
