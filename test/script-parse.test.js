/*
 * Unit tests for lib/script-parse.js.
 *
 * Run with:    node --test test/script-parse.test.js
 * Coverage:    npm run coverage
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parse,
  parseTokenBody,
  parseDuration,
  describeMarker,
  formatDuration,
  tokenFor,
  KNOWN_REACTIONS,
  REACTION_GLYPHS
} = require('../lib/script-parse')

// ---------- parseDuration ----------
test('parseDuration: seconds default', () => {
  assert.equal(parseDuration('3'), 3000)
  assert.equal(parseDuration('3s'), 3000)
})

test('parseDuration: milliseconds', () => {
  assert.equal(parseDuration('500ms'), 500)
})

test('parseDuration: fractional seconds', () => {
  assert.equal(parseDuration('1.5s'), 1500)
})

test('parseDuration: integer with explicit s', () => {
  assert.equal(parseDuration('10s'), 10000)
})

test('parseDuration: zero', () => {
  assert.equal(parseDuration('0'), 0)
  assert.equal(parseDuration('0s'), 0)
  assert.equal(parseDuration('0ms'), 0)
})

test('parseDuration: surrounding whitespace tolerated', () => {
  assert.equal(parseDuration('  2s  '), 2000)
})

test('parseDuration: invalid strings return null', () => {
  assert.equal(parseDuration('abc'), null)
  assert.equal(parseDuration(''), null)
  assert.equal(parseDuration('  '), null)
  assert.equal(parseDuration('1.2.3'), null)
  assert.equal(parseDuration('1minute'), null)
})

test('parseDuration: nullish input returns null', () => {
  assert.equal(parseDuration(null), null)
  assert.equal(parseDuration(undefined), null)
})

test('parseDuration: negative not allowed', () => {
  assert.equal(parseDuration('-3s'), null)
})

test('parseDuration: numeric coercion (number coerces to string)', () => {
  assert.equal(parseDuration(5), 5000)
})

// ---------- parseTokenBody: pause ----------
test('parseTokenBody: bare pause', () => {
  const r = parseTokenBody('pause')
  assert.equal(r.cueType, 'pause')
  assert.deepEqual(r.payload, {})
  assert.ok(!r.error)
})

test('parseTokenBody: timed pause seconds', () => {
  const r = parseTokenBody('pause 3s')
  assert.equal(r.cueType, 'pause')
  assert.equal(r.payload.durationMs, 3000)
})

test('parseTokenBody: timed pause ms', () => {
  const r = parseTokenBody('pause 750ms')
  assert.equal(r.payload.durationMs, 750)
})

test('parseTokenBody: pause with bad duration sets error', () => {
  const r = parseTokenBody('pause forever')
  assert.equal(r.cueType, 'pause')
  assert.ok(r.error)
})

// ---------- parseTokenBody: stop / breath ----------
test('parseTokenBody: stop', () => {
  const r = parseTokenBody('stop')
  assert.equal(r.cueType, 'stop')
  assert.ok(!r.error)
})

test('parseTokenBody: breath', () => {
  const r = parseTokenBody('breath')
  assert.equal(r.cueType, 'breath')
  assert.ok(!r.error)
})

// ---------- parseTokenBody: react ----------
test('parseTokenBody: react smile', () => {
  const r = parseTokenBody('react smile')
  assert.equal(r.cueType, 'react')
  assert.equal(r.payload.reaction, 'smile')
  assert.equal(r.payload.glyph, '🙂')
  assert.ok(!r.error)
})

test('parseTokenBody: react with duration', () => {
  const r = parseTokenBody('react laugh 2s')
  assert.equal(r.payload.reaction, 'laugh')
  assert.equal(r.payload.durationMs, 2000)
})

test('parseTokenBody: react unknown sets error but keeps reaction', () => {
  const r = parseTokenBody('react zorp')
  assert.equal(r.payload.reaction, 'zorp')
  assert.equal(r.payload.glyph, '⚡')
  assert.ok(r.error)
})

test('parseTokenBody: react missing reaction', () => {
  const r = parseTokenBody('react')
  assert.equal(r.cueType, 'react')
  assert.equal(r.error, 'missing reaction')
})

test('parseTokenBody: react bad duration', () => {
  const r = parseTokenBody('react smile garbage')
  assert.equal(r.payload.reaction, 'smile')
  assert.match(r.error, /bad duration/)
})

test('parseTokenBody: react unknown + bad duration → unknown error wins', () => {
  const r = parseTokenBody('react zorp bogus')
  assert.match(r.error, /unknown reaction/)
})

// ---------- parseTokenBody: chapter ----------
test('parseTokenBody: chapter with colon', () => {
  const r = parseTokenBody('chapter: Intro')
  assert.equal(r.cueType, 'chapter')
  assert.equal(r.payload.title, 'Intro')
})

test('parseTokenBody: chapter without colon', () => {
  const r = parseTokenBody('chapter Outro')
  assert.equal(r.cueType, 'chapter')
  assert.equal(r.payload.title, 'Outro')
})

test('parseTokenBody: chapter with empty title (colon form)', () => {
  const r = parseTokenBody('chapter:')
  assert.equal(r.payload.title, 'Untitled')
})

test('parseTokenBody: chapter with empty title (bare form)', () => {
  const r = parseTokenBody('chapter')
  assert.equal(r.payload.title, 'Untitled')
})

// ---------- parseTokenBody: note ----------
test('parseTokenBody: note', () => {
  const r = parseTokenBody('note: only camera 2')
  assert.equal(r.cueType, 'note')
  assert.equal(r.payload.text, 'only camera 2')
})

test('parseTokenBody: note without colon', () => {
  const r = parseTokenBody('note something here')
  assert.equal(r.cueType, 'note')
  assert.equal(r.payload.text, 'something here')
})

// ---------- parseTokenBody: unknown / empty ----------
test('parseTokenBody: unknown cue', () => {
  const r = parseTokenBody('zap')
  assert.equal(r.cueType, 'unknown')
  assert.equal(r.payload.raw, 'zap')
  assert.ok(r.error)
})

test('parseTokenBody: empty body', () => {
  const r = parseTokenBody('')
  assert.equal(r.cueType, 'unknown')
  assert.equal(r.error, 'empty cue')
})

test('parseTokenBody: nullish body', () => {
  const r = parseTokenBody(null)
  assert.equal(r.cueType, 'unknown')
  assert.equal(r.error, 'empty cue')
})

test('parseTokenBody: whitespace-only body', () => {
  const r = parseTokenBody('   ')
  assert.equal(r.cueType, 'unknown')
})

// ---------- parseTokenBody: colon-syntax flexibility ----------
test('parseTokenBody: react: wave colon-syntax', () => {
  const r = parseTokenBody('react: wave')
  assert.equal(r.cueType, 'react')
  assert.equal(r.payload.reaction, 'wave')
  assert.ok(!r.error)
})

test('parseTokenBody: pause: 3s colon-syntax', () => {
  const r = parseTokenBody('pause: 3s')
  assert.equal(r.cueType, 'pause')
  assert.equal(r.payload.durationMs, 3000)
})

test('parseTokenBody: stop: colon-syntax', () => {
  const r = parseTokenBody('stop:')
  assert.equal(r.cueType, 'stop')
})

test('parseTokenBody: react: smile 2s colon + duration', () => {
  const r = parseTokenBody('react: smile 2s')
  assert.equal(r.payload.reaction, 'smile')
  assert.equal(r.payload.durationMs, 2000)
})

test('parseTokenBody: breath: colon-syntax', () => {
  const r = parseTokenBody('breath:')
  assert.equal(r.cueType, 'breath')
})

// ---------- parse: empty / plain ----------
test('parse: empty string', () => {
  const r = parse('')
  assert.deepEqual(r.segments, [])
  assert.deepEqual(r.markers, [])
  assert.equal(r.plainText, '')
})

test('parse: non-string returns empty', () => {
  assert.deepEqual(parse(null).markers, [])
  assert.deepEqual(parse(undefined).markers, [])
  assert.deepEqual(parse(42).markers, [])
})

test('parse: plain text only', () => {
  const r = parse('Hello world.')
  assert.equal(r.segments.length, 1)
  assert.equal(r.segments[0].type, 'text')
  assert.equal(r.segments[0].text, 'Hello world.')
  assert.equal(r.markers.length, 0)
  assert.equal(r.plainText, 'Hello world.')
})

// ---------- parse: cues ----------
test('parse: single pause splits text', () => {
  const r = parse('Welcome [[pause]] everyone.')
  assert.equal(r.segments.length, 3)
  assert.equal(r.segments[0].text, 'Welcome ')
  assert.equal(r.segments[1].type, 'cue')
  assert.equal(r.segments[1].cueType, 'pause')
  assert.equal(r.segments[2].text, ' everyone.')
  assert.equal(r.plainText, 'Welcome  everyone.')
})

test('parse: marker charOffset points into plainText', () => {
  const r = parse('Welcome[[pause]] everyone.')
  const m = r.markers[0]
  assert.equal(m.charOffset, 7)
  assert.equal(r.plainText.slice(m.charOffset), ' everyone.')
})

test('parse: multiple cues yield ordered markers', () => {
  const r = parse('A [[pause]] B [[stop]] C')
  assert.equal(r.markers.length, 2)
  assert.equal(r.markers[0].type, 'pause')
  assert.equal(r.markers[1].type, 'stop')
  assert.ok(r.markers[1].charOffset > r.markers[0].charOffset)
})

test('parse: chapter populates chapters[]', () => {
  const r = parse('Intro [[chapter: Part 1]] body [[chapter: Part 2]] tail')
  assert.equal(r.chapters.length, 2)
  assert.equal(r.chapters[0].title, 'Part 1')
  assert.equal(r.chapters[1].title, 'Part 2')
})

test('parse: unique ids per cue', () => {
  const r = parse('[[pause]] [[pause]] [[pause]]')
  const ids = r.markers.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('parse: malformed cue is captured as error', () => {
  const r = parse('Hello [[wat]] world')
  assert.equal(r.errors.length, 1)
  assert.equal(r.markers[0].type, 'unknown')
})

test('parse: react with custom duration parses', () => {
  const r = parse('[[react wave 1500ms]]')
  assert.equal(r.markers[0].payload.reaction, 'wave')
  assert.equal(r.markers[0].payload.durationMs, 1500)
})

test('parse: notes preserved as markers but contribute no plain text', () => {
  const r = parse('A [[note: aside]] B')
  assert.equal(r.markers.length, 1)
  assert.equal(r.markers[0].type, 'note')
  assert.equal(r.plainText, 'A  B')
})

test('parse: cues at start and end', () => {
  const r = parse('[[chapter: Top]]Hello[[stop]]')
  assert.equal(r.segments[0].type, 'cue')
  assert.equal(r.segments[0].cueType, 'chapter')
  assert.equal(r.segments[r.segments.length - 1].type, 'cue')
  assert.equal(r.segments[r.segments.length - 1].cueType, 'stop')
})

test('parse: adjacent cues with no text between', () => {
  const r = parse('[[pause]][[stop]]')
  assert.equal(r.markers.length, 2)
})

// ---------- parse: warnings ----------
test('parse: mid-script [[stop]] emits warning', () => {
  const r = parse('A [[stop]] B [[pause]] C')
  assert.equal(r.warnings.length, 1)
  assert.equal(r.warnings[0].severity, 'warn')
  assert.match(r.warnings[0].message, /mid-script/)
})

test('parse: final [[stop]] does NOT warn', () => {
  const r = parse('A [[pause]] B [[stop]]')
  assert.equal(r.warnings.length, 0)
})

test('parse: multiple [[stop]]s — only non-final ones warn', () => {
  const r = parse('A [[stop]] B [[stop]] C [[stop]]')
  assert.equal(r.warnings.length, 2)
})

test('parse: no markers, no warnings', () => {
  const r = parse('Hello plain.')
  assert.equal(r.warnings.length, 0)
})

// ---------- tokenFor ----------
test('tokenFor: pause', () => {
  assert.equal(tokenFor('pause'), '[[pause]]')
})

test('tokenFor: pause-timed default', () => {
  assert.equal(tokenFor('pause-timed'), '[[pause 3s]]')
})

test('tokenFor: pause-timed with opts', () => {
  assert.equal(tokenFor('pause-timed', { seconds: 5 }), '[[pause 5s]]')
})

test('tokenFor: stop', () => {
  assert.equal(tokenFor('stop'), '[[stop]]')
})

test('tokenFor: react default', () => {
  assert.equal(tokenFor('react'), '[[react smile]]')
})

test('tokenFor: react with opts', () => {
  assert.equal(tokenFor('react', { reaction: 'wave' }), '[[react wave]]')
})

test('tokenFor: chapter default', () => {
  assert.equal(tokenFor('chapter'), '[[chapter: Section]]')
})

test('tokenFor: chapter with title', () => {
  assert.equal(tokenFor('chapter', { title: 'Q&A' }), '[[chapter: Q&A]]')
})

test('tokenFor: note default', () => {
  assert.equal(tokenFor('note'), '[[note: note to self]]')
})

test('tokenFor: note with text', () => {
  assert.equal(tokenFor('note', { text: 'smile' }), '[[note: smile]]')
})

test('tokenFor: breath', () => {
  assert.equal(tokenFor('breath'), '[[breath]]')
})

test('tokenFor: unknown returns empty', () => {
  assert.equal(tokenFor('unknown-kind'), '')
})

// ---------- describeMarker ----------
test('describeMarker: pause timed', () => {
  const r = parse('[[pause 2s]]')
  assert.equal(describeMarker(r.markers[0]), 'pause 2s')
})

test('describeMarker: bare pause', () => {
  const r = parse('[[pause]]')
  assert.equal(describeMarker(r.markers[0]), 'pause')
})

test('describeMarker: stop', () => {
  const r = parse('[[stop]]')
  assert.equal(describeMarker(r.markers[0]), 'stop')
})

test('describeMarker: react', () => {
  const r = parse('[[react smile]]')
  assert.equal(describeMarker(r.markers[0]), 'react smile')
})

test('describeMarker: react with sub-second duration', () => {
  const r = parse('[[react smile 800ms]]')
  assert.equal(describeMarker(r.markers[0]), 'react smile 800ms')
})

test('describeMarker: react with whole-second duration', () => {
  const r = parse('[[react smile 2s]]')
  assert.equal(describeMarker(r.markers[0]), 'react smile 2s')
})

test('describeMarker: react with no reaction in payload', () => {
  assert.equal(describeMarker({ type: 'react', payload: {} }), 'react ?')
})

test('describeMarker: chapter', () => {
  const r = parse('[[chapter: Intro]]')
  assert.equal(describeMarker(r.markers[0]), 'chapter: Intro')
})

test('describeMarker: note', () => {
  const r = parse('[[note: hi]]')
  assert.equal(describeMarker(r.markers[0]), 'note: hi')
})

test('describeMarker: breath', () => {
  const r = parse('[[breath]]')
  assert.equal(describeMarker(r.markers[0]), 'breath')
})

test('describeMarker: unknown with raw', () => {
  const r = parse('[[zap]]')
  assert.equal(describeMarker(r.markers[0]), '? zap')
})

test('describeMarker: unknown with no payload', () => {
  assert.equal(describeMarker({ type: 'unknown', payload: {} }), '?')
})

test('describeMarker: null/undefined returns empty', () => {
  assert.equal(describeMarker(null), '')
  assert.equal(describeMarker(undefined), '')
})

test('describeMarker: marker with no payload at all', () => {
  assert.equal(describeMarker({ type: 'pause' }), 'pause')
})

// ---------- formatDuration ----------
test('formatDuration: sub-second is ms', () => {
  assert.equal(formatDuration(500), '500ms')
})

test('formatDuration: whole seconds are integers', () => {
  assert.equal(formatDuration(2000), '2s')
})

test('formatDuration: fractional seconds use one decimal', () => {
  assert.equal(formatDuration(1500), '1.5s')
})

test('formatDuration: 1000ms is "1s"', () => {
  assert.equal(formatDuration(1000), '1s')
})

// ---------- known constants ----------
test('KNOWN_REACTIONS contains expected entries', () => {
  assert.ok(KNOWN_REACTIONS.includes('smile'))
  assert.ok(KNOWN_REACTIONS.includes('laugh'))
  assert.ok(KNOWN_REACTIONS.includes('wave'))
})

test('REACTION_GLYPHS maps to emoji', () => {
  assert.equal(REACTION_GLYPHS.smile, '🙂')
  assert.equal(REACTION_GLYPHS.wave, '👋')
})
