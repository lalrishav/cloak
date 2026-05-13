/*
 * Cue overlay renderer.
 *
 * Rendering: builds DOM segments from the parser output. Cue markers are
 * emitted as zero-width invisible <span class="cue-anchor"> elements whose
 * offsetTop tells the scroll loop where they sit on the page.
 *
 * Firing: each tick, every marker whose anchor top has crossed the reading
 * line (top of viewport) fires once. The "fired" set is keyed by marker id
 * and is reset on script re-parse and on reset/seek.
 */
const handle = document.getElementById('handle')
const viewport = document.getElementById('scroll-viewport')
const textEl = document.getElementById('text')
const endMarker = document.getElementById('end-marker')
const progressFill = document.getElementById('progress-fill')
const progressTrack = document.getElementById('progress-track')
const imagePanel = document.getElementById('image-panel')
const imageEl = document.getElementById('image-el')
const reactionBadge = document.getElementById('reaction-badge')
const reactionGlyph = reactionBadge.querySelector('.glyph')
const reactionLabel = reactionBadge.querySelector('.label')
const statusBadge = document.getElementById('status-badge')
const statusDot = statusBadge.querySelector('.dot')
const statusLabel = statusBadge.querySelector('.label')
const chapterBadge = document.getElementById('chapter-badge')
const readingLineEl = document.getElementById('reading-line')
const countdownEl = document.getElementById('countdown')

let scrollY = 0
let speed = 3
let smartPace = true
let smartPaceZones = []
let smartPaceFactor = 1
let voiceFollowActive = false
let voiceOwnedPlayback = false
let voiceTargetY = 0
let voiceHeardChar = 0
let voiceLastWordIndex = 0
let voiceWordsPerSecond = 2.4
let voiceLastUpdateAt = 0
let wordSpans = []
let running = false
let stopped = false
let rafId = null
let dragging = false
let dragOrigin = null

// Markers: [{ id, type, payload, anchorEl, top, triggerTop }]
let markers = []
let chapters = []
let firedIds = new Set()
let activeChapterId = null

// Pending auto-resume timer for [[pause Ns]]
let resumeTimer = null
let reactionTimer = null
let statusTimer = null

function speedToPxPerFrame(s) {
  const t = (s - 1) / 9
  return 0.2 + t * (4.0 - 0.2)
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function lineHeightPx() {
  const lh = parseFloat(getComputedStyle(textEl).lineHeight)
  return isFinite(lh) && lh > 0 ? lh : 46
}

function getMaxScroll() {
  return Math.max(0, textEl.scrollHeight - viewport.clientHeight + 64)
}

function isInsideEndMarker(node) {
  return !!(node && endMarker && endMarker.contains(node))
}

function rebuildSmartPaceZones() {
  smartPaceZones = []
  if (!textEl.isConnected || textEl.classList.contains('empty')) return

  const textRect = textEl.getBoundingClientRect()
  const availableWidth = Math.max(1, viewport.clientWidth - 96)
  const range = document.createRange()
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT)
  const lines = []
  let node

  while ((node = walker.nextNode())) {
    if (isInsideEndMarker(node) || !node.nodeValue.trim()) continue
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (rect.width < 8 || rect.height < 8) continue
      lines.push({
        top: rect.top - textRect.top,
        bottom: rect.bottom - textRect.top,
        width: rect.width
      })
    }
  }
  range.detach()

  lines.sort((a, b) => a.top - b.top)
  const merged = []
  for (const line of lines) {
    const prev = merged[merged.length - 1]
    if (prev && Math.abs(prev.top - line.top) < 3) {
      prev.width = Math.max(prev.width, line.width)
      prev.bottom = Math.max(prev.bottom, line.bottom)
    } else {
      merged.push({ ...line })
    }
  }

  const lh = lineHeightPx()
  for (let i = 0; i < merged.length; i++) {
    const line = merged[i]
    const widthRatio = line.width / availableWidth
    let factor = 1
    if (widthRatio >= 0.92) factor = 0.6
    else if (widthRatio >= 0.78) factor = 0.72
    else if (widthRatio >= 0.62) factor = 0.86

    smartPaceZones.push({
      start: Math.max(0, line.top - lh * 0.2),
      end: line.bottom + lh * 0.25,
      factor
    })

    const next = merged[i + 1]
    if (next) {
      const gap = next.top - line.bottom
      if (gap > lh * 0.9) {
        smartPaceZones.push({
          start: Math.max(0, line.bottom - lh * 0.1),
          end: next.top + lh * 0.1,
          factor: 0.32
        })
      }
    }
  }

  smartPaceZones.sort((a, b) => a.start - b.start)
}

function smartPaceTargetFactor(y) {
  if (!smartPace || smartPaceZones.length === 0) return 1
  let factor = 1
  for (const zone of smartPaceZones) {
    if (zone.start > y) break
    if (zone.end >= y) factor = Math.min(factor, zone.factor)
  }
  return factor
}

function renderTextSegment(text, startOffset) {
  const re = /(\s+|\S+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const part = m[0]
    const start = startOffset + m.index
    const end = start + part.length
    if (/^\s+$/.test(part)) {
      textEl.insertBefore(document.createTextNode(part), endMarker)
      continue
    }
    const span = document.createElement('span')
    span.className = 'prompt-word'
    span.dataset.start = String(start)
    span.dataset.end = String(end)
    span.textContent = part
    textEl.insertBefore(span, endMarker)
    wordSpans.push(span)
  }
}

function wordForChar(charPos) {
  if (!wordSpans.length) return null
  let candidate = wordSpans[0]
  for (const span of wordSpans) {
    const end = Number(span.dataset.end) || 0
    if (end <= charPos) candidate = span
    else break
  }
  return candidate
}

function wordIndexOf(span) {
  return wordSpans.indexOf(span)
}

function rectInfoForWord(span) {
  if (!span) return null
  const rects = span.getClientRects()
  const rect = rects && rects[0]
  if (!rect) return null
  const textRect = textEl.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  return {
    top: rect.top - textRect.top,
    bottom: rect.bottom - textRect.top,
    rightRatio: (rect.right - viewportRect.left) / Math.max(1, viewportRect.width),
    width: rect.width
  }
}

function setVoiceHighlight(charPos) {
  voiceHeardChar = Math.max(0, Number(charPos) || 0)
  let current = null
  for (const span of wordSpans) {
    const end = Number(span.dataset.end) || 0
    const heard = end <= voiceHeardChar
    span.classList.toggle('heard', heard)
    span.classList.remove('current')
    if (heard) current = span
  }
  if (current) current.classList.add('current')
}

function lineTargetForChar(charPos) {
  const span = wordForChar(charPos)
  return lineTargetForSpan(span)
}

function lineTargetForWordIndex(index) {
  if (!wordSpans.length) return null
  const safeIndex = Math.max(0, Math.min(wordSpans.length - 1, Math.floor(index)))
  return lineTargetForSpan(wordSpans[safeIndex])
}

function lineTargetForSpan(span) {
  if (!span) return null
  const lh = lineHeightPx()
  const current = rectInfoForWord(span)
  if (!current) return span.offsetTop

  let targetTop = current.top
  const idx = wordIndexOf(span)
  const next = idx >= 0 ? wordSpans[idx + 1] : null
  const nextInfo = rectInfoForWord(next)

  if (nextInfo) {
    const nextLine = nextInfo.top > current.top + lh * 0.45
    const nearLineEnd = current.rightRatio > 0.72
    const gapAfterLine = nextInfo.top - current.bottom > lh * 0.65
    const nextWord = (next.textContent || '').replace(/[^a-z0-9']/gi, '')
    const nextIsQuick = nextWord.length > 0 && nextWord.length <= 4

    if (nextLine || nearLineEnd || gapAfterLine) {
      targetTop = nextInfo.top
      const afterNext = wordSpans[idx + 2]
      const afterNextInfo = rectInfoForWord(afterNext)
      if (
        nextIsQuick &&
        afterNextInfo &&
        afterNextInfo.top >= nextInfo.top &&
        afterNextInfo.top <= nextInfo.top + lh * 1.4
      ) {
        targetTop = Math.max(targetTop, afterNextInfo.top)
      }
    }
  }

  return Math.max(0, targetTop - lh * 1.05)
}

function voiceProjectedTarget(now) {
  if (!voiceFollowActive || !voiceLastUpdateAt) return voiceTargetY
  const elapsed = Math.max(0, (now - voiceLastUpdateAt) / 1000)
  if (elapsed > 1.15) return voiceTargetY
  const leadWords = clamp(Math.round(voiceWordsPerSecond * 0.9), 2, 7)
  const projectedWord = voiceLastWordIndex + voiceWordsPerSecond * elapsed + leadWords
  const projectedTarget = lineTargetForWordIndex(projectedWord)
  return projectedTarget == null ? voiceTargetY : Math.max(voiceTargetY, projectedTarget)
}

function clearResumeTimer() {
  if (resumeTimer) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
}

function hideStatusBadge() {
  statusBadge.classList.remove('show', 'kind-pause-timed', 'kind-stop')
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
}

function showStatusBadge(kind, label, sym) {
  hideStatusBadge()
  statusDot.textContent = sym || '⏸'
  statusLabel.textContent = label || 'PAUSED'
  statusBadge.classList.remove('kind-pause-timed', 'kind-stop')
  if (kind) statusBadge.classList.add('kind-' + kind)
  // force reflow to restart transition
  void statusBadge.offsetWidth
  statusBadge.classList.add('show')
}

function hideReactionBadge() {
  reactionBadge.classList.remove('show')
  if (reactionTimer) {
    clearTimeout(reactionTimer)
    reactionTimer = null
  }
}

function showReactionBadge(glyph, label, durationMs) {
  hideReactionBadge()
  reactionGlyph.textContent = glyph || '⚡'
  reactionLabel.textContent = (label || 'REACT').toUpperCase()
  reactionBadge.classList.add('show')
  reactionTimer = setTimeout(hideReactionBadge, Math.max(400, durationMs || 3000))
}

function updateChapterBadge() {
  if (!chapters.length) {
    chapterBadge.classList.remove('show')
    return
  }
  let current = null
  for (const ch of chapters) {
    if (ch.top != null && ch.top <= scrollY + 2) current = ch
    else break
  }
  if (current) {
    if (activeChapterId !== current.id) {
      chapterBadge.textContent = current.title
      chapterBadge.classList.add('show')
      activeChapterId = current.id
    }
  } else {
    chapterBadge.classList.remove('show')
    activeChapterId = null
  }
}

function rebuildProgressTicks() {
  Array.from(progressTrack.querySelectorAll('.tick')).forEach((el) =>
    el.remove()
  )
  const max = getMaxScroll()
  if (max <= 0) return
  for (const ch of chapters) {
    if (ch.top == null) continue
    const pct = Math.min(100, (ch.top / max) * 100)
    const tick = document.createElement('div')
    tick.className = 'tick'
    tick.style.left = pct + '%'
    tick.title = ch.title
    progressTrack.appendChild(tick)
  }
}

function measureAnchors() {
  const lh = lineHeightPx()
  for (const m of markers) {
    if (m.anchorEl) {
      m.top = m.anchorEl.offsetTop
      m.triggerTop = m.top + cueTriggerOffset(m.type, lh)
    }
  }
  for (const ch of chapters) {
    const m = markers.find((mm) => mm.id === ch.id)
    if (m) ch.top = m.top
  }
  markers.sort((a, b) => (a.triggerTop || a.top || 0) - (b.triggerTop || b.top || 0))
  chapters.sort((a, b) => (a.top || 0) - (b.top || 0))
  rebuildSmartPaceZones()
  rebuildProgressTicks()
}

function cueTriggerOffset(type, lh) {
  switch (type) {
    case 'pause':
    case 'breath':
    case 'stop':
    case 'react':
      return lh * 0.85
    default:
      return 0
  }
}

function setEmpty(isEmpty) {
  textEl.classList.toggle('empty', !!isEmpty)
}

function renderEmptyPlaceholder() {
  while (textEl.firstChild && textEl.firstChild !== endMarker) {
    textEl.removeChild(textEl.firstChild)
  }
  setEmpty(true)
  const tn = document.createTextNode(
    'Waiting for script… open the Cue control panel and paste your script.'
  )
  textEl.insertBefore(tn, endMarker)
}

function setParsedScript(parsed) {
  while (textEl.firstChild && textEl.firstChild !== endMarker) {
    textEl.removeChild(textEl.firstChild)
  }

  markers = []
  chapters = []
  wordSpans = []
  voiceTargetY = scrollY
  voiceHeardChar = 0
  firedIds = new Set()
  activeChapterId = null
  clearResumeTimer()
  hideStatusBadge()
  hideReactionBadge()

  const segments =
    parsed && Array.isArray(parsed.segments) ? parsed.segments : []
  const meaningful = segments.some(
    (s) => (s.type === 'text' && s.text.trim()) || s.type === 'cue'
  )
  if (!meaningful) {
    renderEmptyPlaceholder()
    requestAnimationFrame(measureAnchors)
    return
  }

  setEmpty(false)
  let plainOffset = 0
  for (const seg of segments) {
    if (seg.type === 'text') {
      renderTextSegment(seg.text, plainOffset)
      plainOffset += seg.text.length
    } else if (seg.type === 'cue') {
      if (seg.cueType === 'note') continue
      const anchor = document.createElement('span')
      anchor.className = 'cue-anchor'
      anchor.setAttribute('data-cue-id', seg.id)
      anchor.setAttribute('data-cue-type', seg.cueType)
      textEl.insertBefore(anchor, endMarker)
      markers.push({
        id: seg.id,
        type: seg.cueType,
        payload: seg.payload || {},
        anchorEl: anchor,
        top: 0,
        triggerTop: 0
      })
    }
  }

  if (parsed && Array.isArray(parsed.chapters)) {
    for (const ch of parsed.chapters) {
      chapters.push({ id: ch.id, title: ch.title, top: 0 })
    }
  }

  requestAnimationFrame(() => {
    measureAnchors()
    updateChapterBadge()
  })

  if (running) {
    running = false
    start()
  }
}

function applyTransform() {
  textEl.style.transform = `translateY(-${scrollY}px)`
}

function fireMarker(m) {
  switch (m.type) {
    case 'pause': {
      const dur = m.payload && m.payload.durationMs
      running = false
      if (dur && dur > 0) {
        showStatusBadge('pause-timed', `PAUSE ${(dur / 1000).toFixed(1)}s`, '⏸')
        clearResumeTimer()
        resumeTimer = setTimeout(() => {
          resumeTimer = null
          hideStatusBadge()
          start()
        }, dur)
      } else {
        showStatusBadge(null, 'PAUSE', '⏸')
      }
      notifyMain('marker-hit', { id: m.id, type: m.type, payload: m.payload })
      return
    }
    case 'stop': {
      running = false
      stopped = true
      showStatusBadge('stop', 'STOP', '■')
      notifyMain('marker-hit', { id: m.id, type: m.type, payload: m.payload })
      return
    }
    case 'react': {
      const r = (m.payload && m.payload.reaction) || ''
      const g = (m.payload && m.payload.glyph) || '⚡'
      showReactionBadge(g, r, m.payload && m.payload.durationMs)
      notifyMain('marker-hit', { id: m.id, type: m.type, payload: m.payload })
      return
    }
    case 'breath': {
      // brief pause for natural breath
      running = false
      showStatusBadge('pause-timed', 'BREATH', '~')
      clearResumeTimer()
      resumeTimer = setTimeout(() => {
        resumeTimer = null
        hideStatusBadge()
        start()
      }, 700)
      notifyMain('marker-hit', { id: m.id, type: m.type, payload: m.payload })
      return
    }
    case 'chapter':
      notifyMain('marker-hit', { id: m.id, type: m.type, payload: m.payload })
      return
    default:
      return
  }
}

function notifyMain(channel, data) {
  if (window.cue && typeof window.cue.markerEvent === 'function') {
    try {
      window.cue.markerEvent(channel, data)
    } catch {
      // ignore — main may not be ready
    }
  }
}

function checkMarkers() {
  if (!markers.length) return
  const trigger = scrollY + 1 // top of viewport
  for (const m of markers) {
    if (firedIds.has(m.id)) continue
    const markerTop = m.triggerTop != null ? m.triggerTop : m.top
    if (markerTop != null && markerTop <= trigger) {
      firedIds.add(m.id)
      fireMarker(m)
      if (!running) break // pause/stop cues halt the chain
    }
  }
  updateChapterBadge()
}

function tick() {
  if (!running) {
    rafId = null
    return
  }

  const max = getMaxScroll()
  if (max <= 0) {
    progressFill.style.width = '0%'
    rafId = requestAnimationFrame(tick)
    return
  }

  const targetFactor = smartPaceTargetFactor(scrollY)
  smartPaceFactor += (targetFactor - smartPaceFactor) * 0.14
  if (!voiceFollowActive) {
    scrollY += speedToPxPerFrame(speed) * smartPaceFactor
  } else {
    const now = performance.now()
    const target = voiceProjectedTarget(now)
    const silentMs = voiceLastUpdateAt ? now - voiceLastUpdateAt : 9999
    const delta = target - scrollY
    if (Math.abs(delta) > 0.3) {
      const maxStep = silentMs < 900 ? 10 : 4
      const step = Math.sign(delta) * Math.min(Math.abs(delta) * 0.055, maxStep)
      scrollY += step
    }
  }

  if (scrollY >= max) {
    scrollY = max
    running = false
    endMarker.classList.add('show')
  }

  applyTransform()
  progressFill.style.width = `${Math.min(1, scrollY / max) * 100}%`
  checkMarkers()

  rafId = requestAnimationFrame(tick)
}

function start() {
  if (running) return
  if (stopped) {
    // [[stop]] was hit — explicit reset required to play again
    return
  }
  running = true
  endMarker.classList.remove('show')
  hideStatusBadge()
  if (rafId == null) {
    rafId = requestAnimationFrame(tick)
  }
}

function pause() {
  running = false
  clearResumeTimer()
}

function reset() {
  clearResumeTimer()
  hideStatusBadge()
  hideReactionBadge()
  scrollY = 0
  stopped = false
  applyTransform()
  progressFill.style.width = '0%'
  endMarker.classList.remove('show')
  firedIds = new Set()
  activeChapterId = null
  updateChapterBadge()
}

function seekTo(targetY) {
  clearResumeTimer()
  hideStatusBadge()
  const max = getMaxScroll()
  scrollY = Math.max(0, Math.min(max, targetY))
  applyTransform()
  progressFill.style.width = `${Math.min(1, scrollY / Math.max(1, max)) * 100}%`
  stopped = false
  // mark all markers before current position as fired
  firedIds = new Set()
  for (const m of markers) {
    const markerTop = m.triggerTop != null ? m.triggerTop : m.top
    if (markerTop != null && markerTop <= scrollY) {
      firedIds.add(m.id)
    }
  }
  updateChapterBadge()
}

function jumpToChapter(idOrTitle) {
  if (!chapters.length) return
  let ch = chapters.find((c) => c.id === idOrTitle)
  if (!ch && typeof idOrTitle === 'string') {
    const needle = idOrTitle.toLowerCase()
    ch = chapters.find((c) => (c.title || '').toLowerCase() === needle)
  }
  if (!ch) return
  seekTo(ch.top || 0)
}

function jumpRelativeCue(direction) {
  if (!markers.length) return
  if (direction > 0) {
    for (const m of markers) {
      if (m.top != null && m.top > scrollY + 1) {
        seekTo(m.top)
        return
      }
    }
  } else {
    let prev = null
    for (const m of markers) {
      if (m.top != null && m.top < scrollY - 1) prev = m
      else break
    }
    if (prev) seekTo(prev.top)
  }
}

async function runCountdown(n) {
  if (!n || n <= 0) {
    start()
    return
  }
  countdownEl.classList.add('show')
  for (let i = Math.floor(n); i >= 1; i--) {
    countdownEl.textContent = String(i)
    await new Promise((r) => setTimeout(r, 700))
  }
  countdownEl.textContent = 'GO'
  await new Promise((r) => setTimeout(r, 250))
  countdownEl.classList.remove('show')
  start()
}

window.cue.onScriptUpdate((textOrParsed) => {
  if (
    textOrParsed &&
    typeof textOrParsed === 'object' &&
    Array.isArray(textOrParsed.segments)
  ) {
    setParsedScript(textOrParsed)
  } else if (typeof textOrParsed === 'string') {
    // fallback: parse locally if main sent raw text
    const parsed = window.scriptParse
      ? window.scriptParse.parse(textOrParsed)
      : { segments: [{ type: 'text', text: textOrParsed }] }
    setParsedScript(parsed)
  } else {
    setParsedScript({ segments: [], markers: [], chapters: [] })
  }
})

window.cue.onToggle(() => {
  clearResumeTimer()
  if (running) pause()
  else {
    // Explicit user play overrides a prior [[stop]] — the marker halts
    // auto-scroll but should not require a Reset to continue.
    stopped = false
    start()
  }
})

window.cue.onReset(() => reset())

window.cue.onSpeedSet((v) => {
  speed = Math.min(10, Math.max(1, Number(v) || 1))
})

window.cue.onSmartPaceSet((v) => {
  smartPace = v !== false
  smartPaceFactor = 1
  requestAnimationFrame(rebuildSmartPaceZones)
})

window.cue.onFontSet((v) => {
  const size = Math.min(96, Math.max(16, Number(v) || 32))
  textEl.style.fontSize = `${size}px`
  // re-measure on next frame (font changes line wrap)
  requestAnimationFrame(() => {
    measureAnchors()
    updateChapterBadge()
  })
})

window.cue.onImageSet((dataUrl) => {
  if (dataUrl && typeof dataUrl === 'string') {
    imageEl.src = dataUrl
    imagePanel.classList.add('visible')
  } else {
    imageEl.removeAttribute('src')
    imagePanel.classList.remove('visible')
  }
  requestAnimationFrame(() => {
    measureAnchors()
    updateChapterBadge()
  })
})

window.cue.onThemeSet((theme) => {
  if (theme === 'light') document.body.classList.add('theme-light')
  else document.body.classList.remove('theme-light')
})

window.cue.onJump((target) => {
  if (target == null) return
  if (typeof target === 'string' && target.startsWith('cue:')) {
    jumpRelativeCue(target === 'cue:next' ? 1 : -1)
    return
  }
  if (typeof target === 'object' && target.chapter != null) {
    jumpToChapter(target.chapter)
    return
  }
  if (typeof target === 'object' && typeof target.scrollY === 'number') {
    seekTo(target.scrollY)
  }
})

window.cue.onMirror((mode) => {
  document.body.classList.toggle('mirror-h', mode === 'h' || mode === 'both')
  document.body.classList.toggle('mirror-v', mode === 'v' || mode === 'both')
})

window.cue.onCountdown((seconds) => runCountdown(Number(seconds) || 3))

window.cue.onReactionTrigger((data) => {
  const reaction =
    (data && data.reaction) || (typeof data === 'string' ? data : 'smile')
  const glyph =
    (data && data.glyph) ||
    (window.scriptParse &&
      window.scriptParse.REACTION_GLYPHS &&
      window.scriptParse.REACTION_GLYPHS[reaction]) ||
    '⚡'
  showReactionBadge(glyph, reaction, (data && data.durationMs) || 3000)
})

window.cue.onReadingLine((show) => {
  readingLineEl.classList.toggle('show', !!show)
})

window.cue.onVoiceScroll((data) => {
  if (!data) return
  const max = getMaxScroll()
  let target
  if (typeof data.charPos === 'number') {
    setVoiceHighlight(data.charPos)
    target = lineTargetForChar(data.charPos)
    if (typeof data.wordsPerSecond === 'number') {
      voiceWordsPerSecond = clamp(Number(data.wordsPerSecond) || 2.4, 0.9, 6.5)
    }
    if (typeof data.wordIndex === 'number') {
      voiceLastWordIndex = Math.max(voiceLastWordIndex, Number(data.wordIndex) || 0)
      const leadWords = clamp(Math.round(voiceWordsPerSecond * 0.9), 2, 7)
      const leadTarget = lineTargetForWordIndex(voiceLastWordIndex + leadWords)
      if (leadTarget != null) target = Math.max(target == null ? 0 : target, leadTarget)
    }
    voiceLastUpdateAt = performance.now()
  } else if (typeof data.scrollY === 'number') {
    target = data.scrollY
  } else if (typeof data.frac === 'number') {
    target = data.frac * max
  } else {
    return
  }
  if (target == null) return
  target = Math.max(0, Math.min(max, target))
  if (voiceFollowActive) {
    voiceTargetY = Math.max(voiceTargetY, target)
    if (!running && rafId == null) {
      running = true
      rafId = requestAnimationFrame(tick)
    }
  } else {
    const delta = target - scrollY
    if (delta > 0) scrollY += delta * 0.25
    applyTransform()
    progressFill.style.width = `${Math.min(1, scrollY / Math.max(1, max)) * 100}%`
    checkMarkers()
  }
})

window.cue.onVoiceState((data) => {
  voiceFollowActive = !!(data && data.active)
  smartPaceFactor = 1
  voiceTargetY = scrollY
  voiceLastUpdateAt = 0
  voiceLastWordIndex = 0
  if (!voiceFollowActive) {
    for (const span of wordSpans) {
      span.classList.remove('heard', 'current')
    }
    if (voiceOwnedPlayback) {
      running = false
      voiceOwnedPlayback = false
    }
  } else if (!running && rafId == null) {
    voiceOwnedPlayback = true
    running = true
    rafId = requestAnimationFrame(tick)
  }
})

// Re-measure on resize.
window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    measureAnchors()
    updateChapterBadge()
  })
})

handle.addEventListener('mouseenter', () => {
  window.cue.dragStart()
})

handle.addEventListener('mouseleave', () => {
  if (!dragging) window.cue.dragEnd()
})

handle.addEventListener('mousedown', (e) => {
  dragging = true
  dragOrigin = { x: e.screenX, y: e.screenY }
  e.preventDefault()
})

window.addEventListener('mousemove', (e) => {
  if (!dragging || !dragOrigin) return
  const dx = e.screenX - dragOrigin.x
  const dy = e.screenY - dragOrigin.y
  if (dx !== 0 || dy !== 0) {
    window.cue.dragMove({ dx, dy })
    dragOrigin = { x: e.screenX, y: e.screenY }
  }
})

window.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false
    dragOrigin = null
    window.cue.dragEnd()
  }
})

window.addEventListener('blur', () => {
  if (dragging) {
    dragging = false
    dragOrigin = null
    window.cue.dragEnd()
  }
})
