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
 */

const scriptParse = require('./script-parse')

const OPENAI_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TIMEOUT_MS = 30000

const SYSTEM_PROMPT = `You are a teleprompter director. The user will give you a script. Your job is to make it READABLE and PERFORMABLE on a scrolling teleprompter by inserting line breaks AND cue tokens that pace the delivery.

ABSOLUTE WORD RULE — non-negotiable:
- Do not change, add, remove, rewrite, correct, translate, paraphrase, or reorder any words.
- Do not change grammar, spelling, punctuation, capitalization, or meaning of any word.
- You may ONLY insert: line breaks, blank lines, and the cue tokens listed below. Nothing else.

ACTIVELY ADD CUES — this is the whole point of calling you:
- A bare formatted script with only line breaks is a FAILURE. The user pressed "Format with AI" because they want pacing cues inserted.
- Aim for roughly 1 cue token (breath/chapter/note/react/timed pause) per 3-5 sentences on average. More for emotional or slow content, less for fast factual content. Never zero.
- Do NOT play it safe and only add line breaks. The user explicitly wants the cues.

CUE GRAMMAR (use [[ body ]] form, exactly):
- [[pause Ns]]            pause N seconds, then auto-resume (e.g. [[pause 2s]])
- [[pause 500ms]]         same, in milliseconds
- [[breath]]              brief inhale beat — use freely between clauses
- [[chapter: Title]]      named topic boundary, use at major sections
- [[note: text]]          director-only note (e.g. "smile", "look up", "louder")
- [[react NAME]]          flash a reaction glyph; NAME ∈ { smile, laugh, nod, wave, point, thumbsup, wink, shrug, clap, cry }

Do NOT use bare [[pause]] — it is a manual hard pause reserved for the user toolbar only.
Do NOT use [[stop]] — it halts playback mid-script and requires manual reset.
Do NOT use timed pauses as punctuation after every short line. A script with [[pause 1s]] after most lines is a failure.

WHEN TO USE EACH CUE:
- [[breath]] — between long sentences, mid-clause where a natural inhale would fall, after a name or list. Use generously (these are tiny micro-pauses).
- [[pause 500ms]] — a tiny beat inside a list or before a contrast; use sparingly.
- [[pause 1s]] – [[pause 2s]] — only between thoughts, after rhetorical questions, before key beats, before punchlines.
- [[pause 3s]]+ — at major emotional pauses, before reveals, after a heavy line lands.
- Blank line — between paragraphs / topic shifts.
- [[chapter: Title]] — at the start of a major section (intro, point 1, point 2, conclusion). Pick a short title from context. Use 2-6 times in a typical script, not every paragraph.
- [[note: ...]] — director cues only the operator sees: "smile here", "eye contact", "slow down", "louder". 1-3 per script is good.
- [[react NAME]] — sparingly, at warm/conversational beats. 0-3 per script.

TIMED PAUSE DENSITY:
- Prefer blank lines and line breaks over timed pauses for normal pacing.
- Do not put timed pauses after consecutive lines unless the script is intentionally dramatic.
- In explanatory/educational scripts, use timed pauses mainly at section transitions, rhetorical questions, reveals, and long lists.
- For list items, use at most one or two timed pauses across the whole list, not one after every item.

LINE BREAKING:
- Aim for short readable lines (~55-70 chars) but never break a phrase mid-clause.
- Break before a conjunction (and, but, or, so) when the sentence is long.
- Blank line between paragraphs or topic shifts.

EXAMPLE (input → output):
Input: "Hi everyone and welcome to the show. Today we are talking about focus. Why is it so hard to stay focused these days? Let me tell you a story."
Output:
[[chapter: Open]]
Hi everyone [[breath]] and welcome to the show. [[pause 1s]]

Today we are talking about focus.
[[note: warm smile here]]

Why is it so hard to stay focused these days? [[pause 2s]]

Let me tell you a story.

OUTPUT FORMAT:
Return ONLY the reformatted script in the formattedText field. No commentary, no prefixes, no markdown fences. The reformatted text MUST contain at least one cue token unless the input is shorter than two sentences.`

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
