'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const QUEUE_FILE = 'queue.ndjson'
const MAX_BATCH = 500
// hard cap so a permanently-offline client can't grow the queue file forever
const MAX_QUEUED_LINES = 5000

/*
 * Append-only on-disk telemetry queue.
 *
 * enqueue() appends one JSON line to queue.ndjson (survives offline / restarts).
 * flush() POSTs the oldest batch to /v1/events; on success the flushed lines
 * are dropped, on failure they stay queued and retry next time.
 *
 * The batchId is derived from the batch content (a hash), so a crash between a
 * successful POST and the local file rewrite results in an idempotent re-send —
 * the server dedupes on batchId.
 *
 * enqueue only ever appends, so "the first N lines" is stable: lines appended
 * during a flush are preserved when the flushed lines are dropped.
 */
function createEventQueue(opts = {}) {
  const {
    queueDir,
    apiUrl = 'http://localhost:8787',
    getInstallId = () => null,
    getAppVersion = () => null,
    fetchImpl = globalThis.fetch,
    intervalMs = 30000,
    timeoutMs = 8000
  } = opts

  const queueFile = path.join(queueDir, QUEUE_FILE)
  let timer = null
  let flushing = false

  function ensureDir() {
    try {
      fs.mkdirSync(queueDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  function readLines() {
    try {
      return fs
        .readFileSync(queueFile, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length)
    } catch {
      return []
    }
  }

  function enqueue(event) {
    ensureDir()
    try {
      let lines = readLines()
      if (lines.length >= MAX_QUEUED_LINES) {
        // drop the oldest lines to stay under the cap
        lines = lines.slice(lines.length - MAX_QUEUED_LINES + 1)
        fs.writeFileSync(queueFile, lines.length ? lines.join('\n') + '\n' : '')
      }
      fs.appendFileSync(queueFile, JSON.stringify(event) + '\n')
    } catch {
      // dropping a telemetry event is acceptable — never throw into the caller
    }
  }

  // Drop the first `n` lines (the batch we just flushed). Re-reads the file so
  // anything enqueued during the flush is preserved.
  function dropFlushed(n) {
    try {
      const remaining = readLines().slice(n)
      fs.writeFileSync(queueFile, remaining.length ? remaining.join('\n') + '\n' : '')
    } catch {
      /* best effort */
    }
  }

  async function flush() {
    if (flushing) return { skipped: true }
    flushing = true
    try {
      const lines = readLines()
      if (!lines.length) return { flushed: 0 }

      const batchLines = lines.slice(0, MAX_BATCH)
      const events = []
      for (const l of batchLines) {
        try {
          events.push(JSON.parse(l))
        } catch {
          /* skip a corrupt line */
        }
      }
      if (!events.length) {
        dropFlushed(batchLines.length)
        return { flushed: 0 }
      }

      const batchId = crypto
        .createHash('sha256')
        .update(batchLines.join('\n'))
        .digest('hex')
        .slice(0, 32)

      const body = {
        installId: getInstallId(),
        appVersion: getAppVersion(),
        batchId,
        events
      }

      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      let ok = false
      try {
        const res = await fetchImpl(apiUrl.replace(/\/+$/, '') + '/v1/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        })
        ok = !!(res && res.ok)
      } catch {
        ok = false
      } finally {
        clearTimeout(t)
      }

      if (ok) {
        dropFlushed(batchLines.length)
        return { flushed: events.length }
      }
      return { flushed: 0, offline: true }
    } finally {
      flushing = false
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => {
      flush().catch(() => {})
    }, intervalMs)
    if (timer.unref) timer.unref()
  }

  async function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    try {
      await flush()
    } catch {
      /* ignore */
    }
  }

  function size() {
    return readLines().length
  }

  return { enqueue, flush, start, stop, size }
}

module.exports = { createEventQueue, QUEUE_FILE, MAX_BATCH, MAX_QUEUED_LINES }
