/*
 * Minimal Node-native test runner for the cue parser. Run with:
 *   node lib/script-parse.test.js
 */
const assert = require('assert')
const { parse, parseTokenBody, parseDuration, tokenFor, describeMarker } =
  require('./script-parse')

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    process.stdout.write('.')
  } catch (err) {
    failed++
    failures.push({ name, err })
    process.stdout.write('F')
  }
}

// ---------- parseDuration ----------
test('parseDuration: seconds default', () => {
  assert.strictEqual(parseDuration('3'), 3000)
  assert.strictEqual(parseDuration('3s'), 3000)
})
test('parseDuration: milliseconds', () => {
  assert.strictEqual(parseDuration('500ms'), 500)
})
test('parseDuration: fractional seconds', () => {
  assert.strictEqual(parseDuration('1.5s'), 1500)
})
test('parseDuration: invalid returns null', () => {
  assert.strictEqual(parseDuration('abc'), null)
  assert.strictEqual(parseDuration(''), null)
  assert.strictEqual(parseDuration(null), null)
})

// ---------- parseTokenBody ----------
test('parseTokenBody: bare pause', () => {
  const r = parseTokenBody('pause')
  assert.strictEqual(r.cueType, 'pause')
  assert.deepStrictEqual(r.payload, {})
  assert.ok(!r.error)
})
test('parseTokenBody: timed pause seconds', () => {
  const r = parseTokenBody('pause 3s')
  assert.strictEqual(r.cueType, 'pause')
  assert.strictEqual(r.payload.durationMs, 3000)
})
test('parseTokenBody: timed pause ms', () => {
  const r = parseTokenBody('pause 750ms')
  assert.strictEqual(r.payload.durationMs, 750)
})
test('parseTokenBody: pause with bad duration sets error', () => {
  const r = parseTokenBody('pause forever')
  assert.strictEqual(r.cueType, 'pause')
  assert.ok(r.error, 'expected error to be set')
})
test('parseTokenBody: stop', () => {
  const r = parseTokenBody('stop')
  assert.strictEqual(r.cueType, 'stop')
})
test('parseTokenBody: react smile', () => {
  const r = parseTokenBody('react smile')
  assert.strictEqual(r.cueType, 'react')
  assert.strictEqual(r.payload.reaction, 'smile')
  assert.ok(!r.error)
})
test('parseTokenBody: react with duration', () => {
  const r = parseTokenBody('react laugh 2s')
  assert.strictEqual(r.payload.reaction, 'laugh')
  assert.strictEqual(r.payload.durationMs, 2000)
})
test('parseTokenBody: react unknown sets error but keeps reaction', () => {
  const r = parseTokenBody('react zorp')
  assert.strictEqual(r.payload.reaction, 'zorp')
  assert.ok(r.error)
})
test('parseTokenBody: chapter with colon', () => {
  const r = parseTokenBody('chapter: Intro')
  assert.strictEqual(r.cueType, 'chapter')
  assert.strictEqual(r.payload.title, 'Intro')
})
test('parseTokenBody: chapter without colon', () => {
  const r = parseTokenBody('chapter Outro')
  assert.strictEqual(r.cueType, 'chapter')
  assert.strictEqual(r.payload.title, 'Outro')
})
test('parseTokenBody: chapter with empty title', () => {
  const r = parseTokenBody('chapter:')
  assert.strictEqual(r.payload.title, 'Untitled')
})
test('parseTokenBody: note', () => {
  const r = parseTokenBody('note: only camera 2')
  assert.strictEqual(r.cueType, 'note')
  assert.strictEqual(r.payload.text, 'only camera 2')
})
test('parseTokenBody: unknown cue', () => {
  const r = parseTokenBody('zap')
  assert.strictEqual(r.cueType, 'unknown')
  assert.ok(r.error)
})

// ---------- parse ----------
test('parse: empty string', () => {
  const r = parse('')
  assert.deepStrictEqual(r.segments, [])
  assert.deepStrictEqual(r.markers, [])
  assert.strictEqual(r.plainText, '')
})
test('parse: plain text only', () => {
  const r = parse('Hello world.')
  assert.strictEqual(r.segments.length, 1)
  assert.strictEqual(r.segments[0].type, 'text')
  assert.strictEqual(r.segments[0].text, 'Hello world.')
  assert.strictEqual(r.markers.length, 0)
  assert.strictEqual(r.plainText, 'Hello world.')
})
test('parse: single pause splits text', () => {
  const r = parse('Welcome [[pause]] everyone.')
  assert.strictEqual(r.segments.length, 3)
  assert.strictEqual(r.segments[0].text, 'Welcome ')
  assert.strictEqual(r.segments[1].type, 'cue')
  assert.strictEqual(r.segments[1].cueType, 'pause')
  assert.strictEqual(r.segments[2].text, ' everyone.')
  assert.strictEqual(r.plainText, 'Welcome  everyone.')
})
test('parse: marker charOffset points into plainText', () => {
  const r = parse('Welcome[[pause]] everyone.')
  const m = r.markers[0]
  // 'Welcome' = 7 chars; cue strips to nothing; ' everyone' follows
  assert.strictEqual(m.charOffset, 7)
  assert.strictEqual(r.plainText.slice(m.charOffset), ' everyone.')
})
test('parse: multiple cues yield ordered markers', () => {
  const r = parse('A [[pause]] B [[stop]] C')
  assert.strictEqual(r.markers.length, 2)
  assert.strictEqual(r.markers[0].type, 'pause')
  assert.strictEqual(r.markers[1].type, 'stop')
  assert.ok(r.markers[1].charOffset > r.markers[0].charOffset)
})
test('parse: chapter populates chapters[]', () => {
  const r = parse('Intro [[chapter: Part 1]] body [[chapter: Part 2]] tail')
  assert.strictEqual(r.chapters.length, 2)
  assert.strictEqual(r.chapters[0].title, 'Part 1')
  assert.strictEqual(r.chapters[1].title, 'Part 2')
})
test('parse: unique ids per cue', () => {
  const r = parse('[[pause]] [[pause]] [[pause]]')
  const ids = r.markers.map((m) => m.id)
  assert.strictEqual(new Set(ids).size, ids.length)
})
test('parse: malformed cue is captured as error', () => {
  const r = parse('Hello [[wat]] world')
  assert.strictEqual(r.errors.length, 1)
  assert.strictEqual(r.markers[0].type, 'unknown')
})
test('parse: react with custom duration parses', () => {
  const r = parse('[[react wave 1500ms]]')
  assert.strictEqual(r.markers[0].payload.reaction, 'wave')
  assert.strictEqual(r.markers[0].payload.durationMs, 1500)
})
test('parse: notes preserved as markers but contribute no plain text', () => {
  const r = parse('A [[note: aside]] B')
  assert.strictEqual(r.markers.length, 1)
  assert.strictEqual(r.markers[0].type, 'note')
  assert.strictEqual(r.plainText, 'A  B')
})
test('parse: cues at start and end', () => {
  const r = parse('[[chapter: Top]]Hello[[stop]]')
  assert.strictEqual(r.segments[0].type, 'cue')
  assert.strictEqual(r.segments[0].cueType, 'chapter')
  assert.strictEqual(r.segments[r.segments.length - 1].type, 'cue')
  assert.strictEqual(r.segments[r.segments.length - 1].cueType, 'stop')
})

// ---------- colon syntax flexibility (regression) ----------
test('parseTokenBody: [[react: wave]] colon-syntax parses as react', () => {
  const r = parseTokenBody('react: wave')
  assert.strictEqual(r.cueType, 'react')
  assert.strictEqual(r.payload.reaction, 'wave')
  assert.ok(!r.error)
})
test('parseTokenBody: [[pause: 3s]] colon-syntax parses as pause', () => {
  const r = parseTokenBody('pause: 3s')
  assert.strictEqual(r.cueType, 'pause')
  assert.strictEqual(r.payload.durationMs, 3000)
})
test('parseTokenBody: [[stop:]] colon-syntax parses as stop', () => {
  const r = parseTokenBody('stop:')
  assert.strictEqual(r.cueType, 'stop')
})
test('parseTokenBody: [[react: smile 2s]] colon + duration', () => {
  const r = parseTokenBody('react: smile 2s')
  assert.strictEqual(r.payload.reaction, 'smile')
  assert.strictEqual(r.payload.durationMs, 2000)
})

// ---------- mid-script stop warnings ----------
test('parse: mid-script [[stop]] emits a warning', () => {
  const r = parse('A [[stop]] B [[pause]] C')
  assert.strictEqual(r.warnings.length, 1)
  assert.strictEqual(r.warnings[0].severity, 'warn')
  assert.ok(/mid-script/.test(r.warnings[0].message))
})
test('parse: final [[stop]] does NOT warn', () => {
  const r = parse('A [[pause]] B [[stop]]')
  assert.strictEqual(r.warnings.length, 0)
})
test('parse: multiple [[stop]]s — only non-final ones warn', () => {
  const r = parse('A [[stop]] B [[stop]] C [[stop]]')
  assert.strictEqual(r.warnings.length, 2)
})

// ---------- tokenFor / describeMarker ----------
test('tokenFor: pause', () => {
  assert.strictEqual(tokenFor('pause'), '[[pause]]')
})
test('tokenFor: pause-timed default', () => {
  assert.strictEqual(tokenFor('pause-timed'), '[[pause 3s]]')
})
test('tokenFor: react with opts', () => {
  assert.strictEqual(tokenFor('react', { reaction: 'wave' }), '[[react wave]]')
})
test('tokenFor: chapter with title', () => {
  assert.strictEqual(
    tokenFor('chapter', { title: 'Q&A' }),
    '[[chapter: Q&A]]'
  )
})
test('describeMarker: pause timed', () => {
  const r = parse('[[pause 2s]]')
  assert.strictEqual(describeMarker(r.markers[0]), 'pause 2s')
})
test('describeMarker: react', () => {
  const r = parse('[[react smile]]')
  assert.strictEqual(describeMarker(r.markers[0]), 'react smile')
})

// ---------- summary ----------
process.stdout.write('\n')
console.log(`\n${passed} passed, ${failed} failed`)
if (failures.length) {
  for (const f of failures) {
    console.log(`\n  ✗ ${f.name}`)
    console.log(
      '    ' +
        String(f.err && f.err.stack ? f.err.stack : f.err)
          .split('\n')
          .join('\n    ')
    )
  }
  process.exit(1)
}
