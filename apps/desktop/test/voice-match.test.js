/*
 * Unit tests for lib/voice-match.js.
 *
 * Run with:    node --test test/voice-match.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeWord, tokenize, buildVoiceWords, findBestMatch, wordSimilarity } = require('../lib/voice-match')

test('tokenize: connector punctuation becomes word boundaries', () => {
  assert.deepEqual(tokenize('desktop-level state/of/the/art'), [
    'desktop',
    'level',
    'state',
    'of',
    'the',
    'art'
  ])
})

test('tokenize: apostrophes do not prevent common speech matches', () => {
  assert.deepEqual(tokenize("Don't stop"), ['dont', 'stop'])
})

test('tokenize: normalizes common speech-to-text variants', () => {
  assert.deepEqual(tokenize('electronjs BrowserWindow nodejs models dialogues render'), [
    'electron',
    'js',
    'browser',
    'window',
    'node',
    'js',
    'modals',
    'dialogs',
    'renderer'
  ])
})

test('tokenize: normalizes Hindi Devanagari transcript to Roman Hindi words', () => {
  assert.deepEqual(tokenize('एक गांव में एक छोटी बच्ची थी'), [
    'ek',
    'gaon',
    'me',
    'ek',
    'choti',
    'bachi',
    'thi'
  ])
})

test('normalizeWord: handles Hindi spelling variants used by Deepgram', () => {
  assert.equal(normalizeWord('में'), 'me')
  assert.equal(normalizeWord('गांव'), 'gaon')
  assert.equal(normalizeWord('छोटी'), 'choti')
  assert.equal(normalizeWord('बच्ची'), 'bachi')
})

test('buildVoiceWords: split hyphenated script words while preserving offsets', () => {
  assert.deepEqual(buildVoiceWords('Say desktop-level now.'), [
    { w: 'say', at: 0, end: 3 },
    { w: 'desktop', at: 4, end: 11 },
    { w: 'level', at: 12, end: 17 },
    { w: 'now', at: 18, end: 21 }
  ])
})

test('wordSimilarity: tolerates close speech-recognition variants', () => {
  assert.ok(wordSimilarity('modals', 'models') >= 0.8)
  assert.ok(wordSimilarity('renderer', 'render') >= 0.8)
  assert.ok(wordSimilarity('applications', 'application') >= 0.8)
  assert.ok(wordSimilarity('desktop', 'dextop') >= 0.8)
  assert.equal(wordSimilarity('desktop', 'backend'), 0)
})

test('findBestMatch: can catch up when the speaker starts ahead of the cursor', () => {
  const script = [
    'For a Postman desktop app, we will use Electron.js.',
    'Basically, Electron.js is a JavaScript framework that lets you build desktop applications',
    'using web technologies like React, Angular, and so on.',
    'These are some famous apps built with Electron: VS Code, Slack desktop app, Discord desktop app, Postman.'
  ].join(' ')
  const words = buildVoiceWords(script)
  const spoken = tokenize('technologies like react angular and so on these are some famous apps')
  const match = findBestMatch(words, spoken, 0, { lookAhead: 90 })
  assert.ok(match)
  assert.equal(words[match.matchedIndex].w, 'apps')
})

test('findBestMatch: tolerates common STT variants and inserted words', () => {
  const words = buildVoiceWords('VS Code Slack desktop app Discord desktop app Postman Figma desktop app')
  const spoken = tokenize('versus code slack desktop app disc discord desktop app and postman')
  const match = findBestMatch(words, spoken, 0, { lookAhead: 40 })
  assert.ok(match)
  assert.equal(words[match.matchedIndex].w, 'postman')
})

test('findBestMatch: matches Devanagari Hindi transcript against Roman Hindi script', () => {
  const words = buildVoiceWords('ek gaon me ek choti bachi thi')
  const spoken = tokenize('एक गांव में एक छोटी बच्ची थी')
  const match = findBestMatch(words, spoken, 0, { lookAhead: 20 })
  assert.ok(match)
  assert.equal(words[match.matchedIndex].w, 'thi')
})

test('findBestMatch: exposes repeated-phrase matches for caller-side jump guard', () => {
  const script = [
    'Desktop APIs are used to communicate with the user computer or operating system.',
    'HTTP APIs are used to communicate with a remote backend server over the internet.'
  ].join(' ')
  const words = buildVoiceWords(script)
  const spoken = tokenize('desktop apis are used to communicate with users')
  const match = findBestMatch(words, spoken, 6, { searchBack: 3, lookAhead: 20 })
  assert.ok(match)
  assert.ok(match.matchedIndex > 6)
  assert.ok(match.confidence < 0.85)
})

test('findBestMatch: does not get stuck on modals heard as models', () => {
  const words = buildVoiceWords('The login page, buttons, forms, modals, tables, and all the UI screens')
  const spoken = tokenize('buttons forms models')
  const match = findBestMatch(words, spoken, 3, { searchBack: 3, lookAhead: 16 })
  assert.ok(match)
  assert.equal(words[match.matchedIndex].w, 'modals')
})

test('findBestMatch: short chunk can advance past one filler word at cursor', () => {
  const words = buildVoiceWords('The login page, buttons, forms, modals, tables, and all the UI screens')
  const spoken = tokenize('tab tables')
  const match = findBestMatch(words, spoken, 5, { searchBack: 3, lookAhead: 16 })
  assert.ok(match)
  assert.equal(words[match.matchedIndex].w, 'tables')
})
