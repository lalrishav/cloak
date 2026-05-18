'use strict'
/*
 * MongoDB layer for the Cloak backend API.
 *
 * Mirrors the conventions of apps/desktop/lib/db.js: connect({uri,dbName}) with a
 * short server-selection timeout, idempotent createIndex calls inside connect(),
 * a toClient(doc) that maps _id -> id, and async repo methods returning plain
 * objects.
 *
 * Unlike the desktop app (where Mongo is an optional local cache), the API treats
 * a missing connection as a hard error: repo methods throw 'mongo not connected'
 * and the route layer turns that into a 503.
 *
 * Collections: installs, appBoots, downloads, events, releases, versionPolicies.
 * Database name defaults to "cue_cloud" — deliberately separate from the desktop
 * app's local "cloak" db.
 */
const { MongoClient, ObjectId } = require('mongodb')
const versionLib = require('./lib/version')

const DEFAULT_URI = process.env.CLOAK_CLOUD_MONGO_URI || 'mongodb://127.0.0.1:27017'
const DEFAULT_DB = process.env.CLOAK_CLOUD_MONGO_DB || 'cloak_cloud'

const DAY_MS = 24 * 60 * 60 * 1000

let client = null
let db = null
let status = { connected: false, error: null, uri: DEFAULT_URI, dbName: DEFAULT_DB }

async function connect({ uri = DEFAULT_URI, dbName = DEFAULT_DB } = {}) {
  if (client) {
    try { await client.close() } catch { /* ignore */ }
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

    await Promise.all([
      db.collection('installs').createIndex({ installId: 1 }, { unique: true }),
      db.collection('installs').createIndex({ lastSeenAt: -1 }),
      db.collection('installs').createIndex({ lastVersion: 1 }),
      db.collection('appBoots').createIndex({ ts: -1 }),
      db.collection('appBoots').createIndex({ version: 1, ts: -1 }),
      db.collection('appBoots').createIndex({ installId: 1, ts: -1 }),
      db.collection('downloads').createIndex({ ts: -1 }),
      db.collection('downloads').createIndex({ os: 1, ts: -1 }),
      db.collection('events').createIndex({ receivedAt: -1 }),
      db.collection('events').createIndex({ installId: 1, receivedAt: -1 }),
      db.collection('events').createIndex({ sessionId: 1, tMs: 1 }),
      db.collection('events').createIndex({ type: 1, receivedAt: -1 }),
      db.collection('events').createIndex({ batchId: 1 }),
      db.collection('releases').createIndex({ channel: 1, createdAt: -1 }),
      db.collection('releases').createIndex({ version: 1 }),
      db
        .collection('versionPolicies')
        .createIndex({ version: 1, channel: 1, platform: 1 }, { unique: true })
    ])

    await seedDefaultPolicy()
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
    try { await client.close() } catch { /* ignore */ }
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
  const out = { ...doc }
  if (doc._id != null) {
    out.id = doc._id.toString()
    delete out._id
  }
  return out
}

function asObjectId(id) {
  if (id && typeof id === 'object' && id._bsontype === 'ObjectId') return id
  try {
    return new ObjectId(String(id))
  } catch {
    throw new Error('invalid id: ' + id)
  }
}

// Bucket docs into per-day counts for the last `days` days (oldest -> newest).
function bucketByDay(docs, field, days) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = []
  const index = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    const key = d.toISOString().slice(0, 10)
    const b = { date: key, count: 0 }
    buckets.push(b)
    index[key] = b
  }
  for (const doc of docs) {
    if (!doc[field]) continue
    const key = new Date(doc[field]).toISOString().slice(0, 10)
    if (index[key]) index[key].count++
  }
  return buckets
}

// ---------- version policies ----------

async function seedDefaultPolicy() {
  const dbi = ensureDb()
  const now = new Date()
  await dbi.collection('versionPolicies').updateOne(
    { version: '*', channel: '*', platform: '*' },
    {
      $setOnInsert: {
        version: '*',
        channel: '*',
        platform: '*',
        status: 'allowed',
        minVersion: '1.0.0',
        latestVersion: '1.0.0',
        message: '',
        updateUrl: '',
        featureFlags: {},
        createdAt: now,
        updatedAt: now,
        updatedBy: 'system'
      }
    },
    { upsert: true }
  )
}

async function listVersionPolicies() {
  const dbi = ensureDb()
  const docs = await dbi.collection('versionPolicies').find({}).sort({ updatedAt: -1 }).toArray()
  return docs.map(toClient)
}

async function resolvePolicy({ version, channel, platform }) {
  const dbi = ensureDb()
  const rows = await dbi.collection('versionPolicies').find({}).toArray()
  const picked = versionLib.resolvePolicy(rows, { version, channel, platform })
  return picked ? toClient(picked) : null
}

async function upsertVersionPolicy(input, updatedBy) {
  const dbi = ensureDb()
  const now = new Date()
  const version = input.version || '*'
  const channel = input.channel || '*'
  const platform = input.platform || '*'
  await dbi.collection('versionPolicies').updateOne(
    { version, channel, platform },
    {
      $set: {
        status: input.status || 'allowed',
        minVersion: input.minVersion || '1.0.0',
        latestVersion: input.latestVersion || '1.0.0',
        message: input.message || '',
        updateUrl: input.updateUrl || '',
        featureFlags: input.featureFlags || {},
        updatedAt: now,
        updatedBy: updatedBy || 'admin'
      },
      $setOnInsert: { version, channel, platform, createdAt: now }
    },
    { upsert: true }
  )
  return toClient(
    await dbi.collection('versionPolicies').findOne({ version, channel, platform })
  )
}

async function deleteVersionPolicy(id) {
  const dbi = ensureDb()
  const oid = asObjectId(id)
  const doc = await dbi.collection('versionPolicies').findOne({ _id: oid })
  if (!doc) return { ok: false, reason: 'not found' }
  if (doc.version === '*' && doc.channel === '*' && doc.platform === '*') {
    throw new Error('cannot delete the default (*/*/*) policy')
  }
  await dbi.collection('versionPolicies').deleteOne({ _id: oid })
  return { ok: true }
}

// ---------- installs / boots ----------

async function recordBoot({ installId, version, os, arch, channel, decision, message }) {
  const dbi = ensureDb()
  const now = new Date()
  await dbi.collection('installs').updateOne(
    { installId },
    {
      $setOnInsert: { installId, firstSeenAt: now },
      $set: {
        lastSeenAt: now,
        lastVersion: version,
        os: os || 'unknown',
        arch: arch || 'unknown',
        channel: channel || 'stable'
      },
      $inc: { bootCount: 1 }
    },
    { upsert: true }
  )
  await dbi.collection('appBoots').insertOne({
    installId,
    version,
    os: os || 'unknown',
    arch: arch || 'unknown',
    channel: channel || 'stable',
    decision,
    ts: now
  })
  const evType = decision === 'allowed' ? 'version_allowed' : 'version_blocked'
  await dbi.collection('events').insertOne({
    installId,
    version,
    sessionId: null,
    batchId: null,
    type: evType,
    tMs: 0,
    ts: now,
    receivedAt: now,
    payload: { decision, message: message || '' }
  })
}

async function listInstalls({ limit = 100, skip = 0 } = {}) {
  const dbi = ensureDb()
  const docs = await dbi
    .collection('installs')
    .find({})
    .sort({ lastSeenAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()
  const total = await dbi.collection('installs').countDocuments({})
  return { items: docs.map(toClient), total }
}

async function getInstall(installId) {
  const dbi = ensureDb()
  const doc = await dbi.collection('installs').findOne({ installId })
  return doc ? toClient(doc) : null
}

// ---------- releases ----------

async function listReleases(channel) {
  const dbi = ensureDb()
  const q = channel ? { channel } : {}
  const docs = await dbi.collection('releases').find(q).sort({ createdAt: -1 }).toArray()
  return docs.map(toClient)
}

async function createRelease(input, publishedBy) {
  const dbi = ensureDb()
  const now = new Date()
  const doc = {
    version: String(input.version),
    channel: input.channel || 'stable',
    notes: input.notes || '',
    assets: input.assets || {},
    createdAt: now,
    publishedBy: publishedBy || 'admin'
  }
  const r = await dbi.collection('releases').insertOne(doc)
  return toClient({ ...doc, _id: r.insertedId })
}

async function getLatestRelease(channel) {
  const dbi = ensureDb()
  const q = channel ? { channel } : {}
  const docs = await dbi.collection('releases').find(q).sort({ createdAt: -1 }).limit(1).toArray()
  return docs.length ? toClient(docs[0]) : null
}

// ---------- downloads ----------

async function recordDownload({ os, version, channel, referrer, ua, ipHash }) {
  const dbi = ensureDb()
  const now = new Date()
  const doc = {
    os: os || 'unknown',
    version: version || null,
    channel: channel || 'stable',
    referrer: referrer || '',
    ua: ua || '',
    ipHash: ipHash || '',
    ts: now
  }
  const r = await dbi.collection('downloads').insertOne(doc)
  return toClient({ ...doc, _id: r.insertedId })
}

async function listDownloads({ from, to, limit = 200 } = {}) {
  const dbi = ensureDb()
  const q = {}
  if (from || to) {
    q.ts = {}
    if (from) q.ts.$gte = new Date(from)
    if (to) q.ts.$lte = new Date(to)
  }
  const docs = await dbi.collection('downloads').find(q).sort({ ts: -1 }).limit(limit).toArray()
  return docs.map(toClient)
}

// ---------- events ----------

async function insertEventBatch({ installId, version, batchId, events }) {
  const dbi = ensureDb()
  // idempotency: a re-sent batch (offline-queue retry) is a no-op
  if (batchId) {
    const existing = await dbi.collection('events').findOne({ batchId })
    if (existing) {
      const n = await dbi.collection('events').countDocuments({ batchId })
      return { accepted: 0, duplicate: true, alreadyHave: n }
    }
  }
  const receivedAt = new Date()
  const rows = (events || []).map((e) => ({
    installId,
    version: version || null,
    sessionId: e.sessionId != null ? String(e.sessionId) : null,
    batchId: batchId || null,
    type: String(e.type),
    tMs: Number(e.tMs) || 0,
    ts: e.ts ? new Date(e.ts) : receivedAt,
    receivedAt,
    payload: e.payload && typeof e.payload === 'object' ? e.payload : {}
  }))
  if (!rows.length) return { accepted: 0, duplicate: false }
  await dbi.collection('events').insertMany(rows)
  return { accepted: rows.length, duplicate: false }
}

async function listEvents({ installId, type, sessionId, limit = 200, skip = 0 } = {}) {
  const dbi = ensureDb()
  const q = {}
  if (installId) q.installId = installId
  if (type) q.type = type
  if (sessionId) q.sessionId = String(sessionId)
  const docs = await dbi
    .collection('events')
    .find(q)
    .sort({ receivedAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()
  return docs.map(toClient)
}

async function listErrors({ limit = 200 } = {}) {
  const dbi = ensureDb()
  const docs = await dbi
    .collection('events')
    .find({ type: 'error' })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray()
  return docs.map(toClient)
}

// Group telemetry events into "cloud sessions" by their (client-minted) sessionId.
async function listCloudSessions({ limit = 50 } = {}) {
  const dbi = ensureDb()
  const events = await dbi.collection('events').find({ sessionId: { $ne: null } }).toArray()
  const map = new Map()
  for (const e of events) {
    if (!e.sessionId) continue
    let s = map.get(e.sessionId)
    if (!s) {
      s = {
        sessionId: e.sessionId,
        installId: e.installId,
        version: e.version,
        eventCount: 0,
        firstAt: e.ts,
        lastAt: e.ts,
        types: {}
      }
      map.set(e.sessionId, s)
    }
    s.eventCount++
    s.types[e.type] = (s.types[e.type] || 0) + 1
    if (new Date(e.ts) < new Date(s.firstAt)) s.firstAt = e.ts
    if (new Date(e.ts) > new Date(s.lastAt)) s.lastAt = e.ts
  }
  return [...map.values()]
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
    .slice(0, limit)
}

// One cloud session with its events on the tMs axis — same shape concept as the
// desktop app's db.getSession(id): { ...session, events: [...] }.
async function getCloudSession(sessionId) {
  const dbi = ensureDb()
  const events = await dbi
    .collection('events')
    .find({ sessionId: String(sessionId) })
    .sort({ tMs: 1 })
    .toArray()
  if (!events.length) return null
  const first = events[0]
  return {
    sessionId: String(sessionId),
    installId: first.installId,
    version: first.version,
    eventCount: events.length,
    events: events.map(toClient)
  }
}

async function activeSessions({ windowMs = 5 * 60 * 1000 } = {}) {
  const dbi = ensureDb()
  const cutoff = new Date(Date.now() - windowMs)
  const events = await dbi
    .collection('events')
    .find({ sessionId: { $ne: null }, receivedAt: { $gte: cutoff } })
    .toArray()
  const map = new Map()
  for (const e of events) {
    let s = map.get(e.sessionId)
    if (!s) {
      s = {
        sessionId: e.sessionId,
        installId: e.installId,
        version: e.version,
        lastAt: e.receivedAt,
        eventCount: 0
      }
      map.set(e.sessionId, s)
    }
    s.eventCount++
    if (new Date(e.receivedAt) > new Date(s.lastAt)) s.lastAt = e.receivedAt
  }
  return [...map.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
}

// ---------- stats ----------

async function statsOverview({ activeWindowDays = 30 } = {}) {
  const dbi = ensureDb()
  const now = Date.now()
  const [installs, boots, downloads] = await Promise.all([
    dbi.collection('installs').find({}).toArray(),
    dbi.collection('appBoots').find({}).toArray(),
    dbi.collection('downloads').find({}).toArray()
  ])

  const versionDist = {}
  const osDist = {}
  for (const i of installs) {
    const v = i.lastVersion || 'unknown'
    versionDist[v] = (versionDist[v] || 0) + 1
    const o = i.os || 'unknown'
    osDist[o] = (osDist[o] || 0) + 1
  }

  const activeInstalls = installs.filter(
    (i) => i.lastSeenAt && now - new Date(i.lastSeenAt).getTime() < activeWindowDays * DAY_MS
  ).length

  const dau = new Set(
    boots.filter((b) => now - new Date(b.ts).getTime() < DAY_MS).map((b) => b.installId)
  ).size
  const mau = new Set(
    boots.filter((b) => now - new Date(b.ts).getTime() < 30 * DAY_MS).map((b) => b.installId)
  ).size

  return {
    totalInstalls: installs.length,
    activeInstalls,
    totalBoots: boots.length,
    totalDownloads: downloads.length,
    dau,
    mau,
    versionDist,
    osDist,
    bootsByDay: bucketByDay(boots, 'ts', 30),
    downloadsByDay: bucketByDay(downloads, 'ts', 30)
  }
}

async function versionHealth() {
  const dbi = ensureDb()
  const [installs, policies] = await Promise.all([
    dbi.collection('installs').find({}).toArray(),
    dbi.collection('versionPolicies').find({}).toArray()
  ])
  const def =
    policies.find((p) => p.version === '*' && p.channel === '*' && p.platform === '*') || {}
  const byVersion = {}
  for (const i of installs) {
    const v = i.lastVersion || 'unknown'
    byVersion[v] = (byVersion[v] || 0) + 1
  }
  const versions = Object.entries(byVersion).map(([version, count]) => ({
    version,
    count,
    blocked: policies.some((p) => p.version === version && p.status === 'blocked'),
    deprecated: policies.some((p) => p.version === version && p.status === 'deprecated'),
    outdated: def.minVersion ? versionLib.isUpdateRequired(version, def.minVersion) : false
  }))
  versions.sort((a, b) => versionLib.compare(b.version, a.version))
  return {
    latestVersion: def.latestVersion || null,
    minVersion: def.minVersion || null,
    totalInstalls: installs.length,
    versions
  }
}

async function usageStats({ from, to } = {}) {
  const dbi = ensureDb()
  const q = {}
  if (from || to) {
    q.receivedAt = {}
    if (from) q.receivedAt.$gte = new Date(from)
    if (to) q.receivedAt.$lte = new Date(to)
  }
  const events = await dbi.collection('events').find(q).toArray()
  const byType = {}
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1
  const distinctSessions = new Set(
    events.filter((e) => e.sessionId).map((e) => e.sessionId)
  ).size
  return {
    totalEvents: events.length,
    distinctSessions,
    byType,
    eventsByDay: bucketByDay(events, 'receivedAt', 30)
  }
}

// ---------- privacy ----------

async function deleteInstallData(installId) {
  const dbi = ensureDb()
  const [r1, r2, r3] = await Promise.all([
    dbi.collection('installs').deleteMany({ installId }),
    dbi.collection('appBoots').deleteMany({ installId }),
    dbi.collection('events').deleteMany({ installId })
  ])
  return {
    ok: true,
    deleted: {
      installs: r1.deletedCount || 0,
      appBoots: r2.deletedCount || 0,
      events: r3.deletedCount || 0
    }
  }
}

async function exportInstallData(installId) {
  const dbi = ensureDb()
  const [install, boots, events] = await Promise.all([
    dbi.collection('installs').findOne({ installId }),
    dbi.collection('appBoots').find({ installId }).sort({ ts: 1 }).toArray(),
    dbi.collection('events').find({ installId }).sort({ receivedAt: 1 }).toArray()
  ])
  return {
    installId,
    exportedAt: new Date().toISOString(),
    install: toClient(install),
    appBoots: boots.map(toClient),
    events: events.map(toClient)
  }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  // version policies
  seedDefaultPolicy,
  listVersionPolicies,
  resolvePolicy,
  upsertVersionPolicy,
  deleteVersionPolicy,
  // installs / boots
  recordBoot,
  listInstalls,
  getInstall,
  // releases
  listReleases,
  createRelease,
  getLatestRelease,
  // downloads
  recordDownload,
  listDownloads,
  // events
  insertEventBatch,
  listEvents,
  listErrors,
  listCloudSessions,
  getCloudSession,
  activeSessions,
  // stats
  statsOverview,
  versionHealth,
  usageStats,
  // privacy
  deleteInstallData,
  exportInstallData
}
