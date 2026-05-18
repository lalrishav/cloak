/*
 * MongoDB layer for Cloak.
 *
 * Connects to a local mongod by default (mongodb://127.0.0.1:27017).
 * Collections:
 *   scripts          { _id, title, body, settings, createdAt, updatedAt }
 *   scriptVersions   { _id, scriptId, body, savedAt }
 *   sessions         { _id, scriptId, startedAt, endedAt, settingsSnapshot }
 *   sessionEvents    { _id, sessionId, tMs, type, payload }
 *
 * All repository methods are async and return plain objects (with string ids
 * instead of ObjectId so they can cross the IPC bridge).
 *
 * If MongoDB is unreachable, repository calls reject with a clear error and
 * the rest of the app is expected to fall back to local-only behavior.
 */
const { MongoClient, ObjectId } = require('mongodb')

const DEFAULT_URI =
  process.env.CLOAK_MONGO_URI || 'mongodb://127.0.0.1:27017'
const DEFAULT_DB = process.env.CLOAK_MONGO_DB || 'cloak'

let client = null
let db = null
let status = { connected: false, error: null, uri: DEFAULT_URI, dbName: DEFAULT_DB }

async function connect({ uri = DEFAULT_URI, dbName = DEFAULT_DB } = {}) {
  if (client) {
    try {
      await client.close()
    } catch {
      /* ignore */
    }
  }
  status = { connected: false, error: null, uri, dbName }
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 2500,
    connectTimeoutMS: 2500
  })
  try {
    await client.connect()
    db = client.db(dbName)
    await db.command({ ping: 1 })
    status.connected = true

    // Indexes (idempotent)
    await Promise.all([
      db.collection('scripts').createIndex({ updatedAt: -1 }),
      db.collection('scripts').createIndex({ title: 1 }),
      db.collection('scriptVersions').createIndex({ scriptId: 1, savedAt: -1 }),
      db.collection('sessions').createIndex({ scriptId: 1, startedAt: -1 }),
      db.collection('sessionEvents').createIndex({ sessionId: 1, tMs: 1 })
    ])
    return status
  } catch (err) {
    status.connected = false
    status.error = err && err.message ? err.message : String(err)
    db = null
    client = null
    return status
  }
}

async function disconnect() {
  if (client) {
    try {
      await client.close()
    } catch {
      /* ignore */
    }
  }
  client = null
  db = null
  status.connected = false
}

function getStatus() {
  return { ...status }
}

function ensureDb() {
  if (!db) throw new Error('mongo not connected')
  return db
}

function toClient(doc) {
  if (!doc) return null
  const out = { ...doc, id: doc._id.toString() }
  delete out._id
  return out
}

function asObjectId(id) {
  if (id && typeof id === 'object' && id._bsontype === 'ObjectId') return id
  try {
    return new ObjectId(String(id))
  } catch (err) {
    throw new Error('invalid id: ' + id)
  }
}

// ---------- scripts ----------

async function listScripts() {
  const dbi = ensureDb()
  const docs = await dbi
    .collection('scripts')
    .find({}, { projection: { body: 0 } })
    .sort({ updatedAt: -1 })
    .toArray()
  return docs.map(toClient)
}

async function getScript(id) {
  const dbi = ensureDb()
  const doc = await dbi
    .collection('scripts')
    .findOne({ _id: asObjectId(id) })
  return toClient(doc)
}

async function createScript({ title, body, settings }) {
  const dbi = ensureDb()
  const now = new Date()
  const doc = {
    title: String(title || 'Untitled'),
    body: String(body || ''),
    settings: settings || {},
    createdAt: now,
    updatedAt: now
  }
  const r = await dbi.collection('scripts').insertOne(doc)
  return toClient({ ...doc, _id: r.insertedId })
}

async function updateScript(id, data) {
  const dbi = ensureDb()
  const updates = { updatedAt: new Date() }
  if (typeof data.title === 'string') updates.title = data.title
  if (typeof data.body === 'string') updates.body = data.body
  if (data.settings) updates.settings = data.settings
  await dbi
    .collection('scripts')
    .updateOne({ _id: asObjectId(id) }, { $set: updates })
  return getScript(id)
}

async function deleteScript(id) {
  const dbi = ensureDb()
  const oid = asObjectId(id)
  await Promise.all([
    dbi.collection('scripts').deleteOne({ _id: oid }),
    dbi.collection('scriptVersions').deleteMany({ scriptId: oid })
  ])
  return { ok: true }
}

async function snapshotScript(id) {
  const dbi = ensureDb()
  const oid = asObjectId(id)
  const s = await dbi.collection('scripts').findOne({ _id: oid })
  if (!s) throw new Error('script not found')
  const doc = {
    scriptId: oid,
    body: s.body,
    savedAt: new Date()
  }
  const r = await dbi.collection('scriptVersions').insertOne(doc)
  // keep only last 30 versions per script
  const old = await dbi
    .collection('scriptVersions')
    .find({ scriptId: oid })
    .sort({ savedAt: -1 })
    .skip(30)
    .toArray()
  if (old.length) {
    await dbi
      .collection('scriptVersions')
      .deleteMany({ _id: { $in: old.map((o) => o._id) } })
  }
  return toClient({ ...doc, _id: r.insertedId })
}

async function listVersions(id) {
  const dbi = ensureDb()
  const docs = await dbi
    .collection('scriptVersions')
    .find({ scriptId: asObjectId(id) }, { projection: { body: 0 } })
    .sort({ savedAt: -1 })
    .toArray()
  return docs.map(toClient)
}

async function restoreVersion(id, versionId) {
  const dbi = ensureDb()
  const v = await dbi
    .collection('scriptVersions')
    .findOne({ _id: asObjectId(versionId) })
  if (!v) throw new Error('version not found')
  await dbi
    .collection('scripts')
    .updateOne(
      { _id: asObjectId(id) },
      { $set: { body: v.body, updatedAt: new Date() } }
    )
  return getScript(id)
}

// ---------- sessions ----------

async function startSession({ scriptId, settingsSnapshot }) {
  const dbi = ensureDb()
  const doc = {
    scriptId: scriptId ? asObjectId(scriptId) : null,
    startedAt: new Date(),
    endedAt: null,
    settingsSnapshot: settingsSnapshot || {}
  }
  const r = await dbi.collection('sessions').insertOne(doc)
  return toClient({ ...doc, _id: r.insertedId })
}

async function endSession(id) {
  if (!id) return null
  const dbi = ensureDb()
  const oid = asObjectId(id)
  await dbi
    .collection('sessions')
    .updateOne({ _id: oid }, { $set: { endedAt: new Date() } })
  return toClient(await dbi.collection('sessions').findOne({ _id: oid }))
}

async function logEvent(sessionId, tMs, type, payload) {
  if (!sessionId) return null
  const dbi = ensureDb()
  const doc = {
    sessionId: asObjectId(sessionId),
    tMs: Number(tMs) || 0,
    type: String(type),
    payload: payload || {}
  }
  const r = await dbi.collection('sessionEvents').insertOne(doc)
  return toClient({ ...doc, _id: r.insertedId })
}

async function listSessions(scriptId) {
  const dbi = ensureDb()
  const q = scriptId ? { scriptId: asObjectId(scriptId) } : {}
  const docs = await dbi
    .collection('sessions')
    .find(q)
    .sort({ startedAt: -1 })
    .limit(50)
    .toArray()
  return docs.map(toClient)
}

async function getSession(id) {
  const dbi = ensureDb()
  const oid = asObjectId(id)
  const [s, events] = await Promise.all([
    dbi.collection('sessions').findOne({ _id: oid }),
    dbi
      .collection('sessionEvents')
      .find({ sessionId: oid })
      .sort({ tMs: 1 })
      .toArray()
  ])
  if (!s) return null
  return { ...toClient(s), events: events.map(toClient) }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  listScripts,
  getScript,
  createScript,
  updateScript,
  deleteScript,
  snapshotScript,
  listVersions,
  restoreVersion,
  startSession,
  endSession,
  logEvent,
  listSessions,
  getSession
}
