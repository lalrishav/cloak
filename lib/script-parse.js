/*
 * Cue script parser.
 *
 * Token grammar: `[[ <body> ]]`
 *   [[pause]]              auto-pause until manual resume
 *   [[pause 3s]]           auto-pause N seconds, then resume
 *   [[pause 500ms]]        same, in milliseconds
 *   [[stop]]               hard stop
 *   [[react smile]]        flash a corner glyph (default 3s)
 *   [[react smile 2s]]     glyph with duration override
 *   [[chapter: Intro]]     named jump target
 *   [[chapter Intro]]      same, colon optional
 *   [[note: cam 2 only]]   director-only — hidden on overlay
 *
 * Output shape:
 *   {
 *     segments: Array<TextSeg | CueSeg>      // ordered for rendering
 *     markers:  Array<Marker>                // ordered by charOffset
 *     chapters: Array<Chapter>               // subset of markers, for jump nav
 *     plainText: string                      // script with cues stripped
 *     errors:   Array<{ index, message, raw }>
 *   }
 *
 *   TextSeg = { type: 'text', text: string }
 *   CueSeg  = { type: 'cue',  id, cueType, payload }
 *   Marker  = { id, type, charOffset, payload }
 *   Chapter = { id, title, charOffset }
 *
 * IDs are positional (`m_0`, `m_1`, …) — stable within a single parse, but
 * shift across re-parses. Consumers that need cross-parse stability should
 * key on `charOffset` instead.
 */
;(function (root, factory) {
  const mod = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod
  }
  if (typeof window !== 'undefined') {
    window.scriptParse = mod
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KNOWN_REACTIONS = [
    'smile',
    'laugh',
    'nod',
    'wave',
    'point',
    'thumbsup',
    'wink',
    'shrug',
    'clap',
    'cry'
  ]

  const REACTION_GLYPHS = {
    smile: '🙂',
    laugh: '😄',
    nod: '👍',
    wave: '👋',
    point: '👉',
    thumbsup: '👍',
    wink: '😉',
    shrug: '🤷',
    clap: '👏',
    cry: '😢'
  }

  const TOKEN_RE = /\[\[\s*([^\[\]]+?)\s*\]\]/g

  function parseDuration(str) {
    if (str == null) return null
    const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(String(str).trim())
    if (!m) return null
    const num = parseFloat(m[1])
    if (!isFinite(num) || num < 0) return null
    const unit = (m[2] || 's').toLowerCase()
    return unit === 'ms' ? Math.round(num) : Math.round(num * 1000)
  }

  function parseTokenBody(body) {
    const trimmed = String(body || '').trim()
    if (!trimmed) {
      return { cueType: 'unknown', payload: {}, error: 'empty cue' }
    }

    // colon syntax. chapter / note take free-form text after the colon.
    // For other known cues, the colon is treated as an optional separator
    // so [[react: wave]] and [[pause: 3s]] also work.
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const head = trimmed.slice(0, colonIdx).trim().toLowerCase()
      const rest = trimmed.slice(colonIdx + 1).trim()
      if (head === 'chapter') {
        return { cueType: 'chapter', payload: { title: rest || 'Untitled' } }
      }
      if (head === 'note') {
        return { cueType: 'note', payload: { text: rest } }
      }
      if (['pause', 'stop', 'react', 'breath'].indexOf(head) !== -1) {
        return parseTokenBody(rest ? head + ' ' + rest : head)
      }
    }

    const parts = trimmed.split(/\s+/)
    const head = parts[0].toLowerCase()
    const rest = parts.slice(1)

    switch (head) {
      case 'pause': {
        if (rest.length === 0) {
          return { cueType: 'pause', payload: {} }
        }
        const d = parseDuration(rest[0])
        if (d === null) {
          return {
            cueType: 'pause',
            payload: {},
            error: `bad duration: "${rest[0]}"`
          }
        }
        return { cueType: 'pause', payload: { durationMs: d } }
      }
      case 'stop':
        return { cueType: 'stop', payload: {} }
      case 'react': {
        const reaction = (rest[0] || '').toLowerCase()
        if (!reaction) {
          return {
            cueType: 'react',
            payload: {},
            error: 'missing reaction'
          }
        }
        const payload = { reaction }
        let error = null
        if (!KNOWN_REACTIONS.includes(reaction)) {
          error = `unknown reaction: "${reaction}"`
        }
        if (rest[1]) {
          const d = parseDuration(rest[1])
          if (d === null) {
            error = error || `bad duration: "${rest[1]}"`
          } else {
            payload.durationMs = d
          }
        }
        payload.glyph = REACTION_GLYPHS[reaction] || '⚡'
        const out = { cueType: 'react', payload }
        if (error) out.error = error
        return out
      }
      case 'chapter': {
        const title = rest.join(' ').trim() || 'Untitled'
        return { cueType: 'chapter', payload: { title } }
      }
      case 'note': {
        const text = rest.join(' ').trim()
        return { cueType: 'note', payload: { text } }
      }
      case 'breath':
        return { cueType: 'breath', payload: {} }
      default:
        return {
          cueType: 'unknown',
          payload: { raw: trimmed },
          error: `unknown cue: "${head}"`
        }
    }
  }

  function parse(rawText) {
    const empty = {
      segments: [],
      markers: [],
      chapters: [],
      plainText: '',
      errors: [],
      warnings: []
    }
    if (typeof rawText !== 'string' || rawText.length === 0) {
      return empty
    }

    const segments = []
    const markers = []
    const chapters = []
    const errors = []
    let plainText = ''
    let lastIndex = 0
    let cueIdx = 0

    TOKEN_RE.lastIndex = 0
    let m
    while ((m = TOKEN_RE.exec(rawText)) !== null) {
      const before = rawText.slice(lastIndex, m.index)
      if (before) {
        segments.push({ type: 'text', text: before })
        plainText += before
      }

      const parsed = parseTokenBody(m[1])
      const id = 'm_' + cueIdx++
      const charOffset = plainText.length

      if (parsed.error) {
        errors.push({
          index: m.index,
          message: parsed.error,
          raw: m[0]
        })
      }

      segments.push({
        type: 'cue',
        id,
        cueType: parsed.cueType,
        payload: parsed.payload
      })

      markers.push({
        id,
        type: parsed.cueType,
        charOffset,
        payload: parsed.payload
      })

      if (parsed.cueType === 'chapter') {
        chapters.push({
          id,
          title: parsed.payload.title,
          charOffset
        })
      }

      lastIndex = TOKEN_RE.lastIndex
    }

    const tail = rawText.slice(lastIndex)
    if (tail) {
      segments.push({ type: 'text', text: tail })
      plainText += tail
    }

    // Lint: a [[stop]] that is not the final marker means playback halts
    // mid-script and requires a manual reset. Almost always a typo for
    // [[pause]] or [[pause Ns]].
    const warnings = []
    const lastMarkerId = markers.length
      ? markers[markers.length - 1].id
      : null
    for (const m of markers) {
      if (m.type === 'stop' && m.id !== lastMarkerId) {
        warnings.push({
          markerId: m.id,
          charOffset: m.charOffset,
          severity: 'warn',
          message:
            'mid-script [[stop]] halts playback; use [[pause]] or [[pause 3s]] if you want it to resume'
        })
      }
    }

    return { segments, markers, chapters, plainText, errors, warnings }
  }

  function describeMarker(marker) {
    if (!marker) return ''
    const p = marker.payload || {}
    switch (marker.type) {
      case 'pause':
        return p.durationMs
          ? `pause ${formatDuration(p.durationMs)}`
          : 'pause'
      case 'stop':
        return 'stop'
      case 'react':
        return p.durationMs
          ? `react ${p.reaction} ${formatDuration(p.durationMs)}`
          : `react ${p.reaction || '?'}`
      case 'chapter':
        return `chapter: ${p.title || ''}`
      case 'note':
        return `note: ${p.text || ''}`
      case 'breath':
        return 'breath'
      default:
        return p.raw ? `? ${p.raw}` : '?'
    }
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms'
    const s = ms / 1000
    return (Number.isInteger(s) ? s : s.toFixed(1)) + 's'
  }

  // Returns the cue token string the toolbar should insert.
  function tokenFor(kind, opts) {
    switch (kind) {
      case 'pause':
        return '[[pause]]'
      case 'pause-timed':
        return `[[pause ${(opts && opts.seconds) || 3}s]]`
      case 'stop':
        return '[[stop]]'
      case 'react':
        return `[[react ${(opts && opts.reaction) || 'smile'}]]`
      case 'chapter':
        return `[[chapter: ${(opts && opts.title) || 'Section'}]]`
      case 'note':
        return `[[note: ${(opts && opts.text) || 'note to self'}]]`
      case 'breath':
        return '[[breath]]'
      default:
        return ''
    }
  }

  return {
    parse,
    parseTokenBody,
    parseDuration,
    describeMarker,
    formatDuration,
    tokenFor,
    KNOWN_REACTIONS,
    REACTION_GLYPHS
  }
})
