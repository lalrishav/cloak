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

test('homepage: serves the interactive Cue landing page at /', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())

  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /Download for macOS/)
  assert.match(res.body, /\/v1\/download\/darwin/)
})

test('homepage: /download serves the same landing page', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())

  const res = await app.inject({ method: 'GET', url: '/download' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /Capture-aware teleprompter/)
  assert.match(res.body, /Try the preview/)
})

test('release-info: reports latest stable release platforms', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())

  await db.createRelease(
    {
      version: '1.0.0',
      channel: 'stable',
      assets: { darwin: { url: 'https://downloads.example.com/Cue.dmg' } }
    },
    'test'
  )

  const res = await app.inject({ method: 'GET', url: '/v1/release-info' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().version, '1.0.0')
  assert.deepEqual(res.json().platforms, ['darwin'])
})

test('download: darwin route records and redirects to hosted dmg', async (t) => {
  const app = await freshApp()
  t.after(() => app.close())

  await db.createRelease(
    {
      version: '1.0.0',
      channel: 'stable',
      assets: { darwin: { url: 'https://downloads.example.com/Cue-1.0.0-arm64.dmg' } }
    },
    'test'
  )

  const res = await app.inject({ method: 'GET', url: '/v1/download/darwin' })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, 'https://downloads.example.com/Cue-1.0.0-arm64.dmg')

  const downloads = await db.listDownloads({})
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].os, 'darwin')
})
