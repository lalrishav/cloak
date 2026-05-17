'use strict'
const crypto = require('crypto')

const ADMIN_COOKIE = 'cue_admin'
const CSRF_COOKIE = 'cue_csrf'
// Fixed, encoding-safe marker — v1 has exactly one admin, so the cookie only
// needs to assert "this session is authenticated", not carry identity.
const SESSION_VALUE = 'cue-admin-session'

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/*
 * Simple signed-cookie admin auth (v1).
 *
 * - login verifies CUE_ADMIN_USER / CUE_ADMIN_PASS, then sets a signed,
 *   HttpOnly, SameSite=Strict session cookie plus a readable CSRF cookie.
 * - authGuard is a preHandler: 401 if unauthenticated; for write methods it
 *   also requires the x-csrf-token header to match the CSRF cookie (403 on
 *   mismatch). SameSite=Strict already blocks cross-site cookie sends; the
 *   token is defense-in-depth, required before any non-localhost deployment.
 */
function createAuth(config) {
  function setSessionCookies(reply) {
    const csrf = crypto.randomBytes(24).toString('hex')
    reply.setCookie(ADMIN_COOKIE, SESSION_VALUE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      signed: true,
      secure: !config.isDev,
      maxAge: 60 * 60 * 12
    })
    reply.setCookie(CSRF_COOKIE, csrf, {
      path: '/',
      httpOnly: false,
      sameSite: 'strict',
      signed: false,
      secure: !config.isDev,
      maxAge: 60 * 60 * 12
    })
  }

  function loginHandler(request, reply) {
    const { user, pass } = request.body || {}
    const ok =
      typeof user === 'string' &&
      typeof pass === 'string' &&
      timingSafeEqual(user, config.adminUser) &&
      timingSafeEqual(pass, config.adminPass)
    if (!ok) {
      reply.code(401)
      return { error: 'invalid credentials' }
    }
    setSessionCookies(reply)
    return { ok: true, user: config.adminUser }
  }

  function logoutHandler(request, reply) {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    reply.clearCookie(CSRF_COOKIE, { path: '/' })
    return { ok: true }
  }

  function currentUser(request) {
    const raw = request.cookies && request.cookies[ADMIN_COOKIE]
    if (!raw) return null
    const unsigned = request.unsignCookie(raw)
    if (!unsigned || !unsigned.valid || unsigned.value !== SESSION_VALUE) return null
    return config.adminUser
  }

  function meHandler(request, reply) {
    const u = currentUser(request)
    if (!u) {
      reply.code(401)
      return { error: 'not authenticated' }
    }
    return { user: u }
  }

  async function authGuard(request, reply) {
    const u = currentUser(request)
    if (!u) {
      reply.code(401)
      return reply.send({ error: 'not authenticated' })
    }
    request.adminUser = u
    const method = request.method.toUpperCase()
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const headerToken = request.headers['x-csrf-token']
      const cookieToken = request.cookies && request.cookies[CSRF_COOKIE]
      if (
        !headerToken ||
        !cookieToken ||
        !timingSafeEqual(String(headerToken), String(cookieToken))
      ) {
        reply.code(403)
        return reply.send({ error: 'csrf token missing or invalid' })
      }
    }
  }

  return { loginHandler, logoutHandler, meHandler, authGuard, currentUser }
}

module.exports = { createAuth, ADMIN_COOKIE, CSRF_COOKIE }
