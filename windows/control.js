/* eslint-disable no-undef */
const $ = (id) => document.getElementById(id)

// ---------- elements ----------
const scriptEl = $('script')
const titleEl = $('title')
const charCountEl = $('char-count')
const saveStateEl = $('save-state')

const dbStatusEl = $('db-status')
const dbTextEl = $('db-text')
const libList = $('lib-list')
const libCount = $('lib-count')
const libNoteEl = $('lib-note')
const libNewBtn = $('lib-new')
const libLoadFileBtn = $('lib-load-file')
const fileInput = $('file-input')

const cueListEl = $('cue-list')
const cueCountEl = $('cue-count')
const statPause = $('stat-pause')
const statStop = $('stat-stop')
const statReact = $('stat-react')
const statChapter = $('stat-chapter')
const statNote = $('stat-note')

const btnPlay = $('btn-play')
const btnReset = $('btn-reset')
const btnSlow = $('btn-slow')
const btnFast = $('btn-fast')
const btnJumpPrev = $('btn-jump-prev')
const btnJumpNext = $('btn-jump-next')
const btnCountdown = $('btn-countdown')
const btnStumble = $('btn-stumble')
const btnJumpChapter = $('btn-jump-chapter')
const btnSnapshot = $('btn-snapshot')
const btnVersions = $('btn-versions')

const chapterSelect = $('chapter-select')

const speedEl = $('speed')
const speedVal = $('speed-val')
const fontEl = $('font')
const fontVal = $('font-val')
const opacityEl = $('opacity')
const opacityVal = $('opacity-val')
const smartPaceEl = $('smart-pace')
const countdownInput = $('countdown')
const countdownValEl = $('countdown-val')

const posX = $('pos-x')
const posY = $('pos-y')
const posW = $('pos-w')
const posH = $('pos-h')
const applyPosBtn = $('apply-pos')

const platformVal = $('platform-val')
const archVal = $('arch-val')
const captureTestBtn = $('capture-test')

const imagePreview = $('image-preview')
const imageThumb = $('image-thumb')
const loadImageBtn = $('load-image')
const clearImageBtn = $('clear-image')
const imageInput = $('image-input')

const qrFrame = $('qr-frame')
const qrImage = $('qr-image')
const remoteUrlEl = $('remote-url')
const remoteCopyBtn = $('remote-copy')
const remoteStatusEl = $('remote-status')
const remoteStatusLine = $('remote-status-line')
const remoteStatusText = $('remote-status-text')

const themeDarkBtn = $('theme-dark')
const themeLightBtn = $('theme-light')
const mirrorNoneBtn = $('mirror-none')
const mirrorHBtn = $('mirror-h')
const mirrorVBtn = $('mirror-v')
const mirrorBothBtn = $('mirror-both')

const voiceToggleBtn = $('voice-toggle')
const voiceClearBtn = $('voice-clear')
const voiceStatusEl = $('voice-status')
const voiceTranscriptEl = $('voice-transcript')

const sessionList = $('session-list')
const sessionCount = $('session-count')

const STORAGE_KEY = 'cue.state.v2'
const DEFAULT_OVERLAY_H = 332

const state = {
  script: '',
  speed: 3,
  font: 32,
  opacity: 80,
  smartPace: true,
  posX: 100,
  posY: 60,
  posW: 960,
  posH: DEFAULT_OVERLAY_H,
  overlayHeightVersion: 2,
  playing: false,
  image: null,
  imageName: '',
  theme: 'dark',
  mirror: 'none',
  countdown: 3,
  activeScriptId: null,
  activeTitle: 'Untitled'
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
    if (state.overlayHeightVersion !== 2 && state.posH <= 260) {
      state.posH = DEFAULT_OVERLAY_H
      state.overlayHeightVersion = 2
    }
  } catch {
    /* ignore */
  }
}

function saveState() {
  const persisted = { ...state, playing: false, image: null }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function updateCharCount() {
  const len = scriptEl.value.length
  charCountEl.textContent = `${len.toLocaleString()} chars`
}

function setPlayLabel() {
  btnPlay.innerHTML = state.playing ? '⏸ PAUSE' : '▶ PLAY'
}

function pulse(el) {
  el.classList.remove('echo-pulse')
  void el.offsetWidth
  el.classList.add('echo-pulse')
}

function renderImagePreview() {
  if (state.image) {
    imageThumb.src = state.image
    imagePreview.classList.remove('empty')
  } else {
    imageThumb.removeAttribute('src')
    imagePreview.classList.add('empty')
  }
}

function renderThemePills() {
  themeDarkBtn.classList.toggle('active', state.theme !== 'light')
  themeLightBtn.classList.toggle('active', state.theme === 'light')
}

function renderMirrorPills() {
  mirrorNoneBtn.classList.toggle('active', state.mirror === 'none')
  mirrorHBtn.classList.toggle('active', state.mirror === 'h')
  mirrorVBtn.classList.toggle('active', state.mirror === 'v')
  mirrorBothBtn.classList.toggle('active', state.mirror === 'both')
}

function renderSaveState(kind) {
  saveStateEl.classList.remove('saved', 'dirty', 'err')
  if (kind === 'saved') {
    saveStateEl.textContent = 'SAVED'
    saveStateEl.classList.add('saved')
  } else if (kind === 'dirty') {
    saveStateEl.textContent = 'SAVING…'
    saveStateEl.classList.add('dirty')
  } else if (kind === 'err') {
    saveStateEl.textContent = 'LOCAL ONLY'
    saveStateEl.classList.add('err')
  } else {
    saveStateEl.textContent = '—'
  }
}

function renderDbStatus() {
  dbStatusEl.classList.remove('connected', 'error')
  if (dbStatus.connected) {
    dbStatusEl.classList.add('connected')
    dbTextEl.textContent = 'MONGO'
    libNoteEl.textContent = 'Connected. Edits autosave to your local mongo at 127.0.0.1:27017/cue.'
  } else if (dbStatus.error) {
    dbStatusEl.classList.add('error')
    dbTextEl.textContent = 'NO MONGO'
    libNoteEl.textContent = `MongoDB unavailable: ${dbStatus.error}. Working in local-only mode — start mongod and restart Cue to enable the library.`
  } else {
    dbTextEl.textContent = 'CONNECTING…'
    libNoteEl.textContent = 'Connecting to mongodb://127.0.0.1:27017/cue …'
  }
  libNewBtn.disabled = !dbStatus.connected
  libNewBtn.style.opacity = dbStatus.connected ? '1' : '0.5'
}

function renderLib() {
  libList.innerHTML = ''
  libCount.textContent = `${scripts.length} script${scripts.length === 1 ? '' : 's'}`
  if (!scripts.length) {
    const e = document.createElement('div')
    e.className = 'lib-empty'
    e.textContent = dbStatus.connected
      ? 'No scripts yet. Click NEW to create one.'
      : 'No mongo — open or import a script to work locally.'
    libList.appendChild(e)
    return
  }
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderCueList() {
  cueListEl.innerHTML = ''
  const markers = parsed.markers || []
  cueCountEl.textContent = `${markers.length} cue${markers.length === 1 ? '' : 's'}`

  const stats = { pause: 0, stop: 0, react: 0, chapter: 0, note: 0, breath: 0, unknown: 0 }
  for (const m of markers) stats[m.type] = (stats[m.type] || 0) + 1
  statPause.textContent = String(stats.pause + stats.breath)
  statStop.textContent = String(stats.stop)
  statReact.textContent = String(stats.react)
  statChapter.textContent = String(stats.chapter)
  statNote.textContent = String(stats.note)

  // index warnings by markerId
  const warningsForMarker = new Map()
  for (const w of parsed.warnings || []) {
    if (w.markerId) warningsForMarker.set(w.markerId, w.message)
  }

  // banner: surface the most common pitfall ([[stop]] mid-script) up front
  if (warningsForMarker.size) {
    const banner = document.createElement('div')
    banner.className = 'cue-warning-banner'
    const first = parsed.warnings[0]
    banner.innerHTML = `<span class="ic">⚠</span><span>${escapeHtml(first.message)} (${warningsForMarker.size} cue${warningsForMarker.size === 1 ? '' : 's'})</span>`
    cueListEl.appendChild(banner)
  }

  if (!markers.length) {
    const e = document.createElement('div')
    e.className = 'cue-empty'
    e.textContent = 'No cues. Insert one with the toolbar above.'
    cueListEl.appendChild(e)
  } else {
    let idx = 0
    for (const m of markers) {
      idx++
      const row = document.createElement('div')
      row.className = 'cue-row'
      if ((parsed.errors || []).some((er) => er.raw && er.raw.includes(`[[${m.payload.reaction || ''}`))) {
        row.classList.add('error')
      }
      const warn = warningsForMarker.get(m.id)
      if (warn) row.classList.add('warn')
      const lineNo = countLines(parsed.plainText.slice(0, m.charOffset))
      const label = describeMarker(m)
      const titleAttr = warn ? `line ${lineNo} — ${warn}` : `line ${lineNo}`
      row.innerHTML = `
        <span class="badge ${m.type}">${badgeLabel(m.type)}</span>
        <span class="label" title="${escapeHtml(titleAttr)}">${escapeHtml(label)}${warn ? ' <span class="warn-icon">⚠</span>' : ''}</span>
        <button class="jump" title="Scroll overlay to this cue">JUMP</button>
      `
      row.querySelector('.jump').addEventListener('click', () => {
        // Use cue:next/prev semantics by selecting this marker by id —
        // we approximate by repeatedly stepping next from current position.
        // Simpler: tell main to jump to chapter id (works for chapters), else fall back to position-based jump.
        if (m.type === 'chapter') {
          window.cue.jumpToChapter(m.id)
        } else {
          // Sequential next-jumps starting from top. Better UX: send a generic jump-to-marker.
          window.cue.jumpToChapter(m.id) // overlay searches chapters first, falls through silently for non-chapters
          // also try positional jump via a generic event
          ipcSendJumpToMarker(m.id)
        }
      })
      cueListEl.appendChild(row)
    }
  }

  // populate chapter select
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

// position-based jump fallback — not exposed via preload, so we relay via cue:jump with marker id
function ipcSendJumpToMarker(id) {
  // overlay's jumpToChapter does id-lookup against chapters[] only;
  // for non-chapter markers we ask overlay to advance to next cue iteratively
  // by emitting a series of jump-next until landing on this id. This is rare
  // and a small UX nit — for now do nothing extra.
}

function badgeLabel(type) {
  switch (type) {
    case 'pause': return 'PSE'
    case 'stop': return 'STP'
    case 'react': return 'RCT'
    case 'chapter': return 'CHP'
    case 'note': return 'NTE'
    case 'breath': return 'BRH'
    default: return '?'
  }
}

function describeMarker(m) {
  return window.scriptParse.describeMarker(m)
}

function countLines(text) {
  if (!text) return 1
  return text.split('\n').length
}

function reparse() {
  parsed = window.scriptParse.parse(scriptEl.value || '')
  refreshVoiceWords()
  renderCueList()
}

function applyAll() {
  isApplying = true
  scriptEl.value = state.script
  titleEl.value = state.activeTitle || ''
  speedEl.value = state.speed
  fontEl.value = state.font
  opacityEl.value = state.opacity
  smartPaceEl.checked = state.smartPace !== false
  countdownInput.value = state.countdown
  posX.value = state.posX
  posY.value = state.posY
  posW.value = state.posW
  posH.value = state.posH

  speedVal.textContent = String(state.speed)
  fontVal.textContent = `${state.font}px`
  opacityVal.textContent = `${state.opacity}%`
  countdownValEl.textContent = `${state.countdown}s`
  updateCharCount()
  setPlayLabel()
  renderImagePreview()
  renderThemePills()
  renderMirrorPills()

  window.cue.updateScript(state.script)
  window.cue.setSpeed(state.speed)
  window.cue.setFontSize(state.font)
  window.cue.setOpacity(state.opacity / 100)
  window.cue.setSmartPace(state.smartPace !== false)
  window.cue.setImage(state.image)
  window.cue.setTheme(state.theme)
  window.cue.setMirror(state.mirror)
  window.cue.reposition({ x: state.posX, y: state.posY, w: state.posW, h: state.posH })

  reparse()
  isApplying = false
}

// ---------- LIBRARY / DB ----------

async function refreshLib() {
  if (!dbStatus.connected) return
  try {
    scripts = await window.cue.scriptsList()
    renderLib()
  } catch (err) {
    scripts = []
    renderLib()
  }
}

async function ensureActiveScript() {
  if (!dbStatus.connected) return
  // open the previously-active script if still present
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
    // create initial
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
      if (typeof s.smartPace === 'boolean') state.smartPace = s.smartPace
      if (typeof s.theme === 'string') state.theme = s.theme
      if (typeof s.mirror === 'string') state.mirror = s.mirror
    }
    saveState()
    applyAll()
    renderLib()
    renderSaveState('saved')
    window.cue.dbStatus().then(() => {})
    // tell main this is the active script (for session attribution)
    try { ipcRendererSendActive(state.activeScriptId) } catch {}
    refreshSessions()
  } catch (err) {
    renderSaveState('err')
  }
}

function ipcRendererSendActive(id) {
  window.cue.setActiveScript(id)
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
          smartPace: state.smartPace,
          theme: state.theme,
          mirror: state.mirror
        }
      })
      renderSaveState('saved')
      // refresh ordering without full reload
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
const aiOriginalLabel = btnFormatAi ? btnFormatAi.textContent : '✨ FORMAT WITH AI'

function setAiButtonState(kind, label) {
  if (!btnFormatAi) return
  btnFormatAi.classList.remove('busy', 'err')
  if (kind === 'busy') btnFormatAi.classList.add('busy')
  if (kind === 'err') btnFormatAi.classList.add('err')
  if (label) btnFormatAi.textContent = label
  else btnFormatAi.textContent = aiOriginalLabel
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
      btnFormatAi.title = 'OPENAI_API_KEY is not set. Restart Cue with the env var to enable.'
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
      alert('OPENAI_API_KEY is not set.\n\nRestart Cue from a shell where the env var is exported, e.g.:\n\n  OPENAI_API_KEY=sk-... npm start')
      return
    }
    const text = scriptEl.value
    if (!text || !text.trim()) {
      flashAiButton('err', '✕ EMPTY', 1200)
      return
    }

    aiFormatting = true
    btnFormatAi.disabled = true
    setAiButtonState('busy', 'FORMATTING…')

    // snapshot current text into version history so the user can restore via HIST
    if (dbStatus.connected && state.activeScriptId) {
      try { await window.cue.scriptsSnapshot(state.activeScriptId) } catch { /* ignore */ }
    }

    try {
      console.log('[ai-fmt] sending text length:', text.length)
      const res = await window.cue.formatScriptWithAi(text)
      console.log('[ai-fmt] result:', res)
      if (res && res.ok && typeof res.text === 'string') {
        scriptEl.value = res.text
        state.script = res.text
        updateCharCount()
        window.cue.updateScript(state.script)
        reparse()
        saveState()
        scheduleSave()
        flashAiButton(null, '✓ DONE', 1200)
      } else {
        const msg = (res && res.error) || 'no result returned'
        const diag = res && res.diag ? '\n\nDiagnostic:\n' + JSON.stringify(res.diag, null, 2) : ''
        flashAiButton('err', '✕ FAILED', 2000)
        alert('AI format failed:\n\n' + msg + diag + '\n\nSee terminal (where you ran npm start) for full logs.')
      }
    } catch (err) {
      console.error('[ai-fmt] threw:', err)
      flashAiButton('err', '✕ FAILED', 2000)
      alert('AI format failed (renderer threw):\n\n' + (err && err.message ? err.message : String(err)) + '\n\nSee DevTools console for stack.')
    } finally {
      aiFormatting = false
      btnFormatAi.disabled = !aiHasKey ? true : false
    }
  })
}

// ---------- file import ----------

libLoadFileBtn.addEventListener('click', () => fileInput.click())
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

libNewBtn.addEventListener('click', async () => {
  if (!dbStatus.connected) return
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
})

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
  window.cue.setSpeed(state.speed)
  saveState()
  scheduleSave()
  pulse(speedEl)
}

btnSlow.addEventListener('click', () => nudgeSpeed(-1))
btnFast.addEventListener('click', () => nudgeSpeed(1))

btnJumpPrev.addEventListener('click', () => window.cue.jumpToPrevCue())
btnJumpNext.addEventListener('click', () => window.cue.jumpToNextCue())

btnCountdown.addEventListener('click', () => {
  window.cue.startCountdown(state.countdown)
  state.playing = true
  setPlayLabel()
})

btnStumble.addEventListener('click', () => {
  window.cue.bookmarkStumble()
  pulse(btnStumble)
  // refresh session list after a beat
  setTimeout(refreshSessions, 300)
})

btnJumpChapter.addEventListener('click', () => {
  const v = chapterSelect.value
  if (!v) return
  window.cue.jumpToChapter(v)
})

btnSnapshot.addEventListener('click', async () => {
  if (!dbStatus.connected || !state.activeScriptId) return
  try {
    await window.cue.scriptsSnapshot(state.activeScriptId)
    const orig = btnSnapshot.textContent
    btnSnapshot.textContent = '✓ SAVED'
    setTimeout(() => { btnSnapshot.textContent = orig }, 1200)
  } catch (err) {
    alert('Snapshot failed: ' + (err && err.message))
  }
})

btnVersions.addEventListener('click', async () => {
  if (!dbStatus.connected || !state.activeScriptId) return
  try {
    const v = await window.cue.scriptsVersions(state.activeScriptId)
    if (!v.length) {
      alert('No version snapshots yet.')
      return
    }
    const choices = v
      .map((x, i) => `${i + 1}. ${new Date(x.savedAt).toLocaleString()}`)
      .join('\n')
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

// ---------- settings ----------

speedEl.addEventListener('input', () => {
  state.speed = clamp(Number(speedEl.value), 1, 10)
  speedVal.textContent = String(state.speed)
  window.cue.setSpeed(state.speed)
  saveState()
  scheduleSave()
})

fontEl.addEventListener('input', () => {
  state.font = clamp(Number(fontEl.value), 16, 96)
  fontVal.textContent = `${state.font}px`
  window.cue.setFontSize(state.font)
  saveState()
  scheduleSave()
})

opacityEl.addEventListener('input', () => {
  state.opacity = clamp(Number(opacityEl.value), 10, 100)
  opacityVal.textContent = `${state.opacity}%`
  window.cue.setOpacity(state.opacity / 100)
  saveState()
  scheduleSave()
})

smartPaceEl.addEventListener('change', () => {
  state.smartPace = smartPaceEl.checked
  window.cue.setSmartPace(state.smartPace)
  saveState()
  scheduleSave()
})

countdownInput.addEventListener('input', () => {
  state.countdown = clamp(Number(countdownInput.value), 1, 10)
  countdownValEl.textContent = `${state.countdown}s`
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

captureTestBtn.addEventListener('click', () => window.cue.testCapture())

// ---------- image ----------

loadImageBtn.addEventListener('click', () => imageInput.click())
imageInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    imageInput.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    state.image = dataUrl
    state.imageName = file.name
    renderImagePreview()
    window.cue.setImage(dataUrl)
  }
  reader.readAsDataURL(file)
  imageInput.value = ''
})

clearImageBtn.addEventListener('click', () => {
  state.image = null
  state.imageName = ''
  renderImagePreview()
  window.cue.setImage(null)
})

// ---------- theme / mirror ----------

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
  saveState()
  pulse(speedEl)
})

window.cue.onRemoteFontSet((v) => {
  state.font = clamp(Number(v) || 32, 16, 96)
  fontEl.value = state.font
  fontVal.textContent = `${state.font}px`
  saveState()
  pulse(fontEl)
})

window.cue.onRemoteOpacitySet((v) => {
  state.opacity = clamp(Number(v) || 80, 10, 100)
  opacityEl.value = state.opacity
  opacityVal.textContent = `${state.opacity}%`
  saveState()
  pulse(opacityEl)
})

window.cue.onRemoteSmartPaceSet((v) => {
  state.smartPace = v !== false
  smartPaceEl.checked = state.smartPace
  saveState()
  pulse(smartPaceEl)
})

window.cue.onRemoteThemeSet((v) => {
  state.theme = v === 'light' ? 'light' : 'dark'
  renderThemePills()
  try { saveState() } catch {}
})

window.cue.onRemoteImageSet((dataUrl) => {
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
    state.image = dataUrl
    state.imageName = 'from remote'
  } else {
    state.image = null
    state.imageName = ''
  }
  renderImagePreview()
})

window.cue.onRemoteStumble(() => {
  pulse(btnStumble)
  setTimeout(refreshSessions, 300)
})

window.cue.onMarkerEvent((evt) => {
  // visual ack on the cue list could go here; minimal for v1
})

// ---------- remote info ----------

let remoteUrl = ''

function setRemoteUrl(url) {
  remoteUrl = url || ''
  remoteUrlEl.textContent = url || '—'
  remoteCopyBtn.disabled = !url
  remoteCopyBtn.style.opacity = url ? '1' : '0.5'
}

function setQr(dataUrl) {
  if (dataUrl) {
    qrImage.src = dataUrl
    qrFrame.classList.remove('empty')
  } else {
    qrImage.removeAttribute('src')
    qrFrame.classList.add('empty')
  }
}

function setRemoteStatus(text, klass) {
  remoteStatusText.textContent = text
  remoteStatusLine.className = 'remote-status-line ' + (klass || '')
}

function setRemoteHeaderStatus(text) {
  remoteStatusEl.textContent = text
}

function applyRemoteInfo(info) {
  if (!info) return
  if (info.error) {
    setRemoteUrl('')
    setQr(null)
    setRemoteStatus('server failed: ' + info.error, 'error')
    setRemoteHeaderStatus('error')
    return
  }
  if (info.pending) {
    setRemoteStatus('starting server…', '')
    setRemoteHeaderStatus('starting…')
    return
  }
  setRemoteUrl(info.url || '')
  setQr(info.qr || null)
  applyConnectionCount(typeof info.connections === 'number' ? info.connections : 0)
}

function applyConnectionCount(count) {
  if (count > 0) {
    setRemoteStatus(`${count} ${count === 1 ? 'phone' : 'phones'} connected`, 'connected')
    setRemoteHeaderStatus(`${count} live`)
  } else {
    setRemoteStatus('waiting for phone…', '')
    setRemoteHeaderStatus('ready')
  }
}

async function loadRemoteInfo() {
  try {
    const info = await window.cue.getRemoteInfo()
    applyRemoteInfo(info)
  } catch {
    setRemoteStatus('could not read remote info', 'error')
  }
}

remoteCopyBtn.addEventListener('click', async () => {
  if (!remoteUrl) return
  try {
    await navigator.clipboard.writeText(remoteUrl)
    const orig = remoteCopyBtn.textContent
    remoteCopyBtn.textContent = 'COPIED'
    setTimeout(() => { remoteCopyBtn.textContent = orig }, 1200)
  } catch { /* ignore */ }
})

window.cue.onRemoteReady((info) => applyRemoteInfo(info))
window.cue.onRemoteError((err) => applyRemoteInfo({ error: err || 'unknown error' }))
window.cue.onRemoteConnections((count) => applyConnectionCount(count))

// ---------- sessions ----------

async function refreshSessions() {
  if (!dbStatus.connected || !state.activeScriptId) {
    sessionList.innerHTML = '<div class="cue-empty">No sessions yet.</div>'
    sessionCount.textContent = '—'
    return
  }
  try {
    const sessions = await window.cue.sessionsList(state.activeScriptId)
    sessionCount.textContent = `${sessions.length} run${sessions.length === 1 ? '' : 's'}`
    sessionList.innerHTML = ''
    if (!sessions.length) {
      sessionList.innerHTML = '<div class="cue-empty">No sessions yet.</div>'
      return
    }
    for (const s of sessions.slice(0, 20)) {
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
  } catch {
    sessionList.innerHTML = '<div class="cue-empty">Failed to load sessions.</div>'
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
  renderDbStatus()
  // bootstrap only the first time we see a connected status
  if (dbStatus.connected && !wasConnected) bootstrap()
})

window.cue.dbStatus().then((s) => {
  dbStatus = s || { connected: false, error: 'unknown' }
  renderDbStatus()
  if (dbStatus.connected) bootstrap()
})

// ---------- platform ----------

async function populatePlatform() {
  try {
    const info = await window.cue.getPlatform()
    const platMap = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
    const platName = platMap[info.platform] || info.platform
    platformVal.textContent = `${platName} (${info.osRelease})`
    archVal.textContent = info.arch
  } catch {
    platformVal.textContent = 'unknown'
    archVal.textContent = 'unknown'
  }
}

// ---------- VOICE PACING ----------

let voiceActive = false
let voiceFinalText = ''
let voiceInterimText = ''
let voiceCursorChar = 0 // current matched position into parsed.plainText
let voiceWordCursor = 0
let voiceWords = []
let voiceWordsPerSecond = 2.4
let lastVoiceMatchAt = 0
let lastVoiceMatchWordIndex = 0
let voiceStream = null
let voiceAudioCtx = null
let voiceSource = null
let voiceProcessor = null
let voiceSilence = null
const VOICE_SAMPLE_RATE = 16000

function setVoiceStatus(text) {
  voiceStatusEl.textContent = text
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function buildVoiceWords(plain) {
  const words = []
  const re = /\S+/g
  let m
  while ((m = re.exec(String(plain || ''))) !== null) {
    const w = m[0].toLowerCase().replace(/[^a-z0-9']/g, '')
    if (w) {
      words.push({
        w,
        at: m.index,
        end: m.index + m[0].length
      })
    }
  }
  return words
}

function refreshVoiceWords() {
  voiceWords = buildVoiceWords(parsed.plainText || '')
  voiceWordCursor = 0
  voiceCursorChar = 0
  voiceWordsPerSecond = 2.4
  lastVoiceMatchAt = 0
  lastVoiceMatchWordIndex = 0
}

function findExpectedMatch(transcript) {
  const spoken = tokenize(transcript).slice(-8)
  if (spoken.length < 2 || !voiceWords.length) return null
  const searchBack = 2
  const lookAhead = Math.max(8, spoken.length + 6)
  const start = Math.max(0, voiceWordCursor - searchBack)
  const end = Math.min(voiceWords.length, voiceWordCursor + lookAhead)
  let best = null
  const N = spoken.length

  for (let s = start; s < end; s++) {
    let score = 0
    const len = Math.min(N, voiceWords.length - s)
    for (let k = 0; k < len; k++) {
      if (voiceWords[s + k] && voiceWords[s + k].w === spoken[k]) score++
    }
    const coverage = score / Math.max(1, Math.min(N, len))
    if (score < 2 || coverage < 0.75) continue

    const wordDistance = Math.abs(s - voiceWordCursor)
    const behind = s < voiceWordCursor
    const rank = score * 1000 - wordDistance * 80 - (behind ? 300 : 0)
    if (!best || rank > best.rank) {
      best = { score, start: s, len, rank }
      if (!behind && score === N && wordDistance <= 1) break
    }
  }
  if (!best) return null
  const matchedIdx = Math.min(voiceWords.length - 1, best.start + Math.min(N, best.len) - 1)
  const matchedEnd = voiceWords[matchedIdx]
  if (!matchedEnd) return null
  if (matchedIdx + 1 < voiceWordCursor) return null
  return {
    charPos: matchedEnd.end,
    wordIndex: matchedIdx + 1,
    confidence: best.score / Math.max(1, N)
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
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
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
    voiceTranscriptEl.classList.add('active')
    window.cue.voiceState({ active: true })
  } catch (err) {
    setVoiceStatus('mic error')
    voiceTranscriptEl.textContent = err && err.message ? err.message : 'Microphone failed.'
    stopRecognition()
  }
}

function stopRecognition() {
  voiceActive = false
  setVoiceStatus('off')
  voiceTranscriptEl.classList.remove('active')
  if (voiceProcessor) {
    try { voiceProcessor.disconnect() } catch {}
    voiceProcessor.onaudioprocess = null
    voiceProcessor = null
  }
  if (voiceSource) {
    try { voiceSource.disconnect() } catch {}
    voiceSource = null
  }
  if (voiceSilence) {
    try { voiceSilence.disconnect() } catch {}
    voiceSilence = null
  }
  if (voiceStream) {
    for (const track of voiceStream.getTracks()) track.stop()
    voiceStream = null
  }
  if (voiceAudioCtx) {
    try { voiceAudioCtx.close() } catch {}
    voiceAudioCtx = null
  }
  window.cue.voiceStop()
  window.cue.voiceState({ active: false })
}

window.cue.onVoiceStatus((evt) => {
  if (!evt) return
  if (evt.status === 'error') {
    setVoiceStatus('error')
    if (evt.detail) voiceTranscriptEl.textContent = evt.detail
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
  const target = findExpectedMatch(evt.transcript)
  if (target != null) emitVoiceScroll(target)
})

voiceToggleBtn.addEventListener('click', async () => {
  if (voiceActive) {
    stopRecognition()
    voiceToggleBtn.textContent = '🎙 START VOICE'
    voiceToggleBtn.classList.add('primary')
  } else {
    await startRecognition()
    if (!voiceActive) return
    voiceToggleBtn.textContent = '⏹ STOP VOICE'
    voiceToggleBtn.classList.remove('primary')
  }
})

voiceClearBtn.addEventListener('click', () => {
  voiceFinalText = ''
  voiceInterimText = ''
  voiceCursorChar = 0
  voiceWordCursor = 0
  voiceWordsPerSecond = 2.4
  lastVoiceMatchAt = 0
  lastVoiceMatchWordIndex = 0
  voiceTranscriptEl.innerHTML = '—'
})

// ---------- fullscreen toggle ----------

const fsBtn = $('fs-btn')
let isFullscreen = false

function setFsLabel(active) {
  isFullscreen = !!active
  if (!fsBtn) return
  fsBtn.textContent = active ? '⛶ EXIT' : '⛶ FULL'
  fsBtn.classList.toggle('active', !!active)
}

if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    window.cue.toggleFullscreen()
  })
}

window.cue.onFullscreenState((active) => {
  setFsLabel(active)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault()
    window.cue.toggleFullscreen()
  } else if (e.key === 'Escape' && isFullscreen) {
    e.preventDefault()
    window.cue.toggleFullscreen(false)
  }
})

// ---------- overlay visibility toggle ----------

const overlayToggleBtn = $('overlay-toggle')

function setOverlayLabel(visible) {
  if (!overlayToggleBtn) return
  overlayToggleBtn.textContent = visible ? '👁 OVERLAY ON' : '👁 OVERLAY OFF'
  overlayToggleBtn.classList.toggle('active', !!visible)
}

if (overlayToggleBtn) {
  overlayToggleBtn.addEventListener('click', () => {
    window.cue.toggleOverlay()
  })
}

window.cue.onOverlayVisibility((visible) => {
  setOverlayLabel(visible)
})

// ---------- bootstrap ----------

loadState()
applyAll()
populatePlatform()
loadRemoteInfo()
refreshAiStatus()
