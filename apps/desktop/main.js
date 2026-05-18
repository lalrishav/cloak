const { app, BrowserWindow, Menu, ipcMain, globalShortcut, screen, dialog, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const WebSocket = require('ws')
const QRCode = require('qrcode')
const server = require('./server')
const scriptParse = require('./lib/script-parse')
const aiFormat = require('./lib/ai-format')
const db = require('./lib/db')
const installIdLib = require('./lib/install-id')
const bootGate = require('./lib/boot-gate')
const { createEventQueue } = require('./lib/event-queue')

const DEFAULT_OVERLAY_W = 960
const DEFAULT_OVERLAY_H = 460
const FOCUS_OVERLAY_MIN_H = 460
const FOCUS_OVERLAY_EXTRA_H = 150

let overlayWin = null
let controlWin = null
let remoteInfo = null
let remoteQrDataUrl = null
let remoteError = null

const remoteState = {
  speed: 3,
  font: 32,
  opacity: 80,
  playing: false,
  smartPace: true,
  theme: 'dark',
  hasImage: false,
  referenceCount: 0,
  activeReferenceId: null,
  activeReferenceName: '',
  activeReferenceIndex: -1,
  referenceFocus: false,
  mirror: 'none',
  chapters: [],
  markers: [],
  cueCount: 0
}

let currentImage = null
let references = []
let activeReferenceId = null
let referenceFocus = false
let unfocusedOverlayBounds = null
let currentScriptText = ''
let currentParsed = scriptParse.parse('')
let dbStatus = { connected: false, error: null }
let activeSession = null
let activeSessionStartedAt = null
let activeScriptId = null

// --- production: install id, version gate, telemetry ---
let installId = null
let bootInfo = null
let eventQueue = null
let analyticsConsent = false
let telemetrySessionId = null
let telemetrySessionStartedAt = null
let voiceState = { active: false }
let deepgramWs = null
let deepgramReady = false
let deepgramKeepAlive = null

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function makeReferenceId() {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeReference(ref) {
  if (!ref || typeof ref !== 'object') return null
  const dataUrl = typeof ref.dataUrl === 'string' ? ref.dataUrl : ''
  if (!dataUrl.startsWith('data:image/')) return null
  return {
    id: String(ref.id || makeReferenceId()),
    type: 'image',
    name: String(ref.name || 'Reference image').slice(0, 120),
    dataUrl
  }
}

function activeReferenceIndex() {
  return references.findIndex((ref) => ref.id === activeReferenceId)
}

function activeReference() {
  const idx = activeReferenceIndex()
  return idx >= 0 ? references[idx] : null
}

function referencePayload(includeData = true) {
  const active = activeReference()
  const index = active ? activeReferenceIndex() : -1
  return {
    references: references.map((ref) => ({
      id: ref.id,
      type: ref.type,
      name: ref.name,
      ...(includeData ? { dataUrl: ref.dataUrl } : {})
    })),
    activeReferenceId,
    activeReferenceIndex: index,
    activeReferenceName: active ? active.name : '',
    referenceCount: references.length,
    referenceFocus,
    active: active
      ? {
          id: active.id,
          type: active.type,
          name: active.name,
          dataUrl: includeData ? active.dataUrl : undefined
        }
      : null
  }
}

function syncReferenceMeta() {
  const active = activeReference()
  const index = active ? activeReferenceIndex() : -1
  currentImage = active ? active.dataUrl : null
  remoteState.hasImage = !!currentImage
  remoteState.referenceCount = references.length
  remoteState.activeReferenceId = active ? active.id : null
  remoteState.activeReferenceName = active ? active.name : ''
  remoteState.activeReferenceIndex = index
  remoteState.referenceFocus = referenceFocus
}

function emitReferenceState(opts = {}) {
  syncReferenceMeta()
  const fullPayload = referencePayload(true)
  const remotePayload = referencePayload(false)
  if (remotePayload.active && currentImage) {
    remotePayload.active.dataUrl = currentImage
  }
  sendToOverlay('reference:set', fullPayload)
  // Keep old single-image remotes functional while the new tray rolls out.
  if (opts.notifyControl !== false) sendToControl('remote:reference-set', fullPayload)
  if (opts.notifyControl !== false) sendToControl('remote:image-set', currentImage)
  broadcastRemoteState()
  try {
    server.broadcast({ type: 'reference', payload: remotePayload })
    server.broadcast({ type: 'image', payload: currentImage })
  } catch { /* server not up */ }
}

function applyReferenceWindowMode(focused) {
  if (!overlayWin || overlayWin.isDestroyed()) return
  if (focused) {
    if (!unfocusedOverlayBounds) unfocusedOverlayBounds = overlayWin.getBounds()
    const current = overlayWin.getBounds()
    const display = screen.getDisplayMatching(current)
    const area = display.workArea
    const targetHeight = Math.min(
      area.height,
      Math.max(FOCUS_OVERLAY_MIN_H, unfocusedOverlayBounds.height + FOCUS_OVERLAY_EXTRA_H)
    )
    const targetY = Math.max(area.y, Math.min(current.y, area.y + area.height - targetHeight))
    overlayWin.setBounds({
      x: current.x,
      y: targetY,
      width: current.width,
      height: Math.round(targetHeight)
    })
    return
  }

  if (unfocusedOverlayBounds) {
    overlayWin.setBounds(unfocusedOverlayBounds)
    unfocusedOverlayBounds = null
  }
}

function sendToOverlay(channel, payload) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send(channel, payload)
  }
}

function sendToControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send(channel, payload)
  }
}

function readLocalEnv(name) {
  if (process.env[name]) return process.env[name]
  const envPaths = []
  try {
    envPaths.push(path.join(app.getPath('userData'), '.env'))
  } catch {
    /* app path unavailable early in startup */
  }
  envPaths.push(path.join(__dirname, '.env'))

  for (const envPath of envPaths) {
    try {
      const text = fs.readFileSync(envPath, 'utf8')
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx < 1) continue
        const key = trimmed.slice(0, idx).trim()
        if (key !== name) continue
        return trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      }
    } catch {
      /* no local env at this path */
    }
  }
  return ''
}

function sendVoiceStatus(status, detail) {
  sendToControl('voice:status', { status, detail: detail || '' })
}

function broadcastRemoteState() {
  try {
    server.broadcast({ type: 'state', payload: { ...remoteState } })
  } catch {
    // server may not be up
  }
}

function broadcastCues() {
  try {
    server.broadcast({
      type: 'cues',
      payload: {
        chapters: currentParsed.chapters || [],
        markers: (currentParsed.markers || []).map((m) => ({
          id: m.id,
          type: m.type,
          charOffset: m.charOffset,
          payload: m.payload,
          label: scriptParse.describeMarker(m)
        }))
      }
    })
  } catch {
    /* ignore */
  }
}

function applyOverlayProtection() {
  if (!overlayWin || overlayWin.isDestroyed()) return
  overlayWin.setContentProtection(true)
  overlayWin.setIgnoreMouseEvents(true, { forward: true })
  overlayWin.setAlwaysOnTop(true, 'screen-saver', 1)
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.platform === 'darwin') {
    overlayWin.setFullScreenable(false)
    overlayWin.setHiddenInMissionControl(true)
    overlayWin.setWindowButtonVisibility(false)
  }
  overlayWin.moveTop()
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay()
  const { width: screenW } = display.workAreaSize

  overlayWin = new BrowserWindow({
    width: DEFAULT_OVERLAY_W,
    height: DEFAULT_OVERLAY_H,
    x: Math.round((screenW - DEFAULT_OVERLAY_W) / 2),
    y: 60,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    resizable: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  applyOverlayProtection()

  overlayWin.once('ready-to-show', () => {
    applyOverlayProtection()
    // Overlay starts hidden — user toggles it via button or shortcut.
  })

  overlayWin.webContents.on('did-finish-load', () => {
    applyOverlayProtection()
    // initial paint of any cached state
    pushScriptToOverlay()
    sendToOverlay('speed:set', remoteState.speed)
    sendToOverlay('font:set', remoteState.font)
    sendToOverlay('pace:smart', remoteState.smartPace)
    sendToOverlay('theme:set', remoteState.theme)
    emitReferenceState({ notifyControl: false })
    if (remoteState.mirror && remoteState.mirror !== 'none') {
      sendToOverlay('overlay:mirror', remoteState.mirror)
    }
  })

  overlayWin.on('show', () => {
    applyOverlayProtection()
    sendToControl('control:overlay-visibility', true)
  })

  overlayWin.on('hide', () => {
    sendToControl('control:overlay-visibility', false)
  })

  overlayWin.loadFile(path.join(__dirname, 'windows', 'overlay.html'))

  overlayWin.on('closed', () => {
    overlayWin = null
    sendToControl('control:overlay-visibility', false)
  })
}

function applyOverlayVisibility(force) {
  if (!overlayWin || overlayWin.isDestroyed()) return false
  const next = typeof force === 'boolean' ? force : !overlayWin.isVisible()
  if (next) {
    overlayWin.showInactive()
    applyOverlayProtection()
    overlayWin.moveTop()
  } else {
    overlayWin.hide()
  }
  return next
}

let infoWin = null

function createInfoWindow() {
  if (infoWin && !infoWin.isDestroyed()) {
    infoWin.focus()
    return
  }
  infoWin = new BrowserWindow({
    width: 520,
    height: 540,
    title: 'About Cloak',
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#0d0d0f',
    parent: controlWin || undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  infoWin.setMenuBarVisibility(false)
  infoWin.loadFile(path.join(__dirname, 'windows', 'info.html'))
  infoWin.on('closed', () => { infoWin = null })
}

function showControlPanel(panel) {
  sendToControl('control:show-panel', panel)
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const template = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: 'About Cloak', click: () => createInfoWindow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Script',
        accelerator: 'CmdOrCtrl+N',
        click: () => showControlPanel('new-script')
      },
      {
        label: 'Library…',
        accelerator: 'CmdOrCtrl+L',
        click: () => showControlPanel('library')
      },
      {
        label: 'Import File…',
        accelerator: 'CmdOrCtrl+O',
        click: () => showControlPanel('import-file')
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  })

  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Sessions',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => showControlPanel('sessions')
      },
      {
        label: 'Capture Protection Status',
        click: () => showControlPanel('capture-status')
      },
      {
        label: 'Remote / QR',
        click: () => showControlPanel('remote')
      },
      {
        label: 'Keyboard Shortcuts',
        click: () => showControlPanel('shortcuts')
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })

  template.push({
    label: 'Window',
    role: 'window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' }
          ]
        : [{ role: 'close' }])
    ]
  })

  template.push({
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'About Cloak / Diagnostics',
        click: () => createInfoWindow()
      }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 720,
    minHeight: 540,
    title: 'Cloak — Teleprompter',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  controlWin.loadFile(path.join(__dirname, 'windows', 'control.html'))

  controlWin.webContents.on('did-finish-load', () => {
    sendToControl('db:status', dbStatus)
    sendToControl('control:fullscreen-state', controlWin.isFullScreen())
    sendToControl(
      'control:overlay-visibility',
      !!(overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible())
    )
  })

  controlWin.on('enter-full-screen', () => {
    sendToControl('control:fullscreen-state', true)
  })
  controlWin.on('leave-full-screen', () => {
    sendToControl('control:fullscreen-state', false)
  })

  controlWin.on('closed', () => {
    controlWin = null
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.close()
    }
  })
}

function pushScriptToOverlay() {
  sendToOverlay('script:update', {
    segments: currentParsed.segments,
    markers: currentParsed.markers,
    chapters: currentParsed.chapters
  })
}

function applyScriptText(text, opts = {}) {
  currentScriptText = String(text == null ? '' : text)
  currentParsed = scriptParse.parse(currentScriptText)
  remoteState.chapters = (currentParsed.chapters || []).map((c) => ({
    id: c.id,
    title: c.title
  }))
  remoteState.markers = (currentParsed.markers || []).map((m) => ({
    id: m.id,
    type: m.type
  }))
  remoteState.cueCount = (currentParsed.markers || []).length
  pushScriptToOverlay()
  if (opts.notifyControl) {
    sendToControl('script:parsed', {
      chapters: currentParsed.chapters,
      markers: currentParsed.markers,
      errors: currentParsed.errors
    })
  }
  broadcastRemoteState()
  broadcastCues()
}

function applySpeed(value, opts = {}) {
  remoteState.speed = clamp(Number(value) || 1, 1, 10)
  sendToOverlay('speed:set', remoteState.speed)
  if (opts.notifyControl !== false) sendToControl('remote:speed-set', remoteState.speed)
  broadcastRemoteState()
  logSessionEvent('speed-change', { speed: remoteState.speed })
}

function applyFont(value, opts = {}) {
  remoteState.font = clamp(Number(value) || 32, 16, 96)
  sendToOverlay('font:set', remoteState.font)
  if (opts.notifyControl !== false) sendToControl('remote:font-set', remoteState.font)
  broadcastRemoteState()
}

function applyOpacity(value, opts = {}) {
  remoteState.opacity = clamp(Number(value) || 80, 10, 100)
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setOpacity(remoteState.opacity / 100)
  }
  if (opts.notifyControl !== false) sendToControl('remote:opacity-set', remoteState.opacity)
  broadcastRemoteState()
}

function applySmartPace(value, opts = {}) {
  remoteState.smartPace = value !== false
  sendToOverlay('pace:smart', remoteState.smartPace)
  if (opts.notifyControl !== false) sendToControl('remote:smart-pace-set', remoteState.smartPace)
  broadcastRemoteState()
}

function applyToggle(opts = {}) {
  remoteState.playing = !remoteState.playing
  sendToOverlay('scroll:toggle')
  if (opts.notifyControl !== false) sendToControl('control:toggle-echo', remoteState.playing)
  broadcastRemoteState()

  if (remoteState.playing) {
    ensureSessionStarted()
    logSessionEvent('play', {})
  } else {
    logSessionEvent('pause', {})
  }
}

function applyReset(opts = {}) {
  remoteState.playing = false
  sendToOverlay('scroll:reset')
  if (opts.notifyControl !== false) sendToControl('control:reset-echo')
  broadcastRemoteState()
  logSessionEvent('reset', {})
}

function applyManualScroll(direction, lines = 3) {
  const dir = Math.sign(Number(direction) || 0)
  if (!dir) return
  sendToOverlay('scroll:nudge', { direction: dir, lines })
}

function applyTheme(value, opts = {}) {
  const theme = value === 'light' ? 'light' : 'dark'
  remoteState.theme = theme
  sendToOverlay('theme:set', theme)
  if (opts.notifyControl !== false) sendToControl('remote:theme-set', theme)
  broadcastRemoteState()
}

function applyImage(value, opts = {}) {
  const valid = typeof value === 'string' && value.startsWith('data:')
  if (valid) {
    applyReferences({
      references: [{
        id: makeReferenceId(),
        type: 'image',
        name: 'Reference image',
        dataUrl: value
      }],
      activeReferenceId: null,
      referenceFocus
    }, opts)
  } else {
    applyReferences({ references: [], activeReferenceId: null, referenceFocus: false }, opts)
  }
}

function applyReferences(payload, opts = {}) {
  const input = Array.isArray(payload) ? { references: payload } : (payload || {})
  const previousFocus = referenceFocus
  const next = Array.isArray(input.references)
    ? input.references.map(normalizeReference).filter(Boolean)
    : []
  references = next
  const requestedId = input.activeReferenceId == null ? null : String(input.activeReferenceId)
  activeReferenceId =
    requestedId && references.some((ref) => ref.id === requestedId)
      ? requestedId
      : (references[0] ? references[0].id : null)
  if (Object.prototype.hasOwnProperty.call(input, 'referenceFocus')) {
    referenceFocus = !!input.referenceFocus && references.length > 0
  } else if (!references.length) {
    referenceFocus = false
  }
  if (referenceFocus !== previousFocus) applyReferenceWindowMode(referenceFocus)
  emitReferenceState(opts)
}

function applyReferenceAdd(ref, opts = {}) {
  const normalized = normalizeReference(ref)
  if (!normalized) return
  references = references.concat(normalized)
  activeReferenceId = normalized.id
  emitReferenceState(opts)
}

function applyReferenceClear(opts = {}) {
  references = []
  activeReferenceId = null
  if (referenceFocus) applyReferenceWindowMode(false)
  referenceFocus = false
  emitReferenceState(opts)
}

function applyReferenceActivate(id, opts = {}) {
  const nextId = String(id || '')
  if (!references.some((ref) => ref.id === nextId)) return
  activeReferenceId = nextId
  emitReferenceState(opts)
}

function applyReferenceStep(delta, opts = {}) {
  if (!references.length) return
  const current = activeReferenceIndex()
  const safeCurrent = current >= 0 ? current : 0
  const next = (safeCurrent + delta + references.length) % references.length
  activeReferenceId = references[next].id
  emitReferenceState(opts)
}

function applyReferenceFocus(value, opts = {}) {
  const nextFocus = references.length > 0 && !!value
  if (nextFocus !== referenceFocus) applyReferenceWindowMode(nextFocus)
  referenceFocus = nextFocus
  emitReferenceState(opts)
}

function applyReferenceFocusToggle(opts = {}) {
  applyReferenceFocus(!referenceFocus, opts)
}

function applyMirror(mode, opts = {}) {
  const valid = ['none', 'h', 'v', 'both']
  const m = valid.includes(mode) ? mode : 'none'
  remoteState.mirror = m
  sendToOverlay('overlay:mirror', m)
  if (opts.notifyControl !== false) sendToControl('remote:mirror-set', m)
  broadcastRemoteState()
}

function applyJump(target, opts = {}) {
  sendToOverlay('cue:jump', target)
  const display =
    target && target.chapter ? `chapter:${target.chapter}` :
    target === 'cue:next' ? 'cue:next' :
    target === 'cue:prev' ? 'cue:prev' :
    'jump'
  logSessionEvent('jump', { target: display })
  sendToControl('remote:jump', target)
}

function applyReaction(data, opts = {}) {
  let payload = data
  if (typeof data === 'string') payload = { reaction: data }
  if (payload && payload.reaction && scriptParse.REACTION_GLYPHS[payload.reaction]) {
    payload.glyph = scriptParse.REACTION_GLYPHS[payload.reaction]
  }
  sendToOverlay('cue:reaction', payload)
  sendToControl('remote:reaction', payload)
  logSessionEvent('reaction-manual', { reaction: payload && payload.reaction })
}

function applyCountdown(seconds, opts = {}) {
  const n = clamp(Number(seconds) || 3, 1, 10)
  sendToOverlay('playback:countdown', n)
  logSessionEvent('countdown', { seconds: n })
}

function closeDeepgram() {
  if (deepgramKeepAlive) {
    clearInterval(deepgramKeepAlive)
    deepgramKeepAlive = null
  }
  deepgramReady = false
  if (deepgramWs) {
    try {
      if (deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(JSON.stringify({ type: 'CloseStream' }))
      }
      deepgramWs.close()
    } catch {
      /* ignore */
    }
    deepgramWs = null
  }
}

// Is the AI proxy enabled for this install? (set via a version policy's
// featureFlags, delivered in the boot response). When on, the desktop fetches
// AI capability from the API so the binary carries zero keys.
function aiProxyEnabled() {
  return !!(bootInfo && bootInfo.features && bootInfo.features.aiProxy)
}

// Fetch the Deepgram key from the AI proxy when aiProxy is on; otherwise fall
// back to the local env var (until the proxy fully rolls out).
async function resolveDeepgramKey() {
  if (aiProxyEnabled()) {
    try {
      const apiUrl = readLocalEnv('CUE_API_URL') || 'http://localhost:8787'
      const res = await fetch(apiUrl.replace(/\/+$/, '') + '/v1/ai/deepgram-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId })
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.ok && data.key) return data.key
      }
    } catch {
      /* fall through to the local key */
    }
  }
  return readLocalEnv('DEEPGRAM_API_KEY')
}

// Proxy an AI-format request through the API (the OpenAI key stays server-side).
async function formatViaProxy(text) {
  try {
    const apiUrl = readLocalEnv('CUE_API_URL') || 'http://localhost:8787'
    const res = await fetch(apiUrl.replace(/\/+$/, '') + '/v1/ai/format', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId, text })
    })
    if (!res.ok) return { ok: false, error: 'AI proxy returned ' + res.status }
    return await res.json()
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'AI proxy unreachable' }
  }
}

async function startDeepgram() {
  const apiKey = await resolveDeepgramKey()
  if (!apiKey) {
    sendVoiceStatus('error', 'No Deepgram key — set DEEPGRAM_API_KEY or enable the aiProxy flag')
    return false
  }

  closeDeepgram()

  const params = new URLSearchParams({
    model: 'nova-3',
    language: readLocalEnv('DEEPGRAM_LANGUAGE') || 'multi',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    endpointing: '300',
    smart_format: 'false'
  })
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` }
  })
  deepgramWs = ws

  ws.on('open', () => {
    if (ws !== deepgramWs) return
    deepgramReady = true
    sendVoiceStatus('listening')
    deepgramKeepAlive = setInterval(() => {
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, 8000)
  })

  ws.on('message', (raw) => {
    if (ws !== deepgramWs) return
    let data
    try {
      data = JSON.parse(String(raw))
    } catch {
      return
    }
    if (data.type !== 'Results') return
    const alt =
      data.channel &&
      data.channel.alternatives &&
      data.channel.alternatives[0]
    const transcript = alt && alt.transcript ? alt.transcript : ''
    if (!transcript.trim()) return
    sendToControl('voice:transcript', {
      transcript,
      isFinal: !!data.is_final,
      speechFinal: !!data.speech_final,
      words: alt.words || []
    })
  })

  ws.on('error', (err) => {
    if (ws !== deepgramWs) return
    sendVoiceStatus('error', err && err.message ? err.message : String(err))
  })

  ws.on('close', () => {
    if (ws !== deepgramWs) return
    deepgramReady = false
    if (deepgramKeepAlive) {
      clearInterval(deepgramKeepAlive)
      deepgramKeepAlive = null
    }
    sendVoiceStatus('off')
  })

  sendVoiceStatus('connecting')
  return true
}

function sendDeepgramAudio(chunk) {
  if (!deepgramReady || !deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) {
    return
  }
  let buffer
  if (Buffer.isBuffer(chunk)) buffer = chunk
  else if (chunk instanceof ArrayBuffer) buffer = Buffer.from(chunk)
  else if (ArrayBuffer.isView(chunk)) {
    buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  } else {
    return
  }
  if (buffer.length) deepgramWs.send(buffer)
}

function applyStumble() {
  logSessionEvent('stumble', {
    speed: remoteState.speed,
    chapterId: currentChapterId()
  })
  sendToControl('session:event', { type: 'stumble', t: Date.now() })
}

function currentChapterId() {
  // returns the chapter id closest to current scroll — approximate via markers list
  // since overlay doesn't echo current scrollY, we just record null here.
  return null
}

// ---------- sessions + telemetry ----------

// Hard whitelist: which payload keys may leave the machine per event type, and
// only as numbers / booleans / short enum-like tokens — never free text from a
// script. Anything not listed here is dropped before an event is queued.
const TELEMETRY_PAYLOAD_WHITELIST = {
  'speed-change': ['speed'],
  countdown: ['seconds'],
  'voice-scroll': ['y'],
  'voice-state': ['active'],
  'cue-hit': ['cueType'],
  stumble: ['speed'],
  error: ['where', 'name'],
  jump: [],
  'reaction-manual': [],
  play: [],
  pause: [],
  reset: []
}
const SAFE_TOKEN = /^[a-z0-9_.-]{1,32}$/i

function sanitizeTelemetryPayload(type, payload) {
  const allowed = TELEMETRY_PAYLOAD_WHITELIST[type]
  if (!allowed || !allowed.length || !payload || typeof payload !== 'object') return {}
  const out = {}
  for (const key of allowed) {
    const v = payload[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (typeof v === 'boolean') out[key] = v
    else if (typeof v === 'string' && SAFE_TOKEN.test(v)) out[key] = v
  }
  return out
}

// Queue one telemetry event for the cloud. No-op unless the user opted in.
// Independent of the optional local Mongo session — telemetry must work even
// when the local db is down.
function enqueueTelemetry(type, payload) {
  if (!analyticsConsent || !eventQueue) return
  const tMs = telemetrySessionStartedAt ? Date.now() - telemetrySessionStartedAt : 0
  eventQueue.enqueue({
    type,
    tMs,
    sessionId: telemetrySessionId || null,
    ts: new Date().toISOString(),
    payload: sanitizeTelemetryPayload(type, payload)
  })
}

async function ensureSessionStarted() {
  // telemetry session — independent of the optional local Mongo db
  if (!telemetrySessionId) {
    telemetrySessionId = crypto.randomUUID()
    telemetrySessionStartedAt = Date.now()
    enqueueTelemetry('session_started', {})
  }
  // local Mongo session (optional — playback works without it)
  if (activeSession || !dbStatus.connected) return
  try {
    const s = await db.startSession({
      scriptId: activeScriptId,
      settingsSnapshot: {
        speed: remoteState.speed,
        font: remoteState.font,
        opacity: remoteState.opacity,
        theme: remoteState.theme,
        mirror: remoteState.mirror
      }
    })
    activeSession = s
    activeSessionStartedAt = Date.now()
    sendToControl('session:event', { type: 'session-start', id: s.id })
  } catch (err) {
    // swallow — playback still works without logging
  }
}

async function endActiveSession() {
  if (telemetrySessionId) {
    enqueueTelemetry('session_ended', {})
    telemetrySessionId = null
    telemetrySessionStartedAt = null
  }
  if (!activeSession) return
  try {
    await db.endSession(activeSession.id)
    sendToControl('session:event', { type: 'session-end', id: activeSession.id })
  } catch { /* ignore */ }
  activeSession = null
  activeSessionStartedAt = null
}

function logSessionEvent(type, payload) {
  // local Mongo (optional)
  if (activeSession && dbStatus.connected) {
    const tMs = activeSessionStartedAt ? Date.now() - activeSessionStartedAt : 0
    db.logEvent(activeSession.id, tMs, type, payload || {}).catch(() => {
      /* ignore */
    })
  }
  // cloud telemetry (consent-gated, independent of the local db)
  enqueueTelemetry(type, payload)
}

// ---------- remote command bridge ----------

function handleRemoteCommand(msg, ws) {
  if (!msg || typeof msg.cmd !== 'string') return
  switch (msg.cmd) {
    case 'get-state':
      broadcastRemoteState()
      broadcastCues()
      if (ws) {
        const remotePayload = referencePayload(false)
        if (remotePayload.active && currentImage) remotePayload.active.dataUrl = currentImage
        server.sendTo(ws, { type: 'reference', payload: remotePayload })
        if (currentImage) server.sendTo(ws, { type: 'image', payload: currentImage })
      }
      return
    case 'toggle':
      applyToggle()
      return
    case 'reset':
      applyReset()
      return
    case 'speed:set':
      applySpeed(msg.value)
      return
    case 'speed:nudge':
      applySpeed(remoteState.speed + (Number(msg.value) || 0))
      return
    case 'font:set':
      applyFont(msg.value)
      return
    case 'font:nudge':
      applyFont(remoteState.font + (Number(msg.value) || 0))
      return
    case 'opacity:set':
      applyOpacity(msg.value)
      return
    case 'pace:smart':
      applySmartPace(msg.value)
      return
    case 'theme:set':
      applyTheme(msg.value)
      return
    case 'theme:toggle':
      applyTheme(remoteState.theme === 'light' ? 'dark' : 'light')
      return
    case 'image:set':
      applyImage(msg.value)
      return
    case 'references:set':
      applyReferences(msg.value)
      return
    case 'reference:add':
      applyReferenceAdd(msg.value)
      return
    case 'references:clear':
      applyReferenceClear()
      return
    case 'reference:activate':
      applyReferenceActivate(msg.value)
      return
    case 'reference:next':
      applyReferenceStep(1)
      return
    case 'reference:prev':
      applyReferenceStep(-1)
      return
    case 'reference:focus':
      applyReferenceFocus(msg.value)
      return
    case 'reference:toggle-focus':
      applyReferenceFocusToggle()
      return
    case 'jump:chapter':
      applyJump({ chapter: msg.value })
      return
    case 'jump:next':
      applyJump('cue:next')
      return
    case 'jump:prev':
      applyJump('cue:prev')
      return
    case 'reaction':
      applyReaction(msg.value)
      return
    case 'mirror':
      applyMirror(msg.value)
      return
    case 'countdown':
      applyCountdown(msg.value || 3)
      return
    case 'stumble':
      applyStumble()
      sendToControl('remote:stumble')
      return
  }
}

function handleConnectionChange(count) {
  sendToControl('remote:connections', count)
}

function registerIpc() {
  ipcMain.on('script:update', (_evt, text) => {
    applyScriptText(text, { notifyControl: true })
  })

  ipcMain.on('scroll:toggle', () => {
    applyToggle({ notifyControl: false })
  })

  ipcMain.on('scroll:reset', () => {
    applyReset({ notifyControl: false })
  })

  ipcMain.on('scroll:nudge', (_evt, data) => {
    applyManualScroll(data && data.direction, data && data.lines)
  })

  ipcMain.on('speed:set', (_evt, v) => {
    applySpeed(v, { notifyControl: false })
  })

  ipcMain.on('font:set', (_evt, v) => {
    applyFont(v, { notifyControl: false })
  })

  ipcMain.on('opacity:set', (_evt, v) => {
    const op = clamp(Number(v) || 1, 0.1, 1.0)
    applyOpacity(Math.round(op * 100), { notifyControl: false })
  })

  ipcMain.on('pace:smart', (_evt, value) => {
    applySmartPace(value, { notifyControl: false })
  })

  ipcMain.on('image:set', (_evt, dataUrl) => {
    applyImage(dataUrl, { notifyControl: false })
  })

  ipcMain.on('references:set', (_evt, payload) => {
    applyReferences(payload, { notifyControl: false })
  })

  ipcMain.on('reference:add', (_evt, ref) => {
    applyReferenceAdd(ref, { notifyControl: false })
  })

  ipcMain.on('references:clear', () => {
    applyReferenceClear({ notifyControl: false })
  })

  ipcMain.on('reference:activate', (_evt, id) => {
    applyReferenceActivate(id)
  })

  ipcMain.on('reference:next', () => {
    applyReferenceStep(1)
  })

  ipcMain.on('reference:prev', () => {
    applyReferenceStep(-1)
  })

  ipcMain.on('reference:focus', (_evt, value) => {
    applyReferenceFocus(value)
  })

  ipcMain.on('reference:toggle-focus', () => {
    applyReferenceFocusToggle()
  })

  ipcMain.on('theme:set', (_evt, value) => {
    applyTheme(value, { notifyControl: false })
  })

  ipcMain.on('overlay:reposition', (_evt, bounds) => {
    if (!overlayWin || overlayWin.isDestroyed()) return
    const next = {
      x: Math.round(Number(bounds.x) || 0),
      y: Math.round(Number(bounds.y) || 0),
      width: Math.round(Math.max(200, Number(bounds.w) || DEFAULT_OVERLAY_W)),
      height: Math.round(Math.max(80, Number(bounds.h) || DEFAULT_OVERLAY_H))
    }
    unfocusedOverlayBounds = referenceFocus ? next : null
    overlayWin.setBounds(next)
  })

  ipcMain.on('overlay:drag-start', () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setIgnoreMouseEvents(false)
    }
  })

  ipcMain.on('overlay:drag-end', () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  ipcMain.on('overlay:drag-move', (_evt, delta) => {
    if (!overlayWin || overlayWin.isDestroyed()) return
    const [x, y] = overlayWin.getPosition()
    overlayWin.setPosition(
      Math.round(x + (Number(delta.dx) || 0)),
      Math.round(y + (Number(delta.dy) || 0))
    )
  })

  ipcMain.on('cue:jump', (_evt, target) => {
    applyJump(target)
  })

  ipcMain.on('cue:reaction', (_evt, data) => {
    applyReaction(data)
  })

  ipcMain.on('overlay:mirror', (_evt, mode) => {
    applyMirror(mode)
  })

  ipcMain.on('playback:countdown', (_evt, seconds) => {
    applyCountdown(seconds)
  })

  ipcMain.on('session:stumble', () => {
    applyStumble()
  })

  ipcMain.on('voice:scroll', (_evt, data) => {
    sendToOverlay('voice:scroll', data)
    logSessionEvent('voice-scroll', { y: data && data.scrollY })
  })

  ipcMain.handle('voice:start', () => startDeepgram())

  ipcMain.on('voice:stop', () => {
    closeDeepgram()
    voiceState = { active: false }
    sendToOverlay('voice:state', voiceState)
    logSessionEvent('voice-state', voiceState)
  })

  ipcMain.on('voice:audio', (_evt, chunk) => {
    sendDeepgramAudio(chunk)
  })

  ipcMain.on('voice:debug', (_evt, payload) => {
    const source = String((payload && payload.source) || 'unknown').replace(/[^a-z0-9:_-]/gi, '')
    const seen = new WeakSet()
    const safe = (value) => {
      if (typeof value === 'string') return value.length > 220 ? value.slice(0, 220) + '...' : value
      if (typeof value !== 'object' || value == null) return value
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
      if (Array.isArray(value)) return value.slice(0, 16).map(safe)
      const out = {}
      for (const [key, val] of Object.entries(value).slice(0, 32)) out[key] = safe(val)
      return out
    }
    try {
      console.log('[voice-debug:' + source + '] ' + JSON.stringify(safe(payload && payload.data)))
    } catch {
      console.log('[voice-debug:' + source + '] <unserializable>')
    }
  })

  ipcMain.on('voice:state', (_evt, s) => {
    voiceState = { active: !!(s && s.active) }
    sendToOverlay('voice:state', voiceState)
    logSessionEvent('voice-state', voiceState)
  })

  ipcMain.on('about:open', () => createInfoWindow())

  ipcMain.on('overlay:marker-event', (_evt, evt) => {
    if (!evt) return
    const data = evt.data || {}
    // Overlay reports its own playback state changes when cues fire / end of script
    if (evt.channel === 'playback-state') {
      const playing = !!(data && data.playing)
      if (remoteState.playing !== playing) {
        remoteState.playing = playing
        sendToControl('control:toggle-echo', playing)
        broadcastRemoteState()
        logSessionEvent(playing ? 'play' : 'pause', { source: 'overlay' })
      }
      return
    }
    sendToControl('overlay:marker-event', evt)
    logSessionEvent('cue-hit', {
      cueType: data.type,
      id: data.id,
      payload: data.payload
    })
    // forward to remote
    try {
      server.broadcast({ type: 'marker-hit', payload: data })
    } catch { /* ignore */ }
  })

  ipcMain.on('capture:test', () => {
    if (!controlWin || controlWin.isDestroyed()) return
    dialog.showMessageBox(controlWin, {
      type: 'info',
      title: 'Recorder Preview Mode',
      message: 'Capture-protection test',
      detail:
        'To verify capture-protection:\n\n' +
        '1) Start a screen recording (QuickTime, OBS, or Zoom share screen).\n' +
        '2) Look at the recording preview — the Cloak overlay should be missing on supported setups.\n' +
        '3) You should still see the overlay on your physical display.\n\n' +
        'Note: macOS Cmd+Shift+5 / Screenshot.app and QuickTime on macOS 14+ use private capture paths that bypass NSWindowSharingNone — they will record the overlay. OBS Display Capture and Zoom screen share generally honor the flag.',
      buttons: ['OK']
    })
  })

  ipcMain.handle('platform:info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      osRelease: require('os').release(),
      electron: process.versions.electron
    }
  })

  ipcMain.handle('ai:status', () => ({
    hasKey: aiProxyEnabled() || !!readLocalEnv('OPENAI_API_KEY'),
    proxy: aiProxyEnabled(),
    model: aiFormat.DEFAULT_MODEL
  }))

  ipcMain.handle('script:format-ai', async (_evt, text) => {
    // proxy path — the API holds the OpenAI key; the desktop still validates
    // the returned text against its own cue parser before applying it
    if (aiProxyEnabled()) {
      const result = await formatViaProxy(text)
      if (result.ok && result.text && !aiFormat.validate(text, result.text)) {
        return { ok: false, error: 'AI changed words — formatting not applied.' }
      }
      return result
    }
    // local-key path (until the aiProxy feature flag fully rolls out)
    const apiKey = readLocalEnv('OPENAI_API_KEY')
    if (!apiKey) {
      return {
        ok: false,
        error:
          'OPENAI_API_KEY is not set. Restart Cloak with the env var, or enable the aiProxy feature flag.'
      }
    }
    const result = await aiFormat.format(text, { apiKey })
    console.log('[main] script:format-ai result: ok=' + result.ok)
    return result
  })

  ipcMain.handle('remote:info', () => {
    if (remoteError) {
      return { error: remoteError }
    }
    if (!remoteInfo) {
      return { pending: true }
    }
    return {
      url: remoteInfo.url,
      ip: remoteInfo.ip,
      port: remoteInfo.port,
      token: remoteInfo.token,
      qr: remoteQrDataUrl,
      connections: server.getConnectionCount()
    }
  })

  // ---------- DB IPC ----------

  ipcMain.handle('db:status', () => ({ ...dbStatus }))

  function requireDb() {
    if (!dbStatus.connected) {
      throw new Error(
        dbStatus.error
          ? `mongo unavailable: ${dbStatus.error}`
          : 'mongo unavailable'
      )
    }
  }

  ipcMain.handle('scripts:list', async () => {
    requireDb()
    return db.listScripts()
  })

  ipcMain.handle('scripts:get', async (_evt, id) => {
    requireDb()
    return db.getScript(id)
  })

  ipcMain.handle('scripts:create', async (_evt, data) => {
    requireDb()
    return db.createScript(data || {})
  })

  ipcMain.handle('scripts:update', async (_evt, { id, data }) => {
    requireDb()
    return db.updateScript(id, data || {})
  })

  ipcMain.handle('scripts:delete', async (_evt, id) => {
    requireDb()
    if (activeScriptId === String(id)) {
      activeScriptId = null
      await endActiveSession()
    }
    return db.deleteScript(id)
  })

  ipcMain.handle('scripts:snapshot', async (_evt, id) => {
    requireDb()
    return db.snapshotScript(id)
  })

  ipcMain.handle('scripts:versions', async (_evt, id) => {
    requireDb()
    return db.listVersions(id)
  })

  ipcMain.handle('scripts:restore', async (_evt, { id, versionId }) => {
    requireDb()
    return db.restoreVersion(id, versionId)
  })

  ipcMain.handle('sessions:list', async (_evt, scriptId) => {
    requireDb()
    return db.listSessions(scriptId)
  })

  ipcMain.handle('sessions:get', async (_evt, id) => {
    requireDb()
    return db.getSession(id)
  })

  // The control panel tells us which script is currently being edited.
  ipcMain.on('script:active', (_evt, id) => {
    if (activeScriptId !== id) {
      endActiveSession()
    }
    activeScriptId = id || null
  })

  ipcMain.on('control:toggle-fullscreen', (_evt, force) => {
    if (!controlWin || controlWin.isDestroyed()) return
    const next = typeof force === 'boolean' ? force : !controlWin.isFullScreen()
    controlWin.setFullScreen(next)
  })

  ipcMain.on('overlay:toggle-visibility', (_evt, force) => {
    applyOverlayVisibility(force)
  })

  // ---------- production: diagnostics + telemetry consent ----------
  ipcMain.handle('diagnostics:get', () => {
    return {
      installId,
      appVersion: app.getVersion(),
      apiUrl: readLocalEnv('CUE_API_URL') || 'http://localhost:8787',
      analyticsConsent,
      boot: bootInfo
        ? {
            status: bootInfo.status,
            allowed: bootInfo.allowed,
            updateRequired: bootInfo.updateRequired,
            killSwitch: bootInfo.killSwitch,
            latestVersion: bootInfo.latestVersion,
            stale: !!bootInfo.stale,
            offline: !!bootInfo.offline,
            cachedStatus: bootInfo.cachedStatus || null,
            cachedMessage: bootInfo.cachedMessage || null
          }
        : null
    }
  })

  ipcMain.on('telemetry:consent', (_evt, value) => {
    analyticsConsent = !!value
  })

  ipcMain.on('telemetry:error', (_evt, info) => {
    enqueueTelemetry('error', { where: 'renderer', name: (info && info.name) || 'Error' })
  })
}

function registerShortcuts() {
  globalShortcut.register('CmdOrCtrl+Shift+Space', () => {
    applyToggle()
  })

  globalShortcut.register('CmdOrCtrl+Shift+R', () => {
    applyReset()
  })

  globalShortcut.register('CmdOrCtrl+Shift+Up', () => {
    applySpeed(remoteState.speed + 1)
  })

  globalShortcut.register('CmdOrCtrl+Shift+Down', () => {
    applySpeed(remoteState.speed - 1)
  })

  globalShortcut.register('CmdOrCtrl+Alt+Up', () => {
    applyManualScroll(-1)
  })

  globalShortcut.register('CmdOrCtrl+Alt+Down', () => {
    applyManualScroll(1)
  })

  globalShortcut.register('CmdOrCtrl+Shift+Right', () => {
    applyJump('cue:next')
  })

  globalShortcut.register('CmdOrCtrl+Shift+Left', () => {
    applyJump('cue:prev')
  })

  globalShortcut.register('CmdOrCtrl+Shift+B', () => {
    applyStumble()
  })

  globalShortcut.register('CmdOrCtrl+Shift+O', () => {
    applyOverlayVisibility()
  })

  globalShortcut.register('CmdOrCtrl+Shift+F', () => {
    applyReferenceFocusToggle()
  })

  globalShortcut.register('CmdOrCtrl+Shift+]', () => {
    applyReferenceStep(1)
  })

  globalShortcut.register('CmdOrCtrl+Shift+[', () => {
    applyReferenceStep(-1)
  })
}

async function startRemoteServer() {
  try {
    remoteInfo = await server.start({
      onCommand: handleRemoteCommand,
      onConnectionChange: handleConnectionChange
    })
    remoteQrDataUrl = await QRCode.toDataURL(remoteInfo.url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#0d0d0f', light: '#ffffff' }
    })
    sendToControl('remote:ready', {
      url: remoteInfo.url,
      ip: remoteInfo.ip,
      port: remoteInfo.port,
      token: remoteInfo.token,
      qr: remoteQrDataUrl,
      connections: 0
    })
  } catch (err) {
    remoteError = err && err.message ? err.message : String(err)
    sendToControl('remote:error', remoteError)
  }
}

async function connectDb() {
  try {
    dbStatus = await db.connect()
  } catch (err) {
    dbStatus = {
      connected: false,
      error: err && err.message ? err.message : String(err)
    }
  }
  sendToControl('db:status', dbStatus)
}

// An uncaught exception leaves the process in an undefined state — report it
// (synchronously, so it lands on disk and is sent on the next launch), then
// exit, preserving the prior crash behavior.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  try {
    enqueueTelemetry('error', { where: 'main', name: (err && err.name) || 'Error' })
  } catch { /* ignore */ }
  process.exit(1)
})

app.whenReady().then(async () => {
  registerIpc()

  // --- version gate: runs and blocks BEFORE any window is created ---
  installId = installIdLib.getInstallId(app.getPath('userData'))
  const apiUrl = readLocalEnv('CUE_API_URL') || 'http://localhost:8787'
  bootInfo = await bootGate.checkBoot(
    {
      installId,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      buildChannel: app.isPackaged ? 'stable' : 'dev'
    },
    { apiUrl, cacheDir: app.getPath('userData') }
  )
  if (bootInfo.killSwitch || bootInfo.updateRequired) {
    const r = await dialog.showMessageBox({
      type: bootInfo.killSwitch ? 'error' : 'warning',
      title: bootInfo.killSwitch ? 'Cloak is unavailable' : 'Update required',
      message:
        bootInfo.message ||
        (bootInfo.killSwitch
          ? 'This version of Cloak has been disabled.'
          : 'A required update is available before you can continue.'),
      buttons: bootInfo.updateUrl ? ['Download', 'Quit'] : ['Quit'],
      defaultId: 0,
      cancelId: bootInfo.updateUrl ? 1 : 0
    })
    if (bootInfo.updateUrl && r.response === 0) {
      await shell.openExternal(bootInfo.updateUrl)
    }
    app.quit()
    return
  }

  // --- telemetry queue (consent-gated; default OFF until the renderer opts in) ---
  eventQueue = createEventQueue({
    queueDir: path.join(app.getPath('userData'), 'telemetry-queue'),
    apiUrl,
    getInstallId: () => installId,
    getAppVersion: () => app.getVersion()
  })
  eventQueue.start()

  await Promise.all([startRemoteServer(), connectDb()])
  buildAppMenu()
  createOverlayWindow()
  createControlWindow()
  registerShortcuts()

  // Background auto-update — packaged builds only. Complementary to the boot
  // gate: the gate FORCES updates, the updater offers the normal optional one.
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('[main] auto-update check failed:', err && err.message)
      })
    } catch (err) {
      console.error('[main] electron-updater unavailable:', err && err.message)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow()
      createControlWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  closeDeepgram()
  try {
    await endActiveSession()
  } catch { /* ignore */ }
  try {
    if (eventQueue) await eventQueue.stop()
  } catch { /* ignore */ }
  try { server.stop() } catch { /* ignore */ }
  try { await db.disconnect() } catch { /* ignore */ }
})
