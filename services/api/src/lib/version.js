'use strict'

// Real semver — version gating is too important for hand-rolled comparison.
const semver = require('semver')

// Normalize an arbitrary version string to a comparable semver, or null.
function coerce(v) {
  if (!v) return null
  if (semver.valid(v)) return v
  const c = semver.coerce(v)
  return c ? c.version : null
}

// appVersion is below minVersion -> a required update.
// An unparseable version never triggers a forced update (fail open).
function isUpdateRequired(appVersion, minVersion) {
  const a = coerce(appVersion)
  const m = coerce(minVersion)
  if (!a || !m) return false
  return semver.lt(a, m)
}

// Is `a` strictly newer than `b`?
function isNewer(a, b) {
  const ca = coerce(a)
  const cb = coerce(b)
  if (!ca || !cb) return false
  return semver.gt(ca, cb)
}

function compare(a, b) {
  const ca = coerce(a)
  const cb = coerce(b)
  if (!ca || !cb) return 0
  return semver.compare(ca, cb)
}

// Specificity score for a policy row — an exact field beats "*".
function specificity(policy) {
  let s = 0
  if (policy.version && policy.version !== '*') s += 4
  if (policy.channel && policy.channel !== '*') s += 2
  if (policy.platform && policy.platform !== '*') s += 1
  return s
}

function policyMatches(policy, ctx) {
  const fieldMatch = (pv, cv) => pv == null || pv === '*' || pv === cv
  return (
    fieldMatch(policy.version, ctx.version) &&
    fieldMatch(policy.channel, ctx.channel) &&
    fieldMatch(policy.platform, ctx.platform)
  )
}

// From candidate rows, pick the most specific one that matches ctx.
// Ties break toward the most recently updated row. Returns null if none match.
function resolvePolicy(rows, ctx) {
  const matching = (rows || []).filter((r) => policyMatches(r, ctx))
  if (!matching.length) return null
  matching.sort((a, b) => {
    const d = specificity(b) - specificity(a)
    if (d !== 0) return d
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  })
  return matching[0]
}

module.exports = {
  coerce,
  isUpdateRequired,
  isNewer,
  compare,
  specificity,
  policyMatches,
  resolvePolicy
}
