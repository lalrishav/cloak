/*
 * Unit tests for lib/ai-format.js.
 *
 * We stub global.fetch around each test so no real network call is made.
 *
 * Run with:    node --test test/ai-format.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const ai = require('../lib/ai-format')
const {
  format,
  validate,
  normalizeWs,
  extractText,
  SYSTEM_PROMPT,
  DEFAULT_MODEL
} = ai

// Build a fake fetch that returns a canned Response-like object.
function fakeFetch({ ok = true, status = 200, statusText = 'OK', body = {}, throws = null }) {
  return async () => {
    if (throws) throw throws
    const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      ok,
      status,
      statusText,
      json: async () => JSON.parse(bodyText),
      text: async () => bodyText
    }
  }
}

function withFetch(fn) {
  return async (...args) => {
    const original = global.fetch
    global.fetch = fn
    try {
      // execute the test body
      // we expose `original` via closure when needed for restore
    } finally {
      // restored by individual test below
      global.fetch = original
    }
  }
}

// Run a single test body with a temporary fetch stub.
async function runWithFetch(fetchImpl, body) {
  const original = global.fetch
  global.fetch = fetchImpl
  try {
    await body()
  } finally {
    global.fetch = original
  }
}

// ---------- module surface ----------
test('module exports the public surface', () => {
  assert.equal(typeof format, 'function')
  assert.equal(typeof validate, 'function')
  assert.equal(typeof normalizeWs, 'function')
  assert.equal(typeof extractText, 'function')
  assert.equal(typeof SYSTEM_PROMPT, 'string')
  assert.ok(SYSTEM_PROMPT.length > 0)
  assert.equal(DEFAULT_MODEL, 'gpt-4o-mini')
})

// ---------- normalizeWs ----------
test('normalizeWs: collapses runs of whitespace', () => {
  assert.equal(normalizeWs('a   b\nc\t  d'), 'a b c d')
})

test('normalizeWs: trims both ends', () => {
  assert.equal(normalizeWs('   hi   '), 'hi')
})

test('normalizeWs: handles empty / nullish', () => {
  assert.equal(normalizeWs(''), '')
  assert.equal(normalizeWs(null), '')
  assert.equal(normalizeWs(undefined), '')
})

test('normalizeWs: coerces non-strings', () => {
  assert.equal(normalizeWs(42), '42')
})

// ---------- validate ----------
test('validate: identical plaintexts pass', () => {
  assert.equal(validate('Hello world.', 'Hello world.'), true)
})

test('validate: cues do not count towards plaintext', () => {
  assert.equal(validate('Hello world.', 'Hello [[breath]] world.'), true)
})

test('validate: word changes fail', () => {
  assert.equal(validate('Hello world.', 'Hello earth.'), false)
})

test('validate: whitespace differences ignored', () => {
  assert.equal(validate('Hello   world.', 'Hello world.'), true)
})

test('validate: punctuation difference fails', () => {
  assert.equal(validate('Hello world.', 'Hello world'), false)
})

// ---------- extractText ----------
test('extractText: prefers output_text convenience field', () => {
  assert.equal(extractText({ output_text: 'hi' }), 'hi')
})

test('extractText: walks output[] array', () => {
  const data = {
    output: [
      { content: [{ type: 'output_text', text: 'walked' }] }
    ]
  }
  assert.equal(extractText(data), 'walked')
})

test('extractText: empty output_text falls through to array', () => {
  const data = {
    output_text: '',
    output: [{ content: [{ text: 'fallback' }] }]
  }
  assert.equal(extractText(data), 'fallback')
})

test('extractText: returns empty string when nothing found', () => {
  assert.equal(extractText({}), '')
  assert.equal(extractText({ output: [] }), '')
  assert.equal(extractText(null), '')
})

test('extractText: skips items without content arrays', () => {
  const data = { output: [{ foo: 'bar' }, { content: [{ text: 'good' }] }] }
  assert.equal(extractText(data), 'good')
})

test('extractText: skips content items without text', () => {
  const data = { output: [{ content: [{ type: 'reasoning' }, { text: 'final' }] }] }
  assert.equal(extractText(data), 'final')
})

// ---------- format: input validation ----------
test('format: empty text returns error', async () => {
  const r = await format('', { apiKey: 'sk-x' })
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/i)
})

test('format: whitespace-only text returns error', async () => {
  const r = await format('   \n\t  ', { apiKey: 'sk-x' })
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/i)
})

test('format: nullish text returns error', async () => {
  const r = await format(null, { apiKey: 'sk-x' })
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/i)
})

test('format: missing apiKey returns error', async () => {
  const r = await format('Hello.', {})
  assert.equal(r.ok, false)
  assert.match(r.error, /API key/i)
})

test('format: missing opts entirely returns error', async () => {
  const r = await format('Hello.')
  assert.equal(r.ok, false)
  assert.match(r.error, /API key/i)
})

// ---------- format: success path ----------
test('format: success via output_text', async () => {
  const formattedScript = 'Hello [[breath]] world.'
  await runWithFetch(
    fakeFetch({
      body: {
        output_text: JSON.stringify({ formattedText: formattedScript })
      }
    }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, true)
      assert.equal(r.text, formattedScript)
      assert.equal(r.model, DEFAULT_MODEL)
      assert.ok(r.cueCount >= 1)
    }
  )
})

test('format: success via output[] structured array', async () => {
  const formattedScript = 'Hello [[breath]] world.'
  await runWithFetch(
    fakeFetch({
      body: {
        output: [
          {
            content: [
              { type: 'output_text', text: JSON.stringify({ formattedText: formattedScript }) }
            ]
          }
        ]
      }
    }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x', model: 'gpt-4o' })
      assert.equal(r.ok, true)
      assert.equal(r.model, 'gpt-4o')
    }
  )
})

test('format: bare [[pause]] in output gets replaced with [[pause 1s]]', async () => {
  await runWithFetch(
    fakeFetch({
      body: {
        output_text: JSON.stringify({ formattedText: 'Hello [[pause]] world.' })
      }
    }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, true)
      assert.match(r.text, /\[\[pause 1s\]\]/)
      assert.doesNotMatch(r.text, /\[\[pause\]\]/)
    }
  )
})

// ---------- format: empty / malformed output ----------
test('format: empty extracted text returns error', async () => {
  await runWithFetch(
    fakeFetch({ body: { output_text: '' } }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /no text/i)
      assert.ok(r.diag)
    }
  )
})

test('format: non-JSON output returns error', async () => {
  await runWithFetch(
    fakeFetch({ body: { output_text: 'not json {' } }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /non-JSON/i)
    }
  )
})

test('format: JSON without formattedText returns error', async () => {
  await runWithFetch(
    fakeFetch({ body: { output_text: JSON.stringify({ wrong: 'shape' }) } }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /empty formattedText/i)
    }
  )
})

test('format: JSON with empty formattedText returns error', async () => {
  await runWithFetch(
    fakeFetch({ body: { output_text: JSON.stringify({ formattedText: '' }) } }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /empty formattedText/i)
    }
  )
})

test('format: word-changing output is rejected by validator', async () => {
  await runWithFetch(
    fakeFetch({
      body: {
        output_text: JSON.stringify({ formattedText: 'Goodbye world.' })
      }
    }),
    async () => {
      const r = await format('Hello world.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /changed words/i)
      assert.ok(r.diag)
      assert.equal(typeof r.diag.inHead, 'string')
    }
  )
})

// ---------- format: HTTP error mapping ----------
test('format: 401 → auth-failed error', async () => {
  await runWithFetch(
    fakeFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: { error: { message: 'Invalid key' } }
    }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /auth failed/i)
    }
  )
})

test('format: 429 → rate-limit error', async () => {
  await runWithFetch(
    fakeFetch({
      ok: false,
      status: 429,
      body: { error: { message: 'Slow down' } }
    }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /rate-limited|quota/i)
    }
  )
})

test('format: 500 → server error', async () => {
  await runWithFetch(
    fakeFetch({
      ok: false,
      status: 500,
      body: { error: { message: 'Internal error' } }
    }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /server error 500/i)
    }
  )
})

test('format: 400 → generic error', async () => {
  await runWithFetch(
    fakeFetch({
      ok: false,
      status: 400,
      body: { error: { message: 'Bad request' } }
    }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /OpenAI error 400/i)
    }
  )
})

test('format: non-JSON error body still reports the status', async () => {
  await runWithFetch(
    fakeFetch({
      ok: false,
      status: 502,
      body: '<html>bad gateway</html>'
    }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /502/)
    }
  )
})

// ---------- format: thrown errors ----------
test('format: fetch throws AbortError → timeout message', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  await runWithFetch(async () => { throw abort }, async () => {
    const r = await format('Hello.', { apiKey: 'sk-x', timeoutMs: 1000 })
    assert.equal(r.ok, false)
    assert.match(r.error, /timed out/i)
  })
})

test('format: fetch throws generic Error → error.message surfaced', async () => {
  await runWithFetch(async () => { throw new Error('network down') }, async () => {
    const r = await format('Hello.', { apiKey: 'sk-x' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'network down')
  })
})

test('format: fetch throws non-Error (string) → coerced to string', async () => {
  await runWithFetch(async () => { throw 'boom' }, async () => {
    const r = await format('Hello.', { apiKey: 'sk-x' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'boom')
  })
})

test('format: real timeout via short timeoutMs', async () => {
  // fetch that respects AbortSignal — sleep until aborted
  await runWithFetch(
    async (_url, init) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' }), 5000)
        if (init && init.signal) {
          init.signal.addEventListener('abort', () => {
            clearTimeout(t)
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    },
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x', timeoutMs: 50 })
      assert.equal(r.ok, false)
      assert.match(r.error, /timed out/i)
    }
  )
})

// ---------- format: empty response shapes (exercises summarizeShape) ----------

test('format: empty output[] array returns "no text" error', async () => {
  await runWithFetch(
    fakeFetch({ body: { output: [] } }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /no text/i)
      assert.ok(r.diag.shape.includes('output[0]'))
    }
  )
})

test('format: output[] with item but no content array', async () => {
  await runWithFetch(
    fakeFetch({ body: { output: [{ type: 'message' }] } }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /no text/i)
    }
  )
})

test('format: output[] with empty content array', async () => {
  await runWithFetch(
    fakeFetch({ body: { output: [{ type: 'message', content: [] }] } }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
      assert.match(r.error, /no text/i)
    }
  )
})

test('format: response body is a string (non-object) triggers extract failure', async () => {
  await runWithFetch(
    fakeFetch({ body: 'just a string' }),
    async () => {
      const r = await format('Hello.', { apiKey: 'sk-x' })
      assert.equal(r.ok, false)
    }
  )
})

// ---------- format: request shape ----------
test('format: sends correct Authorization header and JSON body', async () => {
  let captured = null
  await runWithFetch(
    async (url, init) => {
      captured = { url, init }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ output_text: JSON.stringify({ formattedText: 'Hello [[breath]] world.' }) }),
        text: async () => ''
      }
    },
    async () => {
      await format('Hello world.', { apiKey: 'sk-test-key', model: 'gpt-4o' })
    }
  )
  assert.ok(captured)
  assert.equal(captured.url, 'https://api.openai.com/v1/responses')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-test-key')
  const body = JSON.parse(captured.init.body)
  assert.equal(body.model, 'gpt-4o')
  assert.equal(body.text.format.type, 'json_schema')
})
