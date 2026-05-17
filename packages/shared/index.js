'use strict'

/*
 * Shared contracts between the desktop app, the API, and the dashboard.
 * Dependency-free CommonJS so every workspace can `require` it directly.
 */

// Canonical product events — the app lifecycle + server-side gate decisions.
const CANONICAL_EVENTS = [
  'app_boot',
  'version_allowed',
  'version_blocked',
  'session_started',
  'session_ended',
  'error'
]

// Existing desktop session-event types, forwarded to the cloud as-is. These are
// genuinely useful for the dashboard's Usage Activity view — they are not
// collapsed into the canonical set.
const DESKTOP_EVENTS = [
  'play',
  'pause',
  'reset',
  'speed-change',
  'countdown',
  'stumble',
  'voice-scroll',
  'voice-state',
  'cue-hit',
  'jump',
  'reaction-manual',
  'script_saved',
  'ai_format_used',
  'voice_started',
  'voice_error',
  'remote_connected',
  'remote_command'
]

const ALL_EVENT_TYPES = [...CANONICAL_EVENTS, ...DESKTOP_EVENTS]
const EVENT_TYPE_SET = new Set(ALL_EVENT_TYPES)

const CHANNELS = ['dev', 'stable']
const PLATFORMS = ['darwin', 'win32', 'linux']
const POLICY_STATUSES = ['allowed', 'deprecated', 'blocked']

// Unknown types are still accepted by the API (forward-compat) but flagged.
function isKnownEventType(t) {
  return EVENT_TYPE_SET.has(t)
}

// The fields the boot response always returns — kept here so the desktop and
// the API agree on the contract.
const BOOT_RESPONSE_FIELDS = [
  'allowed',
  'status',
  'updateRequired',
  'killSwitch',
  'minVersion',
  'latestVersion',
  'message',
  'updateUrl',
  'features'
]

module.exports = {
  CANONICAL_EVENTS,
  DESKTOP_EVENTS,
  ALL_EVENT_TYPES,
  EVENT_TYPE_SET,
  CHANNELS,
  PLATFORMS,
  POLICY_STATUSES,
  BOOT_RESPONSE_FIELDS,
  isKnownEventType
}
