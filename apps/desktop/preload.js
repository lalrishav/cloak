const { contextBridge, ipcRenderer } = require('electron')

const bridge = {
  // --- script + playback ---
  updateScript: (text) => ipcRenderer.send('script:update', text),
  formatScriptWithAi: (text) => ipcRenderer.invoke('script:format-ai', text),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  toggleScroll: () => ipcRenderer.send('scroll:toggle'),
  resetScroll: () => ipcRenderer.send('scroll:reset'),
  manualScroll: (direction, lines) =>
    ipcRenderer.send('scroll:nudge', { direction, lines }),
  setSpeed: (v) => ipcRenderer.send('speed:set', v),
  setFontSize: (v) => ipcRenderer.send('font:set', v),
  setOpacity: (v) => ipcRenderer.send('opacity:set', v),
  setSmartPace: (v) => ipcRenderer.send('pace:smart', v),
  setImage: (dataUrl) => ipcRenderer.send('image:set', dataUrl),
  setReferences: (payload) => ipcRenderer.send('references:set', payload),
  addReference: (ref) => ipcRenderer.send('reference:add', ref),
  clearReferences: () => ipcRenderer.send('references:clear'),
  activateReference: (id) => ipcRenderer.send('reference:activate', id),
  nextReference: () => ipcRenderer.send('reference:next'),
  prevReference: () => ipcRenderer.send('reference:prev'),
  setReferenceFocus: (value) => ipcRenderer.send('reference:focus', value),
  toggleReferenceFocus: () => ipcRenderer.send('reference:toggle-focus'),
  setTheme: (value) => ipcRenderer.send('theme:set', value),
  reposition: (bounds) => ipcRenderer.send('overlay:reposition', bounds),

  // --- cue actions ---
  jumpToChapter: (idOrTitle) =>
    ipcRenderer.send('cue:jump', { chapter: idOrTitle }),
  jumpToNextCue: () => ipcRenderer.send('cue:jump', 'cue:next'),
  jumpToPrevCue: () => ipcRenderer.send('cue:jump', 'cue:prev'),
  triggerReaction: (data) => ipcRenderer.send('cue:reaction', data),
  setMirror: (mode) => ipcRenderer.send('overlay:mirror', mode),
  startCountdown: (seconds) =>
    ipcRenderer.send('playback:countdown', seconds),
  bookmarkStumble: () => ipcRenderer.send('session:stumble'),
  voiceScroll: (data) => ipcRenderer.send('voice:scroll', data),
  voiceState: (s) => ipcRenderer.send('voice:state', s),
  voiceStart: () => ipcRenderer.invoke('voice:start'),
  voiceStop: () => ipcRenderer.send('voice:stop'),
  voiceAudio: (chunk) => ipcRenderer.send('voice:audio', chunk),
  voiceDebug: (source, data) => ipcRenderer.send('voice:debug', { source, data }),
  markerEvent: (channel, data) =>
    ipcRenderer.send('overlay:marker-event', { channel, data }),

  // --- drag + overlay management ---
  dragStart: () => ipcRenderer.send('overlay:drag-start'),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  dragMove: (delta) => ipcRenderer.send('overlay:drag-move', delta),

  // --- platform + remote ---
  testCapture: () => ipcRenderer.send('capture:test'),
  getPlatform: () => ipcRenderer.invoke('platform:info'),
  getRemoteInfo: () => ipcRenderer.invoke('remote:info'),

  // --- production: diagnostics + telemetry ---
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  setAnalyticsConsent: (value) => ipcRenderer.send('telemetry:consent', value),
  reportError: (info) => ipcRenderer.send('telemetry:error', info),

  // --- scripts library (DB) ---
  scriptsList: () => ipcRenderer.invoke('scripts:list'),
  scriptsGet: (id) => ipcRenderer.invoke('scripts:get', id),
  scriptsCreate: (data) => ipcRenderer.invoke('scripts:create', data),
  scriptsUpdate: (id, data) => ipcRenderer.invoke('scripts:update', { id, data }),
  scriptsDelete: (id) => ipcRenderer.invoke('scripts:delete', id),
  scriptsSnapshot: (id) => ipcRenderer.invoke('scripts:snapshot', id),
  scriptsVersions: (id) => ipcRenderer.invoke('scripts:versions', id),
  scriptsRestore: (id, versionId) =>
    ipcRenderer.invoke('scripts:restore', { id, versionId }),

  // --- sessions (DB) ---
  sessionsList: (scriptId) =>
    ipcRenderer.invoke('sessions:list', scriptId || null),
  sessionsGet: (id) => ipcRenderer.invoke('sessions:get', id),

  // --- db status ---
  dbStatus: () => ipcRenderer.invoke('db:status'),
  setActiveScript: (id) => ipcRenderer.send('script:active', id),
  onDbStatus: (cb) => ipcRenderer.on('db:status', (_, v) => cb(v)),

  // --- window controls ---
  toggleFullscreen: (force) =>
    ipcRenderer.send('control:toggle-fullscreen', force),
  onFullscreenState: (cb) =>
    ipcRenderer.on('control:fullscreen-state', (_, v) => cb(v)),
  toggleOverlay: (force) =>
    ipcRenderer.send('overlay:toggle-visibility', force),
  onOverlayVisibility: (cb) =>
    ipcRenderer.on('control:overlay-visibility', (_, v) => cb(v)),

  // --- script events from main → renderers ---
  onScriptUpdate: (cb) =>
    ipcRenderer.on('script:update', (_, v) => cb(v)),
  onToggle: (cb) => ipcRenderer.on('scroll:toggle', () => cb()),
  onReset: (cb) => ipcRenderer.on('scroll:reset', () => cb()),
  onManualScroll: (cb) => ipcRenderer.on('scroll:nudge', (_, v) => cb(v)),
  onSpeedSet: (cb) => ipcRenderer.on('speed:set', (_, v) => cb(v)),
  onFontSet: (cb) => ipcRenderer.on('font:set', (_, v) => cb(v)),
  onImageSet: (cb) => ipcRenderer.on('image:set', (_, v) => cb(v)),
  onReferenceSet: (cb) => ipcRenderer.on('reference:set', (_, v) => cb(v)),
  onSmartPaceSet: (cb) => ipcRenderer.on('pace:smart', (_, v) => cb(v)),
  onThemeSet: (cb) => ipcRenderer.on('theme:set', (_, v) => cb(v)),

  // --- cue events from main → overlay ---
  onJump: (cb) => ipcRenderer.on('cue:jump', (_, v) => cb(v)),
  onMirror: (cb) => ipcRenderer.on('overlay:mirror', (_, v) => cb(v)),
  onCountdown: (cb) =>
    ipcRenderer.on('playback:countdown', (_, v) => cb(v)),
  onReactionTrigger: (cb) =>
    ipcRenderer.on('cue:reaction', (_, v) => cb(v)),
  onReadingLine: (cb) =>
    ipcRenderer.on('overlay:reading-line', (_, v) => cb(v)),
  onVoiceScroll: (cb) => ipcRenderer.on('voice:scroll', (_, v) => cb(v)),
  onVoiceState: (cb) => ipcRenderer.on('voice:state', (_, v) => cb(v)),
  onVoiceStatus: (cb) => ipcRenderer.on('voice:status', (_, v) => cb(v)),
  onVoiceTranscript: (cb) =>
    ipcRenderer.on('voice:transcript', (_, v) => cb(v)),

  // --- echoes back to control panel ---
  onControlToggleEcho: (cb) =>
    ipcRenderer.on('control:toggle-echo', (_, v) => cb(v)),
  onControlResetEcho: (cb) =>
    ipcRenderer.on('control:reset-echo', () => cb()),
  onControlSpeedNudge: (cb) =>
    ipcRenderer.on('control:speed-nudge', (_, v) => cb(v)),
  onMarkerEvent: (cb) =>
    ipcRenderer.on('overlay:marker-event', (_, v) => cb(v)),

  onRemoteSpeedSet: (cb) =>
    ipcRenderer.on('remote:speed-set', (_, v) => cb(v)),
  onRemoteFontSet: (cb) =>
    ipcRenderer.on('remote:font-set', (_, v) => cb(v)),
  onRemoteOpacitySet: (cb) =>
    ipcRenderer.on('remote:opacity-set', (_, v) => cb(v)),
  onRemoteSmartPaceSet: (cb) =>
    ipcRenderer.on('remote:smart-pace-set', (_, v) => cb(v)),
  onRemoteThemeSet: (cb) =>
    ipcRenderer.on('remote:theme-set', (_, v) => cb(v)),
  onRemoteImageSet: (cb) =>
    ipcRenderer.on('remote:image-set', (_, v) => cb(v)),
  onRemoteReferenceSet: (cb) =>
    ipcRenderer.on('remote:reference-set', (_, v) => cb(v)),
  onRemoteConnections: (cb) =>
    ipcRenderer.on('remote:connections', (_, v) => cb(v)),
  onRemoteReady: (cb) =>
    ipcRenderer.on('remote:ready', (_, v) => cb(v)),
  onRemoteError: (cb) =>
    ipcRenderer.on('remote:error', (_, v) => cb(v)),
  onRemoteJump: (cb) =>
    ipcRenderer.on('remote:jump', (_, v) => cb(v)),
  onRemoteReaction: (cb) =>
    ipcRenderer.on('remote:reaction', (_, v) => cb(v)),
  onRemoteStumble: (cb) =>
    ipcRenderer.on('remote:stumble', () => cb()),

  onSessionEvent: (cb) =>
    ipcRenderer.on('session:event', (_, v) => cb(v)),

  // --- menu-driven panel toggles (from app menu) ---
  onShowPanel: (cb) =>
    ipcRenderer.on('control:show-panel', (_, v) => cb(v)),
  openAbout: () => ipcRenderer.send('about:open')
}

contextBridge.exposeInMainWorld('cloak', bridge)
contextBridge.exposeInMainWorld('cue', bridge)
