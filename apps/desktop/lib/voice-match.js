/*
 * Voice pacing word matching.
 *
 * Speech-to-text emits spoken words, while scripts often contain connector
 * punctuation ("desktop-level", "state/of/the/art", quotes, ellipses). Treat
 * punctuation as word boundaries so spoken text can advance through the script
 * naturally, while preserving character offsets for overlay scrolling.
 */
;(function (root, factory) {
  const mod = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod
  }
  if (typeof window !== 'undefined') {
    window.voiceMatch = mod
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WORD_RE = /[a-z0-9]+(?:'[a-z0-9]+)*/gi
  const WORD_ALIASES = {
    dialogue: 'dialog',
    dialogues: 'dialogs',
    model: 'modal',
    models: 'modals',
    render: 'renderer',
    versus: 'vs'
  }
  const COMPOUND_WORDS = {
    backend: ['back', 'end'],
    browserwindow: ['browser', 'window'],
    electronjs: ['electron', 'js'],
    nodejs: ['node', 'js']
  }

  function normalizeWord(word) {
    const normalized = String(word || '').toLowerCase().replace(/'/g, '')
    return WORD_ALIASES[normalized] || normalized
  }

  function tokenize(s) {
    return buildVoiceWords(s).map((word) => word.w)
  }

  function expandedWords(raw, at) {
    const w = normalizeWord(raw)
    const parts = COMPOUND_WORDS[w]
    if (!parts) return [{ w, at, end: at + raw.length }]

    let offset = 0
    return parts.map((part) => {
      const start = at + offset
      offset += part.length
      return {
        w: part,
        at: start,
        end: Math.min(at + raw.length, at + offset)
      }
    })
  }

  function buildVoiceWords(plain) {
    const words = []
    const text = String(plain || '')
    let m
    WORD_RE.lastIndex = 0
    while ((m = WORD_RE.exec(text)) !== null) {
      const expanded = expandedWords(m[0], m.index)
      for (const word of expanded) {
        if (word.w) words.push(word)
      }
    }
    return words
  }

  function wordValue(word) {
    return typeof word === 'string' ? word : word && word.w
  }

  function singular(word) {
    if (!word || word.length < 4) return word
    if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y'
    if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
    if (word.endsWith('s') && word.length > 4) return word.slice(0, -1)
    return word
  }

  function editDistanceWithin(a, b, maxDistance) {
    if (!a || !b) return false
    if (Math.abs(a.length - b.length) > maxDistance) return false
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      const curr = [i]
      let rowMin = curr[0]
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        const next = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        )
        curr[j] = next
        rowMin = Math.min(rowMin, next)
      }
      if (rowMin > maxDistance) return false
      prev = curr
    }
    return prev[b.length] <= maxDistance
  }

  function wordSimilarity(a, b) {
    if (!a || !b) return 0
    if (a === b) return 1

    const sa = singular(a)
    const sb = singular(b)
    if (sa && sa === sb) return 0.96

    const minLen = Math.min(a.length, b.length)
    const maxLen = Math.max(a.length, b.length)
    if (minLen >= 5 && maxLen - minLen <= 3 && (a.startsWith(b) || b.startsWith(a))) {
      return 0.86
    }

    const maxDistance = minLen >= 6 ? 2 : minLen >= 4 ? 1 : 0
    if (maxDistance > 0 && editDistanceWithin(a, b, maxDistance)) {
      return maxDistance === 1 ? 0.9 : 0.82
    }

    return 0
  }

  function scoreFromStart(voiceWords, start, spoken) {
    let expectedOffset = 0
    let spokenOffset = 0
    let score = 0
    let skippedSpoken = 0
    let skippedExpected = 0
    let lastExpectedOffset = -1
    const expectedLimit = Math.min(voiceWords.length - start, spoken.length + 6)

    while (spokenOffset < spoken.length && expectedOffset < expectedLimit) {
      const expectedWord = wordValue(voiceWords[start + expectedOffset])
      const spokenWord = wordValue(spoken[spokenOffset])
      const similarity = wordSimilarity(expectedWord, spokenWord)

      if (similarity > 0) {
        score += similarity
        lastExpectedOffset = expectedOffset
        expectedOffset++
        spokenOffset++
        continue
      }

      const nextSpoken = wordValue(spoken[spokenOffset + 1])
      if (nextSpoken && wordSimilarity(expectedWord, nextSpoken) > 0) {
        skippedSpoken++
        spokenOffset++
        continue
      }

      const nextExpected = wordValue(voiceWords[start + expectedOffset + 1])
      if (nextExpected && wordSimilarity(nextExpected, spokenWord) > 0) {
        skippedExpected++
        expectedOffset++
        continue
      }

      skippedSpoken++
      spokenOffset++
    }

    const spokenCoverage = score / Math.max(1, spoken.length)
    const shortNearMatch =
      spoken.length <= 3 &&
      score >= 1 &&
      skippedSpoken <= 1 &&
      skippedExpected === 0 &&
      lastExpectedOffset <= 1
    if ((!shortNearMatch && (score < 2 || spokenCoverage < 0.55)) || lastExpectedOffset < 0) {
      return null
    }

    const confidence = score / Math.max(1, score + skippedSpoken + skippedExpected)
    return {
      score,
      confidence,
      skippedSpoken,
      skippedExpected,
      matchedOffset: lastExpectedOffset
    }
  }

  function findBestMatch(voiceWords, spoken, cursor, opts = {}) {
    if (!Array.isArray(voiceWords) || !voiceWords.length) return null
    if (!Array.isArray(spoken) || spoken.length < 2) return null

    const safeCursor = Math.max(0, Number(cursor) || 0)
    const searchBack = Math.max(0, Number(opts.searchBack) || 0)
    const lookAhead = Math.max(spoken.length, Number(opts.lookAhead) || spoken.length)
    const start = Math.max(0, safeCursor - searchBack)
    const end = Math.min(voiceWords.length, safeCursor + lookAhead)
    let best = null

    for (let s = start; s < end; s++) {
      const match = scoreFromStart(voiceWords, s, spoken)
      if (!match) continue

      const wordDistance = Math.abs(s - safeCursor)
      const behind = s < safeCursor
      const rank =
        match.score * 1000 +
        match.confidence * 240 -
        match.skippedSpoken * 140 -
        match.skippedExpected * 110 -
        wordDistance * 22 -
        (behind ? 220 : 0)

      if (!best || rank > best.rank) {
        best = {
          ...match,
          start: s,
          matchedIndex: Math.min(voiceWords.length - 1, s + match.matchedOffset),
          rank
        }
      }
    }

    return best
  }

  return {
    normalizeWord,
    wordSimilarity,
    tokenize,
    buildVoiceWords,
    findBestMatch
  }
})
