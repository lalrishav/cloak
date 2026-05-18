/*
 * AI script formatter.
 *
 * Sends the user's script to OpenAI's Responses API with the cue grammar
 * embedded, and asks the model to insert pacing cues (timed pauses, breaks,
 * breath, chapter, note, react) without changing any words.
 *
 * Validates by parsing both input and output through the cue parser and
 * comparing whitespace-normalized plainText. Any output that altered
 * words/punctuation is rejected.
 *
 * The system prompt + OpenAI constants live in @cloak/shared/ai.js so the
 * desktop app and the cloud AI proxy never drift apart.
 */

const scriptParse = require('./script-parse')
const sharedAi = require('@cloak/shared/ai.js')

const OPENAI_URL = sharedAi.OPENAI_RESPONSES_URL
const DEFAULT_MODEL = sharedAi.OPENAI_DEFAULT_MODEL
const DEFAULT_TIMEOUT_MS = 30000

const SYSTEM_PROMPT = sharedAi.AI_SYSTEM_PROMPT

function normalizeWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function plainTextOf(text) {
  try {
    return scriptParse.parse(String(text || '')).plainText || ''
  } catch {
    return ''
  }
}

function validate(input, output) {
  return normalizeWs(plainTextOf(input)) === normalizeWs(plainTextOf(output))
}

function replaceBareAiPauses(text) {
  return String(text || '').replace(/\[\[\s*pause\s*\]\]/gi, '[[pause 1s]]')
}

function extractText(data) {
  // Responses API: prefer the convenience field `output_text`,
  // fall back to walking the structured output array.
  if (data && typeof data.output_text === 'string' && data.output_text.length) {
    return data.output_text
  }
  const out = data && Array.isArray(data.output) ? data.output : []
  for (const item of out) {
    const content = item && Array.isArray(item.content) ? item.content : []
    for (const c of content) {
      if (c && typeof c.text === 'string' && c.text.length) return c.text
    }
  }
  return ''
}

async function callOpenAi({ apiKey, model, input, signal }) {
  const requestBody = {
    model,
    input,
    text: {
      format: {
        type: 'json_schema',
        name: 'formatted_script',
        schema: {
          type: 'object',
          properties: {
            formattedText: { type: 'string' }
          },
          required: ['formattedText'],
          additionalProperties: false
        },
        strict: true
      }
    }
  }

  console.log('[ai-format] POST', OPENAI_URL, 'model:', model)
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  })
  console.log('[ai-format] HTTP', res.status, res.statusText)

  if (!res.ok) {
    let detail = ''
    let bodyText = ''
    try { bodyText = await res.text() } catch { /* ignore */ }
    try {
      const body = JSON.parse(bodyText)
      detail = body && body.error && body.error.message ? body.error.message : ''
    } catch { /* not JSON */ }
    console.log('[ai-format] error body:', bodyText.slice(0, 800))
    const code = res.status
    const tail = detail || bodyText.slice(0, 200)
    if (code === 401) throw new Error('OpenAI auth failed (check OPENAI_API_KEY). ' + tail)
    if (code === 429) throw new Error('OpenAI rate-limited or out of quota. ' + tail)
    if (code >= 500) throw new Error(`OpenAI server error ${code}${tail ? `: ${tail}` : ''}.`)
    throw new Error(`OpenAI error ${code}${tail ? `: ${tail}` : ''}.`)
  }

  return res.json()
}

function summarizeShape(data) {
  if (data == null) return 'null/undefined'
  if (typeof data !== 'object') return typeof data
  const keys = Object.keys(data).slice(0, 8).join(',')
  let outShape = ''
  if (Array.isArray(data.output)) {
    outShape = `output[${data.output.length}]`
    if (data.output[0]) {
      const it = data.output[0]
      const ck = it.content && Array.isArray(it.content) ? it.content.length : '?'
      outShape += ` first.type=${it.type || '?'} content[${ck}]`
      if (it.content && it.content[0]) {
        outShape += ` content[0].type=${it.content[0].type || '?'} hasText=${typeof it.content[0].text === 'string'}`
      }
    }
  }
  return `keys=${keys} ${outShape}`
}

async function format(rawText, opts = {}) {
  const text = String(rawText == null ? '' : rawText)
  if (!text.trim()) {
    return { ok: false, error: 'Script is empty.' }
  }
  const apiKey = opts.apiKey
  if (!apiKey) {
    return { ok: false, error: 'No OpenAI API key configured.' }
  }
  const model = opts.model || DEFAULT_MODEL
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const data = await callOpenAi({
      apiKey,
      model,
      signal: controller.signal,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })

    console.log('[ai-format] response shape:', summarizeShape(data))
    const raw = extractText(data)
    console.log('[ai-format] extracted text length:', raw.length)
    if (!raw) {
      console.log('[ai-format] full response:', JSON.stringify(data).slice(0, 1500))
      return {
        ok: false,
        error: 'OpenAI returned no text.',
        diag: { shape: summarizeShape(data), sample: JSON.stringify(data).slice(0, 400) }
      }
    }

    let parsedJson
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      console.log('[ai-format] non-JSON text:', raw.slice(0, 500))
      return {
        ok: false,
        error: 'OpenAI returned non-JSON output.',
        diag: { sample: raw.slice(0, 200) }
      }
    }
    const formatted =
      parsedJson && typeof parsedJson.formattedText === 'string'
        ? replaceBareAiPauses(parsedJson.formattedText)
        : ''
    if (!formatted) {
      console.log('[ai-format] parsed JSON without formattedText:', JSON.stringify(parsedJson).slice(0, 500))
      return {
        ok: false,
        error: 'OpenAI returned empty formattedText.',
        diag: { keys: Object.keys(parsedJson || {}).join(',') }
      }
    }

    const inputPlain = normalizeWs(plainTextOf(text))
    const outputPlain = normalizeWs(plainTextOf(formatted))
    if (inputPlain !== outputPlain) {
      console.log('[ai-format] validator rejected output')
      console.log('[ai-format]  input plain (len ' + inputPlain.length + '):', inputPlain.slice(0, 200))
      console.log('[ai-format]  output plain (len ' + outputPlain.length + '):', outputPlain.slice(0, 200))
      return {
        ok: false,
        error: 'AI changed words — formatting not applied. See terminal logs for the diff.',
        diag: {
          inLen: inputPlain.length,
          outLen: outputPlain.length,
          inHead: inputPlain.slice(0, 120),
          outHead: outputPlain.slice(0, 120)
        }
      }
    }

    const cueCount = (formatted.match(/\[\[/g) || []).length
    console.log('[ai-format] success — formatted length:', formatted.length, 'cues inserted:', cueCount)
    console.log('[ai-format] output preview:\n' + formatted.slice(0, 600) + (formatted.length > 600 ? '\n…' : ''))
    return { ok: true, text: formatted, model, cueCount }
  } catch (err) {
    console.log('[ai-format] threw:', err && err.message)
    if (err && err.name === 'AbortError') {
      return { ok: false, error: `OpenAI request timed out after ${Math.round(timeoutMs / 1000)}s.` }
    }
    return { ok: false, error: (err && err.message) || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  format,
  validate,
  normalizeWs,
  extractText,
  SYSTEM_PROMPT,
  DEFAULT_MODEL
}
