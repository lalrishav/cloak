'use strict'
/*
 * OpenAI proxy formatter for the API.
 *
 * Mirrors the desktop's lib/ai-format.js OpenAI call — same shared system
 * prompt + Responses-API request shape — but deliberately does NOT run the
 * cue-parser word-safety validation: that stays on the desktop, which owns the
 * cue parser. The proxy's only job is to keep the OpenAI key server-side so the
 * shipped binary carries zero keys.
 */
const sharedAi = require('@cloak/shared/ai.js')

const DEFAULT_TIMEOUT_MS = 30000

function extractText(data) {
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

function replaceBareAiPauses(text) {
  return String(text || '').replace(/\[\[\s*pause\s*\]\]/gi, '[[pause 1s]]')
}

async function formatRaw(rawText, opts = {}) {
  const text = String(rawText == null ? '' : rawText)
  if (!text.trim()) return { ok: false, error: 'Script is empty.' }
  const apiKey = opts.apiKey
  if (!apiKey) return { ok: false, error: 'AI proxy has no OpenAI key configured.' }
  const model = opts.model || sharedAi.OPENAI_DEFAULT_MODEL
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(sharedAi.OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: sharedAi.AI_SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'formatted_script',
            schema: {
              type: 'object',
              properties: { formattedText: { type: 'string' } },
              required: ['formattedText'],
              additionalProperties: false
            },
            strict: true
          }
        }
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        detail = body && body.error && body.error.message ? body.error.message : ''
      } catch {
        /* ignore */
      }
      if (res.status === 401) return { ok: false, error: 'OpenAI auth failed (check the server key).' }
      if (res.status === 429) return { ok: false, error: 'OpenAI rate-limited or out of quota.' }
      return { ok: false, error: `OpenAI error ${res.status}${detail ? ': ' + detail : ''}.` }
    }

    const data = await res.json()
    const raw = extractText(data)
    if (!raw) return { ok: false, error: 'OpenAI returned no text.' }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'OpenAI returned non-JSON output.' }
    }
    const formatted =
      parsed && typeof parsed.formattedText === 'string'
        ? replaceBareAiPauses(parsed.formattedText)
        : ''
    if (!formatted) return { ok: false, error: 'OpenAI returned empty formattedText.' }

    return { ok: true, text: formatted, model }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return {
        ok: false,
        error: `OpenAI request timed out after ${Math.round(timeoutMs / 1000)}s.`
      }
    }
    return { ok: false, error: (err && err.message) || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { formatRaw, extractText, replaceBareAiPauses }
