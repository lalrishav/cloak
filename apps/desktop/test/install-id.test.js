'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { getInstallId } = require('../lib/install-id')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cue-installid-'))
}

test('getInstallId: creates an id file when none exists', (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const id = getInstallId(dir)
  assert.ok(id)
  assert.equal(typeof id, 'string')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'install-id.json'), 'utf8'))
  assert.equal(saved.installId, id)
  assert.ok(saved.createdAt)
})

test('getInstallId: returns the same id on subsequent calls', (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = getInstallId(dir)
  const b = getInstallId(dir)
  assert.equal(a, b)
})

test('getInstallId: regenerates when the file is corrupt', (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'install-id.json'), 'not json at all')
  const id = getInstallId(dir)
  assert.ok(id)
  // it rewrote a valid file
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'install-id.json'), 'utf8'))
  assert.equal(saved.installId, id)
})

test('getInstallId: regenerates when installId field is missing', (t) => {
  const dir = tmpDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'install-id.json'), JSON.stringify({ somethingElse: true }))
  const id = getInstallId(dir)
  assert.ok(id && typeof id === 'string')
})

test('getInstallId: returns an ephemeral id when the dir cannot be written', () => {
  // a path that cannot be created as a directory (a file exists at a parent)
  const dir = tmpDir()
  const blocker = path.join(dir, 'blocker')
  fs.writeFileSync(blocker, 'i am a file')
  const unwritable = path.join(blocker, 'nested', 'userData')
  const id = getInstallId(unwritable)
  assert.ok(id && typeof id === 'string')
  fs.rmSync(dir, { recursive: true, force: true })
})
