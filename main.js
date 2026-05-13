const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')
const QRCode = require('qrcode')
const server = require('./server')
const scriptParse = require('./lib/script-parse')
const aiFormat = require('./lib/ai-format')
const db = require('./lib/db')

const DEFAULT_OVERLAY_W = 960
const DEFAULT_OVERLAY_H = 332

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
  mirror: 'none',
  chapters: [],
  markers: [],
  cueCount: 0
}

let currentImage = null
let currentScriptText = ''
let currentParsed = scriptParse.parse('')
let dbStatus = { connected: false, error: null }
let activeSession = null
let activeSessionStartedAt = null
let activeScriptId = null
let voiceState = { active: false }
let deepgramWs = null
let deepgramReady = false
let deepgramKeepAlive = null

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
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
  try {
    const envPath = path.join(__dirname, '.env')
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
    /* no local env */
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
    if (currentImage) sendToOverlay('image:set', currentImage)
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

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 720,
    minHeight: 540,
    title: 'Cue — Teleprompter',
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

function applyTheme(value, opts = {}) {
  const theme = value === 'light' ? 'light' : 'dark'
  remoteState.theme = theme
  sendToOverlay('theme:set', theme)
  if (opts.notifyControl !== false) sendToControl('remote:theme-set', theme)
  broadcastRemoteState()
}

function applyImage(value, opts = {}) {
  const valid = typeof value === 'string' && value.startsWith('data:')
  currentImage = valid ? value : null
  remoteState.hasImage = !!currentImage
  sendToOverlay('image:set', currentImage)
  if (opts.notifyControl !== false) sendToControl('remote:image-set', currentImage)
  broadcastRemoteState()
  try {
    server.broadcast({ type: 'image', payload: currentImage })
  } catch { /* server not up */ }
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

function startDeepgram() {
  const apiKey = readLocalEnv('DEEPGRAM_API_KEY')
  if (!apiKey) {
    sendVoiceStatus('error', 'DEEPGRAM_API_KEY is not configured')
    return false
  }

  closeDeepgram()

  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
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

// ---------- sessions ----------

async function ensureSessionStarted() {
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
  if (!activeSession) return
  try {
    await db.endSession(activeSession.id)
    sendToControl('session:event', { type: 'session-end', id: activeSession.id })
  } catch { /* ignore */ }
  activeSession = null
  activeSessionStartedAt = null
}

function logSessionEvent(type, payload) {
  if (!activeSession || !dbStatus.connected) return
  const tMs = activeSessionStartedAt ? Date.now() - activeSessionStartedAt : 0
  db.logEvent(activeSession.id, tMs, type, payload || {}).catch(() => {
    /* ignore */
  })
}

// ---------- remote command bridge ----------

function handleRemoteCommand(msg, ws) {
  if (!msg || typeof msg.cmd !== 'string') return
  switch (msg.cmd) {
    case 'get-state':
      broadcastRemoteState()
      broadcastCues()
      if (ws && currentImage) {
        server.sendTo(ws, { type: 'image', payload: currentImage })
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

  ipcMain.on('voice:state', (_evt, s) => {
    voiceState = { active: !!(s && s.active) }
    sendToOverlay('voice:state', voiceState)
    logSessionEvent('voice-state', voiceState)
  })

  ipcMain.on('overlay:marker-event', (_evt, evt) => {
    if (!evt) return
    const data = evt.data || {}
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
        '2) Look at the recording preview — the Cue overlay should be missing on supported setups.\n' +
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
    hasKey: !!process.env.OPENAI_API_KEY,
    model: aiFormat.DEFAULT_MODEL
  }))

  ipcMain.handle('script:format-ai', async (_evt, text) => {
    const apiKey = process.env.OPENAI_API_KEY
    console.log('[main] script:format-ai called, hasKey=' + !!apiKey + ', textLen=' + (text ? String(text).length : 0))
    if (!apiKey) {
      return {
        ok: false,
        error: 'OPENAI_API_KEY is not set. Restart Cue with the env var to enable AI formatting.'
      }
    }
    const result = await aiFormat.format(text, { apiKey })
    console.log('[main] script:format-ai result: ok=' + result.ok + (result.error ? ' error=' + result.error : ' textLen=' + (result.text ? result.text.length : 0)))
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

app.whenReady().then(async () => {
  registerIpc()
  await Promise.all([startRemoteServer(), connectDb()])
  createOverlayWindow()
  createControlWindow()
  registerShortcuts()

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
  try { server.stop() } catch { /* ignore */ }
  try { await db.disconnect() } catch { /* ignore */ }
})
