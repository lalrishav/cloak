#!/usr/bin/env node
/*
 * Standalone smoke test for the OpenAI Responses API call.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node _test-openai.js
 *
 * Costs: 1 short request (~few hundred tokens). Prints everything.
 */

const ai = require('./lib/ai-format')

const key = process.env.OPENAI_API_KEY
if (!key) {
  console.error('OPENAI_API_KEY not set in env. Aborting.')
  process.exit(1)
}

const SAMPLE = `Hello and welcome to the show. Today we are going to talk about something a little different. I have been thinking a lot lately about how we spend our time, and whether the things we say matter to us actually do. So let me ask you. When was the last time you sat with a thought for more than thirty seconds without reaching for your phone? It is harder than it sounds.`

console.log('--- input length:', SAMPLE.length, 'chars ---')
console.log(SAMPLE)
console.log('---\n')

ai.format(SAMPLE, { apiKey: key }).then((res) => {
  console.log('\n=== RESULT ===')
  console.log('ok:', res.ok)
  if (res.ok) {
    console.log('model:', res.model)
    console.log('output length:', res.text.length, 'chars')
    console.log('---\n' + res.text + '\n---')
  } else {
    console.log('error:', res.error)
    if (res.diag) console.log('diag:', JSON.stringify(res.diag, null, 2))
  }
}).catch((err) => {
  console.error('THREW:', err && err.message)
  console.error(err)
})
