/* eslint-disable no-undef */
const $ = (id) => document.getElementById(id)

// ---------- elements ----------
const scriptEl = $('script')
const titleEl = $('title')
const charCountEl = $('char-count')
const saveStateEl = $('save-state')

const fileInput = $('file-input')

const btnPlay = $('btn-play')
const btnReset = $('btn-reset')
const btnSlow = $('btn-slow')
const btnFast = $('btn-fast')
const btnCountdown = $('btn-countdown')
const btnStumble = $('btn-stumble')

const chapterSelect = $('chapter-select')

const speedEl = $('speed')
const speedVal = $('speed-val')
const fontEl = $('font')
const fontVal = $('font-val')
const opacityEl = $('opacity')
const opacityVal = $('opacity-val')
const countdownInput = $('countdown')
const countdownValEl = $('countdown-val')

const posX = $('pos-x')
const posY = $('pos-y')
const posW = $('pos-w')
const posH = $('pos-h')
const applyPosBtn = $('apply-pos')

const imagePreview = $('image-preview')
const imageThumb = $('image-thumb')
const loadImageBtn = $('load-image')
const clearImageBtn = $('clear-image')
const imageInput = $('image-input')
const referenceCountEl = $('reference-count')
const referenceListEl = $('reference-list')
const referencePrevBtn = $('reference-prev')
const referenceNextBtn = $('reference-next')
const referenceFocusBtn = $('reference-focus')

const themeDarkBtn = $('theme-dark')
const themeLightBtn = $('theme-light')
const mirrorNoneBtn = $('mirror-none')
const mirrorHBtn = $('mirror-h')
const mirrorVBtn = $('mirror-v')
const mirrorBothBtn = $('mirror-both')

const modeNormalBtn = $('mode-normal')
const modeVoiceBtn = $('mode-voice')

const voiceSectionEl = $('voice-section')
const voiceToggleBtn = $('voice-toggle')
const voiceClearBtn = $('voice-clear')
const voiceStatusEl = $('voice-status')
const voiceTranscriptEl = $('voice-transcript')

// LCD elements + focus button
const playIcon = $('play-icon')
const playMeta = $('play-meta')
const lcdSpeed = $('lcd-speed')
const lcdFont = $('lcd-font')
const lcdOpacity = $('lcd-opacity')
const lcdMode = $('lcd-mode')
const lcdPlaying = $('lcd-playing')
const lcdOverlay = $('lcd-overlay')
const focusBtn = $('focus-btn')

// Modal panel
const panelModal = $('panel-modal')
const panelTitle = $('panel-title')
const panelBody = $('panel-body')
const panelCloseBtn = $('panel-close')
const panelTemplatesEl = $('panel-templates')

const STORAGE_KEY = 'cue.state.v3'
const DEFAULT_OVERLAY_H = 460

const state = {
  script: '',
  speed: 3,
  font: 32,
  opacity: 80,
  smartPace: true, // always on now
  posX: 100,
  posY: 60,
  posW: 960,
  posH: DEFAULT_OVERLAY_H,
  overlayHeightVersion: 3,
  playing: false,
  image: null,
  imageName: '',
  references: [],
  activeReferenceId: null,
  referenceFocus: false,
  theme: 'dark',
  mirror: 'none',
  mode: 'normal', // 'normal' | 'voice'
  countdown: 3,
  activeScriptId: null,
  activeTitle: 'Untitled',
  collapsed: {},
  focus: false,
  analytics: false,
  analyticsAsked: false
}

let parsed = { segments: [], markers: [], chapters: [], plainText: '', errors: [] }
let scripts = []
let dbStatus = { connected: false, error: null }
let saveDebounce = null
let isApplying = false
let bootstrapPromise = null

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    Object.assign(state, saved)
    state.playing = false
    state.smartPace = true // always on, ignore any persisted false
    if (state.overlayHeightVersion !== 3 && state.posH <= 360) {
      state.posH = DEFAULT_OVERLAY_H
      state.overlayHeightVersion = 3
    }
  } catch {
    /* ignore */
  }
}

function saveState() {
  const persisted = {
    ...state,
    playing: false,
    image: null,
    imageName: '',
    references: [],
    activeReferenceId: null,
    referenceFocus: false
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function updateCharCount() {
  const len = scriptEl.value.length
  charCountEl.textContent = `${len.toLocaleString()} chars`
}

function setPlayLabel() {
  if (playIcon) playIcon.textContent = state.playing ? '⏸' : '▶'
  if (btnPlay) btnPlay.classList.toggle('is-playing', !!state.playing)
  if (playMeta) playMeta.textContent = state.playing ? 'Playing' : 'Paused'
  updateLcd()
}

function paintRangeFill(el) {
  if (!el) return
  const min = Number(el.min) || 0
  const max = Number(el.max) || 100
  const val = Number(el.value) || 0
  const pct = ((val - min) / Math.max(1, max - min)) * 100
  el.style.setProperty('--range-pct', `${pct}%`)
}

function updateLcd() {
  if (lcdSpeed) lcdSpeed.textContent = String(state.speed)
  if (lcdFont) lcdFont.textContent = String(state.font)
  if (lcdOpacity) lcdOpacity.textContent = String(state.opacity)
  if (lcdMode) {
    lcdMode.classList.toggle('on', state.mode === 'voice')
    const label = lcdMode.lastChild
    if (label && label.nodeType === Node.TEXT_NODE) {
      label.textContent = state.mode === 'voice' ? 'Voice' : 'Normal'
    } else {
      // structure is `<span class="pip"></span>Mode` — replace trailing text
      lcdMode.innerHTML = `<span class="pip"></span>${state.mode === 'voice' ? 'Voice' : 'Normal'}`
    }
  }
  if (lcdPlaying) lcdPlaying.classList.toggle('on', !!state.playing)
}

function applyFocusMode() {
  document.body.classList.toggle('focus-mode', !!state.focus)
  if (focusBtn) focusBtn.classList.toggle('active', !!state.focus)
}

function initCollapsibles() {
  const defaults = {}
  if (!state.collapsed || typeof state.collapsed !== 'object') state.collapsed = {}
  document.querySelectorAll('[data-toggle]').forEach((head) => {
    const key = head.dataset.toggle
    if (!key) return
    const section = head.closest('section')
    if (!section) return
    const hasStored = Object.prototype.hasOwnProperty.call(state.collapsed, key)
    const collapsed = hasStored ? !!state.collapsed[key] : !!defaults[key]
    section.classList.toggle('is-collapsed', collapsed)
    head.addEventListener('click', () => {
      const isOpen = !section.classList.contains('is-collapsed')
      section.classList.toggle('is-collapsed', isOpen)
      state.collapsed[key] = isOpen
      saveState()
    })
  })
}

function pulse(el) {
  if (!el) return
  el.classList.remove('echo-pulse')
  void el.offsetWidth
  el.classList.add('echo-pulse')
}

function getActiveReference() {
  return state.references.find((ref) => ref.id === state.activeReferenceId) || null
}

function activeReferenceIndex() {
  return state.references.findIndex((ref) => ref.id === state.activeReferenceId)
}

function renderReferenceTray() {
  const active = getActiveReference()
  const count = state.references.length
  referenceCountEl.textContent = `${count} file${count === 1 ? '' : 's'}`
  referenceFocusBtn.textContent = state.referenceFocus ? 'Minimize' : 'Focus'
  referenceFocusBtn.disabled = count === 0
  referencePrevBtn.disabled = count <= 1
  referenceNextBtn.disabled = count <= 1
  clearImageBtn.disabled = count === 0

  if (active && active.dataUrl) {
    imageThumb.src = active.dataUrl
    imageThumb.alt = active.name || ''
    imagePreview.classList.remove('empty')
  } else {
    imageThumb.removeAttribute('src')
    imageThumb.alt = ''
    imagePreview.classList.add('empty')
  }

  referenceListEl.innerHTML = ''
  if (!count) return
  state.references.forEach((ref, idx) => {
    const row = document.createElement('div')
    row.className = 'reference-row'
    row.classList.toggle('active', ref.id === state.activeReferenceId)
    const label = document.createElement('span')
    label.textContent = `${idx + 1}. ${ref.name || 'Reference image'}`
    const btn = document.createElement('button')
    btn.textContent = ref.id === state.activeReferenceId ? 'Active' : 'Use'
    btn.disabled = ref.id === state.activeReferenceId
    btn.addEventListener('click', () => {
      state.activeReferenceId = ref.id
      renderReferenceTray()
      sendReferences()
    })
    row.appendChild(label)
    row.appendChild(btn)
    referenceListEl.appendChild(row)
  })
}

function sendReferences() {
  window.cue.setReferences({
    references: state.references,
    activeReferenceId: state.activeReferenceId,
    referenceFocus: state.referenceFocus
  })
}

function renderThemePills() {
  themeDarkBtn.classList.toggle('active', state.theme !== 'light')
  themeLightBtn.classList.toggle('active', state.theme === 'light')
  themeDarkBtn.setAttribute('aria-selected', state.theme !== 'light')
  themeLightBtn.setAttribute('aria-selected', state.theme === 'light')
}

function renderMirrorPills() {
  mirrorNoneBtn.classList.toggle('active', state.mirror === 'none')
  mirrorHBtn.classList.toggle('active', state.mirror === 'h')
  mirrorVBtn.classList.toggle('active', state.mirror === 'v')
  mirrorBothBtn.classList.toggle('active', state.mirror === 'both')
}

function renderModePills() {
  const isVoice = state.mode === 'voice'
  modeNormalBtn.classList.toggle('active', !isVoice)
  modeVoiceBtn.classList.toggle('active', isVoice)
  modeNormalBtn.setAttribute('aria-selected', String(!isVoice))
  modeVoiceBtn.setAttribute('aria-selected', String(isVoice))
  if (voiceSectionEl) voiceSectionEl.hidden = !isVoice
  updateLcd()
}

function renderSaveState(kind) {
  saveStateEl.classList.remove('saved', 'dirty', 'err')
  if (kind === 'saved') {
    saveStateEl.textContent = 'Saved'
    saveStateEl.classList.add('saved')
  } else if (kind === 'dirty') {
    saveStateEl.textContent = 'Saving…'
    saveStateEl.classList.add('dirty')
  } else if (kind === 'err') {
    saveStateEl.textContent = 'Local only'
    saveStateEl.classList.add('err')
  } else {
    saveStateEl.textContent = '—'
  }
}

function renderLib() {
  const libList = $('lib-list')
  const libCount = $('lib-count')
  const libNewBtn = $('lib-new')
  if (!libList) return
  libList.innerHTML = ''
  if (libCount) libCount.textContent = `${scripts.length} script${scripts.length === 1 ? '' : 's'}`
  if (!scripts.length) {
    const e = document.createElement('div')
    e.className = 'lib-empty'
    e.textContent = dbStatus.connected
      ? 'No scripts yet. Click NEW to create one.'
      : 'No MongoDB — open or import a script to work locally.'
    libList.appendChild(e)
    if (libNewBtn) {
      libNewBtn.disabled = !dbStatus.connected
    }
    return
  }
  if (libNewBtn) libNewBtn.disabled = !dbStatus.connected
  for (const s of scripts) {
    const row = document.createElement('div')
    row.className = 'lib-item' + (s.id === state.activeScriptId ? ' active' : '')
    row.dataset.id = s.id
    const updated = s.updatedAt ? new Date(s.updatedAt) : null
    const updatedStr = updated ? updated.toLocaleString() : ''
    row.innerHTML = `
      <span class="title">${escapeHtml(s.title || 'Untitled')}</span>
      <span class="meta">${updatedStr}</span>
      <button class="del" title="Delete">✕</button>
    `
    row.addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('del')) return
      openScript(s.id)
      hidePanelModal()
    })
    row.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`Delete "${s.title}"?`)) return
      try {
        await window.cue.scriptsDelete(s.id)
        if (state.activeScriptId === s.id) {
          state.activeScriptId = null
          await ensureActiveScript()
        }
        await refreshLib()
      } catch (err) {
        alert('Delete failed: ' + (err && err.message))
      }
    })
    libList.appendChild(row)
  }
}

function reparse() {
  parsed = window.scriptParse.parse(scriptEl.value || '')
  refreshVoiceWords()
  populateChapterSelect()
}

function populateChapterSelect() {
  if (!chapterSelect) return
  const prev = chapterSelect.value
  chapterSelect.innerHTML = '<option value="">— jump to chapter —</option>'
  for (const ch of parsed.chapters || []) {
    const o = document.createElement('option')
    o.value = ch.id
    o.textContent = ch.title || 'Untitled'
    chapterSelect.appendChild(o)
  }
  chapterSelect.value = prev
}

function applyAll() {
  isApplying = true
  scriptEl.value = state.script
  titleEl.value = state.activeTitle || ''
  speedEl.value = state.speed
  fontEl.value = state.font
  opacityEl.value = state.opacity
  countdownInput.value = state.countdown
  posX.value = state.posX
  posY.value = state.posY
  posW.value = state.posW
  posH.value = state.posH

  speedVal.textContent = String(state.speed)
  fontVal.textContent = `${state.font}px`
  opacityVal.textContent = `${state.opacity}%`
  countdownValEl.textContent = `${state.countdown}s`
  paintRangeFill(speedEl)
  paintRangeFill(fontEl)
  paintRangeFill(opacityEl)
  paintRangeFill(countdownInput)
  updateCharCount()
  setPlayLabel()
  renderReferenceTray()
  renderThemePills()
  renderMirrorPills()
  renderModePills()

  window.cue.updateScript(state.script)
  window.cue.setSpeed(state.speed)
  window.cue.setFontSize(state.font)
  window.cue.setOpacity(state.opacity / 100)
  window.cue.setSmartPace(true) // always on
  sendReferences()
  window.cue.setTheme(state.theme)
  window.cue.setMirror(state.mirror)
  window.cue.reposition({ x: state.posX, y: state.posY, w: state.posW, h: state.posH })

  reparse()
  isApplying = false
}

// ---------- LIBRARY / DB ----------

async function refreshLib() {
  if (!dbStatus.connected) {
    renderLib()
    return
  }
  try {
    scripts = await window.cue.scriptsList()
  } catch {
    scripts = []
  }
  renderLib()
}

async function ensureActiveScript() {
  if (!dbStatus.connected) return
  if (state.activeScriptId) {
    const found = scripts.find((s) => s.id === state.activeScriptId)
    if (found) {
      await openScript(found.id)
      return
    }
  }
  if (scripts.length) {
    await openScript(scripts[0].id)
  } else {
    try {
      const fresh = await window.cue.scriptsCreate({
        title: 'Untitled',
        body: state.script || ''
      })
      await refreshLib()
      await openScript(fresh.id)
    } catch {
      /* ignore */
    }
  }
}

async function openScript(id) {
  if (!dbStatus.connected || !id) return
  try {
    const doc = await window.cue.scriptsGet(id)
    if (!doc) return
    state.activeScriptId = doc.id
    state.activeTitle = doc.title || 'Untitled'
    state.script = doc.body || ''
    if (doc.settings) {
      const s = doc.settings
      if (typeof s.speed === 'number') state.speed = s.speed
      if (typeof s.font === 'number') state.font = s.font
      if (typeof s.opacity === 'number') state.opacity = s.opacity
      if (typeof s.theme === 'string') state.theme = s.theme
      if (typeof s.mirror === 'string') state.mirror = s.mirror
    }
    saveState()
    applyAll()
    renderLib()
    renderSaveState('saved')
    window.cue.dbStatus().then(() => {})
    try { window.cue.setActiveScript(state.activeScriptId) } catch {}
    refreshSessions()
  } catch (err) {
    renderSaveState('err')
  }
}

function scheduleSave() {
  if (!dbStatus.connected || !state.activeScriptId || isApplying) return
  renderSaveState('dirty')
  clearTimeout(saveDebounce)
  saveDebounce = setTimeout(async () => {
    try {
      await window.cue.scriptsUpdate(state.activeScriptId, {
        title: state.activeTitle,
        body: state.script,
        settings: {
          speed: state.speed,
          font: state.font,
          opacity: state.opacity,
          smartPace: true,
          theme: state.theme,
          mirror: state.mirror
        }
      })
      renderSaveState('saved')
      const idx = scripts.findIndex((s) => s.id === state.activeScriptId)
      if (idx > -1) {
        scripts[idx].title = state.activeTitle
        scripts[idx].updatedAt = new Date().toISOString()
        scripts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        renderLib()
      }
    } catch (err) {
      renderSaveState('err')
    }
  }, 600)
}

// ---------- script editing ----------

scriptEl.addEventListener('input', () => {
  state.script = scriptEl.value
  updateCharCount()
  window.cue.updateScript(state.script)
  reparse()
  saveState()
  scheduleSave()
})

titleEl.addEventListener('input', () => {
  state.activeTitle = titleEl.value
  saveState()
  scheduleSave()
})

// ---------- cue toolbar ----------

function insertAtCursor(text, autoSelect) {
  const el = scriptEl
  const start = el.selectionStart || 0
  const end = el.selectionEnd || 0
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  el.value = before + text + after
  el.focus()
  if (autoSelect) {
    const offset = autoSelect.offset || 0
    const len = autoSelect.length || 0
    el.setSelectionRange(start + offset, start + offset + len)
  } else {
    el.setSelectionRange(start + text.length, start + text.length)
  }
  state.script = el.value
  updateCharCount()
  window.cue.updateScript(state.script)
  reparse()
  scheduleSave()
}

$('cue-insert-pause').addEventListener('click', () => insertAtCursor('[[pause]]'))
$('cue-insert-pause-timed').addEventListener('click', () => insertAtCursor('[[pause 3s]]'))
$('cue-insert-stop').addEventListener('click', () => insertAtCursor('[[stop]]'))
$('cue-insert-breath').addEventListener('click', () => insertAtCursor('[[breath]]'))
$('cue-insert-react').addEventListener('click', () => {
  const kind = $('cue-reaction-kind').value || 'smile'
  insertAtCursor(`[[react ${kind}]]`)
})
$('cue-insert-chapter').addEventListener('click', () => {
  insertAtCursor('[[chapter: Section]]', { offset: '[[chapter: '.length, length: 'Section'.length })
})
$('cue-insert-note').addEventListener('click', () => {
  insertAtCursor('[[note: ]]', { offset: '[[note: '.length, length: 0 })
})

// ---------- AI format ----------

const btnFormatAi = $('cue-format-ai')
let aiFormatting = false
let aiHasKey = false
const aiOriginalLabel = btnFormatAi ? btnFormatAi.textContent : '✨ Format with AI'

function setAiButtonState(kind, label) {
  if (!btnFormatAi) return
  btnFormatAi.classList.remove('busy', 'err')
  if (kind === 'busy') btnFormatAi.classList.add('busy')
  if (kind === 'err') btnFormatAi.classList.add('err')
  btnFormatAi.textContent = label || aiOriginalLabel
}

function flashAiButton(kind, label, ms) {
  setAiButtonState(kind, label)
  setTimeout(() => {
    if (!aiFormatting) setAiButtonState(null, null)
  }, ms || 1800)
}

async function refreshAiStatus() {
  if (!btnFormatAi) return
  try {
    const s = await window.cue.aiStatus()
    aiHasKey = !!(s && s.hasKey)
    if (!aiHasKey) {
      btnFormatAi.disabled = true
      btnFormatAi.title = 'OPENAI_API_KEY is not set. Restart Cloak with the env var to enable.'
    } else {
      btnFormatAi.disabled = false
      btnFormatAi.title = `Reformat with ${(s && s.model) || 'GPT'} — keeps every word, only adds breaks/timed pauses/cues`
    }
  } catch {
    btnFormatAi.disabled = true
    btnFormatAi.title = 'AI formatter unavailable.'
  }
}

if (btnFormatAi) {
  btnFormatAi.addEventListener('click', async () => {
    if (aiFormatting) return
    if (!aiHasKey) {
      alert('OPENAI_API_KEY is not set.\n\nRestart Cloak from a shell where the env var is exported, e.g.:\n\n  OPENAI_API_KEY=sk-... npm start')
      return
    }
    const text = scriptEl.value
    if (!text || !text.trim()) {
      flashAiButton('err', '✕ Empty', 1200)
      return
    }

    aiFormatting = true
    btnFormatAi.disabled = true
    setAiButtonState('busy', 'Formatting…')

    if (dbStatus.connected && state.activeScriptId) {
      try { await window.cue.scriptsSnapshot(state.activeScriptId) } catch { /* ignore */ }
    }

    try {
      const res = await window.cue.formatScriptWithAi(text)
      if (res && res.ok && typeof res.text === 'string') {
        scriptEl.value = res.text
        state.script = res.text
        updateCharCount()
        window.cue.updateScript(state.script)
        reparse()
        saveState()
        scheduleSave()
        flashAiButton(null, '✓ Done', 1200)
      } else {
        const msg = (res && res.error) || 'no result returned'
        const diag = res && res.diag ? '\n\nDiagnostic:\n' + JSON.stringify(res.diag, null, 2) : ''
        flashAiButton('err', '✕ Failed', 2000)
        alert('AI format failed:\n\n' + msg + diag)
      }
    } catch (err) {
      flashAiButton('err', '✕ Failed', 2000)
      alert('AI format failed:\n\n' + (err && err.message ? err.message : String(err)))
    } finally {
      aiFormatting = false
      btnFormatAi.disabled = !aiHasKey
    }
  })
}

// ---------- file import (triggered via menu) ----------

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const text = String(reader.result || '')
      if (dbStatus.connected) {
        try {
          const created = await window.cue.scriptsCreate({
            title: file.name.replace(/\.(txt|md)$/i, ''),
            body: text
          })
          await refreshLib()
          await openScript(created.id)
        } catch (err) {
          alert('Import failed: ' + (err && err.message))
        }
      } else {
        scriptEl.value = text
        state.script = text
        state.activeTitle = file.name.replace(/\.(txt|md)$/i, '')
        titleEl.value = state.activeTitle
        updateCharCount()
        window.cue.updateScript(text)
        reparse()
        saveState()
      }
    }
    reader.readAsText(file)
    fileInput.value = ''
  })
}

async function createNewScript() {
  if (!dbStatus.connected) {
    state.script = ''
    state.activeTitle = 'Untitled'
    scriptEl.value = ''
    titleEl.value = state.activeTitle
    updateCharCount()
    window.cue.updateScript('')
    reparse()
    saveState()
    titleEl.focus()
    titleEl.select()
    return
  }
  try {
    const created = await window.cue.scriptsCreate({
      title: 'Untitled',
      body: ''
    })
    await refreshLib()
    await openScript(created.id)
    titleEl.focus()
    titleEl.select()
  } catch (err) {
    alert('Create failed: ' + (err && err.message))
  }
}

// ---------- playback ----------

btnPlay.addEventListener('click', () => {
  state.playing = !state.playing
  setPlayLabel()
  window.cue.toggleScroll()
})

btnReset.addEventListener('click', () => {
  window.cue.resetScroll()
  state.playing = false
  setPlayLabel()
})

function nudgeSpeed(delta) {
  state.speed = clamp(state.speed + delta, 1, 10)
  speedEl.value = state.speed
  speedVal.textContent = String(state.speed)
  paintRangeFill(speedEl)
  window.cue.setSpeed(state.speed)
  updateLcd()
  saveState()
  scheduleSave()
  pulse(speedEl)
}

btnSlow.addEventListener('click', () => nudgeSpeed(-1))
btnFast.addEventListener('click', () => nudgeSpeed(1))

btnCountdown.addEventListener('click', () => {
  window.cue.startCountdown(state.countdown)
  state.playing = true
  setPlayLabel()
})

btnStumble.addEventListener('click', () => {
  window.cue.bookmarkStumble()
  pulse(btnStumble)
  setTimeout(refreshSessions, 300)
})

// Chapter select: jump immediately on change (no separate JUMP button)
chapterSelect.addEventListener('change', () => {
  const v = chapterSelect.value
  if (!v) return
  window.cue.jumpToChapter(v)
})

// ---------- settings ----------

speedEl.addEventListener('input', () => {
  state.speed = clamp(Number(speedEl.value), 1, 10)
  speedVal.textContent = String(state.speed)
  paintRangeFill(speedEl)
  window.cue.setSpeed(state.speed)
  updateLcd()
  saveState()
  scheduleSave()
})

fontEl.addEventListener('input', () => {
  state.font = clamp(Number(fontEl.value), 16, 96)
  fontVal.textContent = `${state.font}px`
  paintRangeFill(fontEl)
  window.cue.setFontSize(state.font)
  updateLcd()
  saveState()
  scheduleSave()
})

opacityEl.addEventListener('input', () => {
  state.opacity = clamp(Number(opacityEl.value), 10, 100)
  opacityVal.textContent = `${state.opacity}%`
  paintRangeFill(opacityEl)
  window.cue.setOpacity(state.opacity / 100)
  updateLcd()
  saveState()
  scheduleSave()
})

countdownInput.addEventListener('input', () => {
  state.countdown = clamp(Number(countdownInput.value), 1, 10)
  countdownValEl.textContent = `${state.countdown}s`
  paintRangeFill(countdownInput)
  saveState()
})

applyPosBtn.addEventListener('click', () => {
  state.posX = Math.round(Number(posX.value) || 0)
  state.posY = Math.round(Number(posY.value) || 0)
  state.posW = Math.max(200, Math.round(Number(posW.value) || 960))
  state.posH = Math.max(80, Math.round(Number(posH.value) || DEFAULT_OVERLAY_H))
  posX.value = state.posX
  posY.value = state.posY
  posW.value = state.posW
  posH.value = state.posH
  window.cue.reposition({ x: state.posX, y: state.posY, w: state.posW, h: state.posH })
  saveState()
})

// ---------- image / reference ----------

loadImageBtn.addEventListener('click', () => imageInput.click())
imageInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'))
  if (!files.length) {
    imageInput.value = ''
    return
  }
  Promise.all(files.map((file, idx) => new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve({
      id: `ref-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'image',
      name: file.name,
      dataUrl: String(reader.result || '')
    })
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  }))).then((refs) => {
    const nextRefs = refs.filter(Boolean)
    if (!nextRefs.length) return
    state.references = state.references.concat(nextRefs)
    state.activeReferenceId = nextRefs[0].id
    renderReferenceTray()
    sendReferences()
  })
  imageInput.value = ''
})

clearImageBtn.addEventListener('click', () => {
  state.references = []
  state.activeReferenceId = null
  state.referenceFocus = false
  renderReferenceTray()
  window.cue.clearReferences()
})

function stepReference(delta) {
  if (!state.references.length) return
  const idx = activeReferenceIndex()
  const safeIdx = idx >= 0 ? idx : 0
  const next = (safeIdx + delta + state.references.length) % state.references.length
  state.activeReferenceId = state.references[next].id
  renderReferenceTray()
  sendReferences()
}

referencePrevBtn.addEventListener('click', () => stepReference(-1))
referenceNextBtn.addEventListener('click', () => stepReference(1))
referenceFocusBtn.addEventListener('click', () => {
  if (!state.references.length) return
  state.referenceFocus = !state.referenceFocus
  renderReferenceTray()
  sendReferences()
})

// ---------- theme / mirror / mode ----------

function setTheme(value) {
  const next = value === 'light' ? 'light' : 'dark'
  if (state.theme === next) return
  state.theme = next
  renderThemePills()
  window.cue.setTheme(next)
  saveState()
  scheduleSave()
}

themeDarkBtn.addEventListener('click', () => setTheme('dark'))
themeLightBtn.addEventListener('click', () => setTheme('light'))

function setMirror(mode) {
  if (state.mirror === mode) return
  state.mirror = mode
  renderMirrorPills()
  window.cue.setMirror(mode)
  saveState()
  scheduleSave()
}

mirrorNoneBtn.addEventListener('click', () => setMirror('none'))
mirrorHBtn.addEventListener('click', () => setMirror('h'))
mirrorVBtn.addEventListener('click', () => setMirror('v'))
mirrorBothBtn.addEventListener('click', () => setMirror('both'))

async function setMode(value) {
  const next = value === 'voice' ? 'voice' : 'normal'
  if (state.mode === next) {
    renderModePills()
    return
  }
  // when leaving voice mode, stop recognition
  if (state.mode === 'voice' && next !== 'voice' && voiceActive) {
    stopRecognition()
    if (voiceToggleBtn) {
      voiceToggleBtn.textContent = '🎙 Start Listening'
      voiceToggleBtn.classList.add('primary')
    }
  }
  state.mode = next
  renderModePills()
  saveState()
  scheduleSave()
}

modeNormalBtn.addEventListener('click', () => setMode('normal'))
modeVoiceBtn.addEventListener('click', () => setMode('voice'))

// ---------- remote echoes ----------

window.cue.onControlToggleEcho((v) => {
  if (typeof v === 'boolean') state.playing = v
  else state.playing = !state.playing
  setPlayLabel()
  pulse(btnPlay)
})

window.cue.onControlResetEcho(() => {
  state.playing = false
  setPlayLabel()
  pulse(btnReset)
})

window.cue.onControlSpeedNudge((delta) => nudgeSpeed(Number(delta) || 0))

window.cue.onRemoteSpeedSet((v) => {
  state.speed = clamp(Number(v) || 1, 1, 10)
  speedEl.value = state.speed
  speedVal.textContent = String(state.speed)
  paintRangeFill(speedEl)
  saveState()
  pulse(speedEl)
})

window.cue.onRemoteFontSet((v) => {
  state.font = clamp(Number(v) || 32, 16, 96)
  fontEl.value = state.font
  fontVal.textContent = `${state.font}px`
  paintRangeFill(fontEl)
  saveState()
  pulse(fontEl)
})

window.cue.onRemoteOpacitySet((v) => {
  state.opacity = clamp(Number(v) || 80, 10, 100)
  opacityEl.value = state.opacity
  opacityVal.textContent = `${state.opacity}%`
  paintRangeFill(opacityEl)
  saveState()
  pulse(opacityEl)
})

window.cue.onRemoteSmartPaceSet(() => {
  // smart pace is always on now — ignore remote toggles
})

window.cue.onRemoteThemeSet((v) => {
  state.theme = v === 'light' ? 'light' : 'dark'
  renderThemePills()
  try { saveState() } catch {}
})

window.cue.onRemoteImageSet((dataUrl) => {
  if (state.references.length) return
  state.references = typeof dataUrl === 'string' && dataUrl.startsWith('data:')
    ? [{ id: 'legacy-remote-image', type: 'image', name: 'from remote', dataUrl }]
    : []
  state.activeReferenceId = state.references[0] ? state.references[0].id : null
  renderReferenceTray()
})

window.cue.onRemoteReferenceSet((payload) => {
  if (!payload || !Array.isArray(payload.references)) return
  state.references = payload.references
  state.activeReferenceId = payload.activeReferenceId || (state.references[0] && state.references[0].id) || null
  state.referenceFocus = !!payload.referenceFocus
  renderReferenceTray()
})

window.cue.onRemoteStumble(() => {
  pulse(btnStumble)
  setTimeout(refreshSessions, 300)
})

window.cue.onMarkerEvent((_evt) => { /* visual ack could go here */ })

// ---------- remote info ----------

let remoteUrl = ''
let remoteState = { pending: true }

function setRemoteUrlState(info) {
  remoteState = info || {}
}

async function loadRemoteInfo() {
  try {
    const info = await window.cue.getRemoteInfo()
    setRemoteUrlState(info)
    renderRemotePanel()
  } catch {
    /* ignore */
  }
}

function renderRemotePanel() {
  const qrFrame = $('qr-frame')
  const qrImage = $('qr-image')
  const remoteUrlEl = $('remote-url')
  const remoteCopyBtn = $('remote-copy')
  const remoteStatusLine = $('remote-status-line')
  const remoteStatusText = $('remote-status-text')
  const remoteStatusEl = $('remote-status')
  if (!qrFrame) return // panel not currently in DOM

  if (remoteState.error) {
    if (remoteUrlEl) remoteUrlEl.textContent = '—'
    if (remoteCopyBtn) { remoteCopyBtn.disabled = true; remoteCopyBtn.style.opacity = '0.5' }
    if (qrImage) qrImage.removeAttribute('src')
    qrFrame.classList.add('empty')
    if (remoteStatusText) remoteStatusText.textContent = 'server failed: ' + remoteState.error
    if (remoteStatusLine) remoteStatusLine.className = 'remote-status-line error'
    if (remoteStatusEl) remoteStatusEl.textContent = 'error'
    return
  }
  if (remoteState.pending) {
    if (remoteStatusText) remoteStatusText.textContent = 'starting server…'
    if (remoteStatusEl) remoteStatusEl.textContent = 'starting…'
    return
  }
  remoteUrl = remoteState.url || ''
  if (remoteUrlEl) remoteUrlEl.textContent = remoteUrl || '—'
  if (remoteCopyBtn) {
    remoteCopyBtn.disabled = !remoteUrl
    remoteCopyBtn.style.opacity = remoteUrl ? '1' : '0.5'
    remoteCopyBtn.onclick = async () => {
      if (!remoteUrl) return
      try {
        await navigator.clipboard.writeText(remoteUrl)
        const orig = remoteCopyBtn.textContent
        remoteCopyBtn.textContent = 'Copied'
        setTimeout(() => { remoteCopyBtn.textContent = orig }, 1200)
      } catch { /* ignore */ }
    }
  }
  if (remoteState.qr && qrImage) {
    qrImage.src = remoteState.qr
    qrFrame.classList.remove('empty')
  } else if (qrImage) {
    qrImage.removeAttribute('src')
    qrFrame.classList.add('empty')
  }
  const count = typeof remoteState.connections === 'number' ? remoteState.connections : 0
  if (count > 0) {
    if (remoteStatusText) remoteStatusText.textContent = `${count} ${count === 1 ? 'phone' : 'phones'} connected`
    if (remoteStatusLine) remoteStatusLine.className = 'remote-status-line connected'
    if (remoteStatusEl) remoteStatusEl.textContent = `${count} live`
  } else {
    if (remoteStatusText) remoteStatusText.textContent = 'waiting for phone…'
    if (remoteStatusLine) remoteStatusLine.className = 'remote-status-line'
    if (remoteStatusEl) remoteStatusEl.textContent = 'ready'
  }
}

window.cue.onRemoteReady((info) => {
  setRemoteUrlState(info)
  renderRemotePanel()
})
window.cue.onRemoteError((err) => {
  setRemoteUrlState({ error: err || 'unknown error' })
  renderRemotePanel()
})
window.cue.onRemoteConnections((count) => {
  remoteState.connections = count
  renderRemotePanel()
})

// ---------- sessions ----------

let sessionsCache = []

async function refreshSessions() {
  if (!dbStatus.connected || !state.activeScriptId) {
    sessionsCache = []
    renderSessionPanel()
    return
  }
  try {
    sessionsCache = await window.cue.sessionsList(state.activeScriptId)
  } catch {
    sessionsCache = []
  }
  renderSessionPanel()
}

function renderSessionPanel() {
  const sessionList = $('session-list')
  const sessionCount = $('session-count')
  if (!sessionList) return
  if (sessionCount) sessionCount.textContent = `${sessionsCache.length} run${sessionsCache.length === 1 ? '' : 's'}`
  sessionList.innerHTML = ''
  if (!sessionsCache.length) {
    sessionList.innerHTML = '<div class="cue-empty">No sessions yet.</div>'
    return
  }
  for (const s of sessionsCache.slice(0, 30)) {
    const row = document.createElement('div')
    row.className = 'session-row'
    const start = new Date(s.startedAt)
    const end = s.endedAt ? new Date(s.endedAt) : null
    const durMs = end ? end - start : 0
    const dur = durMs ? `${Math.round(durMs / 1000)}s` : '—'
    row.innerHTML = `
      <span class="when">${escapeHtml(start.toLocaleString())}</span>
      <span class="dur">${dur}</span>
      <span class="ev">${end ? 'done' : 'live'}</span>
    `
    sessionList.appendChild(row)
  }
}

window.cue.onSessionEvent(() => {
  setTimeout(refreshSessions, 200)
})

// ---------- db status ----------

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = refreshLib().then(() => ensureActiveScript())
  return bootstrapPromise
}

window.cue.onDbStatus((s) => {
  if (!s) return
  const wasConnected = dbStatus.connected
  dbStatus = s
  renderLib()
  if (dbStatus.connected && !wasConnected) bootstrap()
})

window.cue.dbStatus().then((s) => {
  dbStatus = s || { connected: false, error: 'unknown' }
  renderLib()
  if (dbStatus.connected) bootstrap()
})

// ---------- platform ----------

async function populatePlatform() {
  try {
    const info = await window.cue.getPlatform()
    const platMap = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
    const platName = platMap[info.platform] || info.platform
    const pv = $('platform-val')
    const av = $('arch-val')
    if (pv) pv.textContent = `${platName} (${info.osRelease})`
    if (av) av.textContent = info.arch
  } catch {
    /* ignore — platform info appears only in modal */
  }
}

// ---------- VOICE PACING ----------

let voiceActive = false
let voiceFinalText = ''
let voiceInterimText = ''
let voiceCursorChar = 0
let voiceWordCursor = 0
let voiceWords = []
let voiceWordsPerSecond = 2.4
let lastVoiceMatchAt = 0
let lastVoiceMatchWordIndex = 0
let voiceDebugSeq = 0
let lastVoiceMissLogAt = 0
let voiceStream = null
let voiceAudioCtx = null
let voiceSource = null
let voiceProcessor = null
let voiceSilence = null
const VOICE_SAMPLE_RATE = 16000

function setVoiceStatus(text) {
  if (voiceStatusEl) voiceStatusEl.textContent = text
}

function tokenize(s) { return window.voiceMatch.tokenize(s) }
function buildVoiceWords(plain) { return window.voiceMatch.buildVoiceWords(plain) }

function voiceDebug(source, data) {
  try {
    if (window.cue && typeof window.cue.voiceDebug === 'function') {
      window.cue.voiceDebug(source, data)
    }
  } catch { /* debug only */ }
}

function voiceWordWindow(index, radius = 5) {
  if (!voiceWords.length) return ''
  const center = Math.max(0, Math.min(voiceWords.length - 1, Number(index) || 0))
  const start = Math.max(0, center - radius)
  const end = Math.min(voiceWords.length, center + radius + 1)
  return voiceWords.slice(start, end).map((word) => word.w).join(' ')
}

function refreshVoiceWords() {
  voiceWords = buildVoiceWords(parsed.plainText || '')
  voiceWordCursor = 0
  voiceCursorChar = 0
  voiceWordsPerSecond = 2.4
  lastVoiceMatchAt = 0
  lastVoiceMatchWordIndex = 0
  voiceDebugSeq = 0
  lastVoiceMissLogAt = 0
}

function findExpectedMatch(transcript, evt = {}) {
  const seq = ++voiceDebugSeq
  const spoken = tokenize(transcript).slice(-12)
  if (spoken.length < 2 || !voiceWords.length) return null
  const cursorBefore = voiceWordCursor
  const recentlyMatched = lastVoiceMatchAt && performance.now() - lastVoiceMatchAt < 3500
  const searchBack = recentlyMatched ? 3 : 8
  const lookAhead = recentlyMatched
    ? Math.max(16, spoken.length + 12)
    : Math.max(90, spoken.length + 36)
  const N = spoken.length
  const best = window.voiceMatch.findBestMatch(voiceWords, spoken, voiceWordCursor, {
    searchBack,
    lookAhead
  })
  if (!best) {
    const now = performance.now()
    if (evt.isFinal || now - lastVoiceMissLogAt > 900) {
      lastVoiceMissLogAt = now
      voiceDebug('match-miss', {
        seq, isFinal: !!evt.isFinal, speechFinal: !!evt.speechFinal,
        cursorBefore, searchBack, lookAhead,
        spokenTail: spoken.join(' '),
        expectedNearCursor: voiceWordWindow(cursorBefore)
      })
    }
    return null
  }
  const matchedIdx = best.matchedIndex
  const matchedEnd = voiceWords[matchedIdx]
  if (!matchedEnd) return null
  if (matchedIdx + 1 < voiceWordCursor) return null
  const advance = matchedIdx + 1 - cursorBefore
  const confidence = best.confidence || best.score / Math.max(1, N)
  const bigJump = recentlyMatched && advance >= 9
  const riskyJump = recentlyMatched && advance >= 5 && confidence < 0.68
  const weakBigJump = bigJump && (confidence < 0.85 || best.score < 8)
  if (weakBigJump || riskyJump) return null
  return {
    charPos: matchedEnd.end,
    wordIndex: matchedIdx + 1,
    confidence
  }
}

function emitVoiceScroll(match) {
  if (!match || match.charPos == null) return
  const now = performance.now()
  const nextWordIndex = Math.max(voiceWordCursor, match.wordIndex || 0)
  if (lastVoiceMatchAt && nextWordIndex > lastVoiceMatchWordIndex) {
    const elapsed = (now - lastVoiceMatchAt) / 1000
    if (elapsed >= 0.12 && elapsed <= 3) {
      const observed = (nextWordIndex - lastVoiceMatchWordIndex) / elapsed
      const clamped = clamp(observed, 0.9, 6.5)
      voiceWordsPerSecond = voiceWordsPerSecond * 0.72 + clamped * 0.28
    }
  }
  lastVoiceMatchAt = now
  lastVoiceMatchWordIndex = nextWordIndex
  voiceCursorChar = match.charPos
  voiceWordCursor = nextWordIndex
  window.cue.voiceScroll({
    charPos: match.charPos,
    wordIndex: voiceWordCursor,
    wordsPerSecond: voiceWordsPerSecond,
    confidence: match.confidence || 0
  })
}

function downsampleTo16k(input, sourceRate) {
  if (sourceRate === VOICE_SAMPLE_RATE) return input
  const ratio = sourceRate / VOICE_SAMPLE_RATE
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += input[j]
      count++
    }
    output[i] = count ? sum / count : input[start] || 0
  }
  return output
}

function floatToPcm16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

function renderVoiceTranscript() {
  if (!voiceTranscriptEl) return
  voiceTranscriptEl.innerHTML =
    escapeHtml(voiceFinalText.trim().slice(-300)) +
    ' <span class="partial">' +
    escapeHtml(voiceInterimText.trim()) +
    '</span>'
}

async function startRecognition() {
  if (voiceActive) return
  const ok = await window.cue.voiceStart()
  if (!ok) return

  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (voiceAudioCtx.state === 'suspended') await voiceAudioCtx.resume()
    voiceSource = voiceAudioCtx.createMediaStreamSource(voiceStream)
    voiceProcessor = voiceAudioCtx.createScriptProcessor(4096, 1, 1)
    voiceSilence = voiceAudioCtx.createGain()
    voiceSilence.gain.value = 0
    voiceProcessor.onaudioprocess = (e) => {
      if (!voiceActive) return
      const input = e.inputBuffer.getChannelData(0)
      const downsampled = downsampleTo16k(input, voiceAudioCtx.sampleRate)
      window.cue.voiceAudio(floatToPcm16(downsampled))
    }
    voiceSource.connect(voiceProcessor)
    voiceProcessor.connect(voiceSilence)
    voiceSilence.connect(voiceAudioCtx.destination)

    voiceActive = true
    if (voiceTranscriptEl) voiceTranscriptEl.classList.add('active')
    window.cue.voiceState({ active: true })
  } catch (err) {
    setVoiceStatus('mic error')
    if (voiceTranscriptEl) voiceTranscriptEl.textContent = err && err.message ? err.message : 'Microphone failed.'
    stopRecognition()
  }
}

function stopRecognition() {
  voiceActive = false
  setVoiceStatus('off')
  if (voiceTranscriptEl) voiceTranscriptEl.classList.remove('active')
  if (voiceProcessor) {
    try { voiceProcessor.disconnect() } catch {}
    voiceProcessor.onaudioprocess = null
    voiceProcessor = null
  }
  if (voiceSource) { try { voiceSource.disconnect() } catch {}; voiceSource = null }
  if (voiceSilence) { try { voiceSilence.disconnect() } catch {}; voiceSilence = null }
  if (voiceStream) {
    for (const track of voiceStream.getTracks()) track.stop()
    voiceStream = null
  }
  if (voiceAudioCtx) { try { voiceAudioCtx.close() } catch {}; voiceAudioCtx = null }
  window.cue.voiceStop()
  window.cue.voiceState({ active: false })
}

window.cue.onVoiceStatus((evt) => {
  if (!evt) return
  if (evt.status === 'error') {
    setVoiceStatus('error')
    if (evt.detail && voiceTranscriptEl) voiceTranscriptEl.textContent = evt.detail
  } else {
    setVoiceStatus(evt.status || 'off')
  }
})

window.cue.onVoiceTranscript((evt) => {
  if (!evt || !evt.transcript) return
  if (evt.isFinal) {
    voiceFinalText += ' ' + evt.transcript
    voiceInterimText = ''
  } else {
    voiceInterimText = evt.transcript
  }
  renderVoiceTranscript()
  const target = findExpectedMatch(evt.transcript, evt)
  if (target != null) emitVoiceScroll(target)
})

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', async () => {
    if (voiceActive) {
      stopRecognition()
      voiceToggleBtn.textContent = '🎙 Start Listening'
      voiceToggleBtn.classList.add('primary')
    } else {
      await startRecognition()
      if (!voiceActive) return
      voiceToggleBtn.textContent = '⏹ Stop Listening'
      voiceToggleBtn.classList.remove('primary')
    }
  })
}

if (voiceClearBtn) {
  voiceClearBtn.addEventListener('click', () => {
    voiceFinalText = ''
    voiceInterimText = ''
    voiceCursorChar = 0
    voiceWordCursor = 0
    voiceWordsPerSecond = 2.4
    lastVoiceMatchAt = 0
    lastVoiceMatchWordIndex = 0
    if (voiceTranscriptEl) voiceTranscriptEl.innerHTML = '—'
  })
}

// ---------- fullscreen toggle ----------

const fsBtn = $('fs-btn')
let isFullscreen = false

function setFsLabel(active) {
  isFullscreen = !!active
  if (!fsBtn) return
  fsBtn.textContent = active ? '⛶ Exit' : '⛶ Full'
  fsBtn.classList.toggle('active', !!active)
}

if (fsBtn) {
  fsBtn.addEventListener('click', () => { window.cue.toggleFullscreen() })
}

window.cue.onFullscreenState((active) => { setFsLabel(active) })

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault()
    window.cue.toggleFullscreen()
  } else if (e.key === 'Escape') {
    if (!panelModal.hidden) {
      e.preventDefault()
      hidePanelModal()
    } else if (isFullscreen) {
      e.preventDefault()
      window.cue.toggleFullscreen(false)
    }
  }
})

// ---------- overlay visibility toggle ----------

const overlayToggleBtn = $('overlay-toggle')

function setOverlayLabel(visible) {
  if (!overlayToggleBtn) return
  overlayToggleBtn.textContent = visible ? '👁 Overlay On' : '👁 Overlay Off'
  overlayToggleBtn.classList.toggle('active', !!visible)
  if (lcdOverlay) lcdOverlay.classList.toggle('on', !!visible)
}

if (overlayToggleBtn) {
  overlayToggleBtn.addEventListener('click', () => { window.cue.toggleOverlay() })
}

window.cue.onOverlayVisibility((visible) => { setOverlayLabel(visible) })

// ---------- focus mode ----------

if (focusBtn) {
  focusBtn.addEventListener('click', () => {
    state.focus = !state.focus
    applyFocusMode()
    saveState()
  })
}

// ---------- production: analytics consent + diagnostics ----------

function initProductionUI() {
  const consentEl = $('analytics-consent')
  const modal = $('consent-modal')

  function applyConsent(value, opts = {}) {
    state.analytics = !!value
    if (opts.ask) state.analyticsAsked = true
    if (consentEl) consentEl.checked = state.analytics
    window.cue.setAnalyticsConsent(state.analytics)
    saveState()
  }

  window.cue.setAnalyticsConsent(!!state.analytics)
  if (consentEl) {
    consentEl.checked = !!state.analytics
    consentEl.addEventListener('change', () => applyConsent(consentEl.checked))
  }

  if (!state.analyticsAsked && modal) {
    modal.hidden = false
    const accept = $('consent-accept')
    const decline = $('consent-decline')
    if (accept) {
      accept.addEventListener('click', () => {
        applyConsent(true, { ask: true })
        modal.hidden = true
      })
    }
    if (decline) {
      decline.addEventListener('click', () => {
        applyConsent(false, { ask: true })
        modal.hidden = true
      })
    }
  }

  window.addEventListener('error', (e) => {
    try { window.cue.reportError({ name: e && e.error && e.error.name }) } catch {}
  })
  window.addEventListener('unhandledrejection', (e) => {
    try { window.cue.reportError({ name: e && e.reason && e.reason.name }) } catch {}
  })
}

// ---------- panel modal (driven by app menu) ----------

const PANEL_TITLES = {
  library: 'Library',
  sessions: 'Sessions',
  'capture-status': 'Capture Protection',
  remote: 'Remote / QR',
  shortcuts: 'Keyboard Shortcuts'
}

function showPanelModal(panel) {
  if (!panelModal || !panelBody || !panelTemplatesEl) return
  const tpl = panelTemplatesEl.querySelector(`[data-panel="${panel}"]`)
  if (!tpl) return
  panelBody.innerHTML = ''
  // clone children so the template stays intact
  for (const node of Array.from(tpl.children)) {
    panelBody.appendChild(node.cloneNode(true))
  }
  panelTitle.textContent = PANEL_TITLES[panel] || 'Panel'
  panelModal.hidden = false
  panelModal.dataset.panel = panel

  // wire up panel-specific content
  if (panel === 'library') {
    wireLibraryPanel()
    refreshLib()
  } else if (panel === 'sessions') {
    refreshSessions()
  } else if (panel === 'capture-status') {
    wireCapturePanel()
    populatePlatform()
  } else if (panel === 'remote') {
    renderRemotePanel()
  }
}

function hidePanelModal() {
  if (!panelModal) return
  panelModal.hidden = true
  panelModal.dataset.panel = ''
}

if (panelCloseBtn) panelCloseBtn.addEventListener('click', hidePanelModal)
if (panelModal) {
  panelModal.addEventListener('click', (e) => {
    if (e.target === panelModal) hidePanelModal()
  })
}

function wireLibraryPanel() {
  const libNewBtn = $('lib-new')
  const libLoadFileBtn = $('lib-load-file')
  const libSnapshotBtn = $('lib-snapshot')
  const libVersionsBtn = $('lib-versions')

  if (libNewBtn) {
    libNewBtn.addEventListener('click', async () => {
      await createNewScript()
      hidePanelModal()
    })
  }
  if (libLoadFileBtn) {
    libLoadFileBtn.addEventListener('click', () => fileInput.click())
  }
  if (libSnapshotBtn) {
    libSnapshotBtn.disabled = !dbStatus.connected || !state.activeScriptId
    libSnapshotBtn.addEventListener('click', async () => {
      if (!dbStatus.connected || !state.activeScriptId) return
      try {
        await window.cue.scriptsSnapshot(state.activeScriptId)
        const orig = libSnapshotBtn.textContent
        libSnapshotBtn.textContent = '✓ Saved'
        setTimeout(() => { libSnapshotBtn.textContent = orig }, 1200)
      } catch (err) {
        alert('Snapshot failed: ' + (err && err.message))
      }
    })
  }
  if (libVersionsBtn) {
    libVersionsBtn.disabled = !dbStatus.connected || !state.activeScriptId
    libVersionsBtn.addEventListener('click', async () => {
      if (!dbStatus.connected || !state.activeScriptId) return
      try {
        const v = await window.cue.scriptsVersions(state.activeScriptId)
        if (!v.length) { alert('No version snapshots yet.'); return }
        const choices = v.map((x, i) => `${i + 1}. ${new Date(x.savedAt).toLocaleString()}`).join('\n')
        const ans = prompt(`Versions:\n${choices}\n\nEnter number to restore (cancel to keep current):`)
        const idx = parseInt(ans, 10)
        if (!isFinite(idx) || idx < 1 || idx > v.length) return
        if (!confirm(`Restore version from ${new Date(v[idx - 1].savedAt).toLocaleString()}? Current text will be replaced.`)) return
        await window.cue.scriptsRestore(state.activeScriptId, v[idx - 1].id)
        await openScript(state.activeScriptId)
      } catch (err) {
        alert('Versions failed: ' + (err && err.message))
      }
    })
  }
}

function wireCapturePanel() {
  const captureTestBtn = $('capture-test')
  if (captureTestBtn) {
    captureTestBtn.addEventListener('click', () => window.cue.testCapture())
  }
}

function dispatchPanelAction(action) {
  if (!action) return
  if (action === 'new-script') return createNewScript()
  if (action === 'import-file') return fileInput.click()
  if (action === 'about') {
    // 'about' is handled by the main process menu via createInfoWindow.
    // From the in-window navbar we relay via showPanel('about').
    if (window.cue && window.cue.openAbout) window.cue.openAbout()
    return
  }
  showPanelModal(action)
}

const remoteConnectBtn = $('remote-connect-btn')
if (remoteConnectBtn) {
  remoteConnectBtn.addEventListener('click', () => showPanelModal('remote'))
}

window.cue.onShowPanel((panel) => dispatchPanelAction(panel))

// ---------- in-window navbar (File / View / Help) ----------

const navbarEl = $('app-navbar')

function closeAllNavDropdowns() {
  if (!navbarEl) return
  navbarEl.querySelectorAll('[data-nav-dropdown]').forEach((dd) => { dd.hidden = true })
  navbarEl.querySelectorAll('[data-nav-toggle]').forEach((btn) => btn.classList.remove('open'))
}

if (navbarEl) {
  navbarEl.querySelectorAll('[data-nav-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const key = btn.dataset.navToggle
      const dd = navbarEl.querySelector(`[data-nav-dropdown="${key}"]`)
      if (!dd) return
      const opening = dd.hidden
      closeAllNavDropdowns()
      if (opening) {
        dd.hidden = false
        btn.classList.add('open')
      }
    })
  })

  navbarEl.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      closeAllNavDropdowns()
      const action = item.dataset.action
      dispatchPanelAction(action)
    })
  })

  document.addEventListener('click', () => closeAllNavDropdowns())
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllNavDropdowns()
  })
}

// ---------- bootstrap ----------

loadState()
applyAll()
initCollapsibles()
applyFocusMode()
populatePlatform()
loadRemoteInfo()
refreshAiStatus()
initProductionUI()
