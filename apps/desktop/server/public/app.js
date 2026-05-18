const params = new URLSearchParams(window.location.search)
const token = params.get('t') || ''

const $ = (id) => document.getElementById(id)

const remoteEl = $('remote')
const led = $('led')
const lcdStatus = $('lcd-status')
const lcdSpeed = $('lcd-speed')
const lcdFont = $('lcd-font')
const lcdOpacity = $('lcd-opacity')

const playBtn = $('play')
const playIcon = $('play-icon')
const resetBtn = $('reset')
const themeBtn = $('theme-toggle')
const themeIcon = $('theme-icon')
const themeLabel = $('theme-label')

const speedDown = $('speed-down')
const speedUp = $('speed-up')
const speedReadout = $('speed-readout')
const speedFill = $('speed-fill')

const fontDown = $('font-down')
const fontUp = $('font-up')
const fontReadout = $('font-readout')
const fontFill = $('font-fill')

const opacityEl = $('opacity')
const opacityReadout = $('opacity-readout')

const uploadBtn = $('upload-image')
const clearImageBtn = $('clear-image')
const imageFile = $('image-file')
const imagePreview = $('image-preview')
const imageThumb = $('image-thumb')
const imageReadout = $('image-readout')
const referenceFocusBtn = $('reference-focus')
const referenceFocusLabel = $('reference-focus-label')
const referencePrevBtn = $('reference-prev')
const referenceNextBtn = $('reference-next')

const toast = $('toast')

const cueCountReadout = $('cue-count-readout')
const chapterSelect = $('chapter-select')
const mirrorRow = $('mirror-row')
const jumpPrevBtn = $('jump-prev')
const jumpNextBtn = $('jump-next')
const stumbleBtn = $('stumble')
const countdownBtn = $('countdown')

let ws = null
let reconnectTimer = null
let reconnectAttempts = 0
let opacityCommitTimer = null
let connected = false

const state = {
  playing: false,
  speed: 3,
  font: 32,
  opacity: 80,
  theme: 'dark',
  mirror: 'none',
  referenceCount: 0,
  activeReferenceIndex: -1,
  activeReferenceName: '',
  referenceFocus: false,
  cueCount: 0,
  chapters: [],
  markers: []
}

const localImage = {
  present: false,
  name: ''
}

function setStatus(text, klass) {
  lcdStatus.textContent = text
  lcdStatus.className = 'lcd-status ' + (klass || '')
  led.className = 'led ' + (klass || '')
  connected = klass === 'connected'
  remoteEl.classList.toggle('disconnected', !connected)
}

function showToast(text, ok) {
  toast.textContent = text
  toast.className = 'toast show' + (ok ? ' ok' : '')
  clearTimeout(showToast._t)
  showToast._t = setTimeout(() => {
    toast.className = 'toast'
  }, 1600)
}

function renderState() {
  if (state.playing) {
    playBtn.classList.remove('paused')
    playBtn.setAttribute('data-mode', 'pause')
    playIcon.textContent = '⏸'
  } else {
    playBtn.classList.add('paused')
    playBtn.setAttribute('data-mode', 'play')
    playIcon.textContent = '▶'
  }

  speedReadout.textContent = String(state.speed)
  lcdSpeed.textContent = String(state.speed)
  speedFill.style.width = `${((state.speed - 1) / 9) * 100}%`

  fontReadout.textContent = `${state.font} px`
  lcdFont.textContent = `${state.font}`
  fontFill.style.width = `${((state.font - 16) / (96 - 16)) * 100}%`

  if (document.activeElement !== opacityEl) {
    opacityEl.value = String(state.opacity)
  }
  opacityReadout.textContent = `${state.opacity}%`
  lcdOpacity.textContent = `${state.opacity}`

  themeIcon.textContent = state.theme === 'light' ? '☀' : '☾'
  themeLabel.textContent = state.theme === 'light' ? 'LIGHT' : 'DARK'

  cueCountReadout.textContent = String(state.cueCount || 0)
  for (const btn of mirrorRow.querySelectorAll('[data-mirror]')) {
    btn.classList.toggle('active', btn.dataset.mirror === state.mirror)
  }

  const refCount = Number(state.referenceCount) || 0
  const refIndex = Number(state.activeReferenceIndex)
  imageReadout.textContent = refCount
    ? `${Number.isFinite(refIndex) && refIndex >= 0 ? refIndex + 1 : 1}/${refCount}`
    : '—'
  referenceFocusLabel.textContent = state.referenceFocus ? 'MIN' : 'FOCUS'
  referenceFocusBtn.disabled = refCount === 0
  referencePrevBtn.disabled = refCount <= 1
  referenceNextBtn.disabled = refCount <= 1
  clearImageBtn.disabled = refCount === 0
}

function renderChapters() {
  if (!chapterSelect) return
  const chapters = state.chapters || []
  const previous = chapterSelect.value
  chapterSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = chapters.length
    ? '— jump to chapter —'
    : 'No chapters yet'
  chapterSelect.appendChild(placeholder)
  for (const ch of chapters) {
    const opt = document.createElement('option')
    opt.value = ch.id
    opt.textContent = ch.title || 'Untitled'
    chapterSelect.appendChild(opt)
  }
  chapterSelect.disabled = chapters.length === 0
  chapterSelect.value = previous || ''
}

function send(cmd, value) {
  if (!ws || ws.readyState !== 1) {
    showToast('Disconnected — reconnecting…')
    return false
  }
  try {
    ws.send(JSON.stringify(value === undefined ? { cmd } : { cmd, value }))
    return true
  } catch (e) {
    showToast('Send failed')
    return false
  }
}

function connect() {
  if (!token) {
    setStatus('NO TOKEN — RESCAN QR', 'error')
    return
  }
  setStatus('CONNECTING…', '')
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/?t=${encodeURIComponent(token)}`

  let socket
  try {
    socket = new WebSocket(url)
  } catch {
    scheduleReconnect()
    return
  }
  ws = socket

  socket.onopen = () => {
    reconnectAttempts = 0
    setStatus('CONNECTED', 'connected')
    send('get-state')
  }

  socket.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    if (!msg) return
    if (msg.type === 'state' && msg.payload) {
      Object.assign(state, msg.payload)
      renderState()
    } else if (msg.type === 'cues' && msg.payload) {
      state.chapters = msg.payload.chapters || []
      state.markers = msg.payload.markers || []
      state.cueCount = state.markers.length
      cueCountReadout.textContent = String(state.cueCount)
      renderChapters()
    } else if (msg.type === 'marker-hit' && msg.payload) {
      // chapter pulse no longer needed (chapters now in a dropdown); reactions removed
    } else if (msg.type === 'image') {
      const url = msg.payload
      if (url && typeof url === 'string') {
        imageThumb.src = url
        imagePreview.classList.add('has-image')
        imageReadout.textContent = 'set'
        localImage.present = true
      } else {
        imageThumb.removeAttribute('src')
        imagePreview.classList.remove('has-image')
        imageReadout.textContent = '—'
        localImage.present = false
        localImage.name = ''
      }
    } else if (msg.type === 'reference' && msg.payload) {
      const payload = msg.payload
      Object.assign(state, {
        referenceCount: payload.referenceCount || 0,
        activeReferenceIndex: payload.activeReferenceIndex == null ? -1 : payload.activeReferenceIndex,
        activeReferenceName: payload.activeReferenceName || '',
        referenceFocus: !!payload.referenceFocus
      })
      const active = payload.active
      if (active && active.dataUrl) {
        imageThumb.src = active.dataUrl
        imagePreview.classList.add('has-image')
        imageReadout.textContent = `${state.activeReferenceIndex + 1}/${state.referenceCount}`
        localImage.present = true
        localImage.name = active.name || ''
      } else {
        imageThumb.removeAttribute('src')
        imagePreview.classList.remove('has-image')
        imageReadout.textContent = '—'
        localImage.present = false
        localImage.name = ''
      }
      renderState()
    }
  }

  socket.onclose = () => {
    if (ws === socket) ws = null
    setStatus('DISCONNECTED', 'error')
    scheduleReconnect()
  }

  socket.onerror = () => {
    setStatus('CONNECTION ERROR', 'error')
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(8000, 800 * Math.pow(1.5, reconnectAttempts))
  reconnectAttempts++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function bumpSpeed(delta) {
  const next = Math.min(10, Math.max(1, state.speed + delta))
  if (next === state.speed) return
  state.speed = next
  renderState()
  send('speed:set', next)
}

function bumpFont(delta) {
  const next = Math.min(96, Math.max(16, state.font + delta))
  if (next === state.font) return
  state.font = next
  renderState()
  send('font:set', next)
}

playBtn.addEventListener('click', () => {
  state.playing = !state.playing
  renderState()
  if (!send('toggle')) {
    state.playing = !state.playing
    renderState()
  }
})

resetBtn.addEventListener('click', () => {
  state.playing = false
  renderState()
  send('reset')
})

themeBtn.addEventListener('click', () => {
  const next = state.theme === 'light' ? 'dark' : 'light'
  state.theme = next
  renderState()
  if (!send('theme:set', next)) {
    state.theme = state.theme === 'light' ? 'dark' : 'light'
    renderState()
  }
})

speedDown.addEventListener('click', () => bumpSpeed(-1))
speedUp.addEventListener('click', () => bumpSpeed(1))
fontDown.addEventListener('click', () => bumpFont(-2))
fontUp.addEventListener('click', () => bumpFont(2))

opacityEl.addEventListener('input', () => {
  const v = Number(opacityEl.value)
  state.opacity = v
  opacityReadout.textContent = `${v}%`
  lcdOpacity.textContent = `${v}`
  if (opacityCommitTimer) clearTimeout(opacityCommitTimer)
  opacityCommitTimer = setTimeout(() => {
    send('opacity:set', v)
  }, 50)
})

uploadBtn.addEventListener('click', () => imageFile.click())

imageFile.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'))
  if (!files.length) {
    showToast('Not an image')
    imageFile.value = ''
    return
  }
  if (files.some((file) => file.size > 4 * 1024 * 1024)) {
    showToast('Image too large (max 4MB)')
    imageFile.value = ''
    return
  }
  let added = 0
  files.forEach((file, idx) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      imageThumb.src = dataUrl
      imagePreview.classList.add('has-image')
      localImage.present = true
      localImage.name = file.name
      if (send('reference:add', {
        id: `remote-ref-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'image',
        name: file.name,
        dataUrl
      })) {
        added++
        showToast(added === files.length ? 'Images added' : 'Image added', true)
      }
    }
    reader.onerror = () => showToast('Read failed')
    reader.readAsDataURL(file)
  })
  imageFile.value = ''
})

clearImageBtn.addEventListener('click', () => {
  imageThumb.removeAttribute('src')
  imagePreview.classList.remove('has-image')
  imageReadout.textContent = '—'
  localImage.present = false
  localImage.name = ''
  send('references:clear')
})

referenceFocusBtn.addEventListener('click', () => {
  state.referenceFocus = !state.referenceFocus
  renderState()
  send('reference:toggle-focus')
})

referencePrevBtn.addEventListener('click', () => send('reference:prev'))
referenceNextBtn.addEventListener('click', () => send('reference:next'))

// ---------- cue / reaction / mirror handlers ----------

jumpPrevBtn.addEventListener('click', () => send('jump:prev'))
jumpNextBtn.addEventListener('click', () => send('jump:next'))
stumbleBtn.addEventListener('click', () => {
  if (send('stumble')) {
    showToast('Stumble bookmarked', true)
  }
})
countdownBtn.addEventListener('click', () => {
  if (send('countdown', 3)) {
    showToast('3…2…1', true)
  }
})

for (const btn of mirrorRow.querySelectorAll('[data-mirror]')) {
  btn.addEventListener('click', () => {
    const m = btn.getAttribute('data-mirror')
    if (!m) return
    state.mirror = m
    for (const b of mirrorRow.querySelectorAll('[data-mirror]')) {
      b.classList.toggle('active', b === btn)
    }
    send('mirror', m)
  })
}

if (chapterSelect) {
  chapterSelect.addEventListener('change', () => {
    const id = chapterSelect.value
    if (!id) return
    send('jump:chapter', id)
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!ws || ws.readyState !== 1)) {
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connect()
  }
})

// ---------- fullscreen toggle ----------
const fsRemoteBtn = $('fs-remote-btn')
function syncFsLabel() {
  const active = !!document.fullscreenElement
  if (!fsRemoteBtn) return
  fsRemoteBtn.textContent = active ? '⛶ EXIT' : '⛶ FULL'
  fsRemoteBtn.classList.toggle('active', active)
}
if (fsRemoteBtn) {
  fsRemoteBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // some mobile browsers (notably iOS Safari) reject — silently ignore
    }
  })
  document.addEventListener('fullscreenchange', syncFsLabel)
}

renderState()
connect()
