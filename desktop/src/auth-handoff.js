// auth-handoff.js — Google sign-in for the desktop shell, following RFC 8252
// (OAuth for Native Apps): the shell listens on a loopback port picked by the
// OS, hands the OAuth leg to the system browser, and consumes a single-use
// token when the browser is bounced back to 127.0.0.1.
//
// Threat model notes (why each piece looks the way it does):
//  - state is 16 random bytes, compared in constant time after a length
//    check (the length is public — the shell minted it) so a forged loopback
//    request cannot be probed byte by byte.
//  - every invalid request gets the SAME 404, with no detail in the body or
//    the timing, so the listener cannot be used as a probing oracle.
//  - the Host header must be exactly 127.0.0.1:<port> and a browser-supplied
//    Origin must be absent or our own origin: that kills DNS-rebinding pages
//    (which fetch http://127.0.0.1:port with a foreign Host) and cross-site
//    fetches, per RFC 8252 section 8.3.
//  - the listener is single-use: the first valid request closes it.

'use strict'

const http = require('http')
const crypto = require('crypto')

const { APP_NAME, LOOPBACK_HOST, HANDOFF_TIMEOUT_MS } = require('./config')

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** 16 random bytes, hex — 32 chars, as RFC 8252 recommends (>= ~128 bits). */
function createState() {
  return crypto.randomBytes(16).toString('hex')
}

/** Length-safe constant-time comparison. */
function statesMatch(sent, expected) {
  if (typeof sent !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(sent, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * The URL the shell opens in the SYSTEM browser to (re)start Google sign-in
 * from the web app's own /signin entry, carrying the loopback port and state
 * the web side must echo back through its OAuth round trip.
 */
function buildBrowserSignInUrl(appOrigin, { port, state, next }) {
  const params = new URLSearchParams({
    desktop_port: String(port),
    desktop_state: state,
    provider: 'google',
  })
  if (next) params.set('next', next)
  return `${appOrigin}/signin?${params.toString()}`
}

/**
 * The authorize URL Google hands out from our web entry. The shell
 * intercepts main-frame navigations to this shape and swaps the leg into the
 * system browser instead (see main.js).
 */
function isGoogleAuthorizeStart(url) {
  try {
    const u = new URL(url)
    return (
      u.hostname === 'accounts.google.com' &&
      u.pathname.startsWith('/o/oauth2/v2/auth')
    )
  } catch {
    return false
  }
}

/** Site-relative redirect targets only: "/path", never "//host" or "/\host". */
function isSiteRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  )
}

/**
 * Validate one loopback request. Returns { ok: true, token, next } or
 * { ok: false }. Deliberately undifferentiated: wrong path, wrong method,
 * wrong state, missing token and malformed next all collapse into the same
 * false, and the caller answers every one of them with the same 404.
 */
function readHandoffRequest(req, expectedState) {
  if (req.method !== 'GET') return { ok: false }
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host || LOOPBACK_HOST}`)
  } catch {
    return { ok: false }
  }
  if (url.pathname !== '/callback') return { ok: false }

  // Host must be the literal loopback authority; a browser-supplied Origin
  // header must be absent (top-level redirects carry none) or the loopback
  // itself — anything else is a cross-site page or a rebinding attempt.
  const host = (req.headers.host || '').toLowerCase()
  if (!host.startsWith(`${LOOPBACK_HOST}:`)) return { ok: false }
  const origin = req.headers.origin
  if (origin) {
    try {
      if (new URL(origin).hostname !== LOOPBACK_HOST) return { ok: false }
    } catch {
      return { ok: false }
    }
  }

  const state = url.searchParams.get('state') || ''
  const token = url.searchParams.get('token_hash') || ''
  const next = url.searchParams.get('next')
  if (!state || !token) return { ok: false }
  if (token.length < 32 || token.length > 128) return { ok: false }
  if (!statesMatch(state, expectedState)) return { ok: false }
  if (next && !isSiteRelativePath(next)) return { ok: false }
  return { ok: true, token, next: next || undefined }
}

// ---------------------------------------------------------------------------
// Listener lifecycle
// ---------------------------------------------------------------------------

// Original page shown in the SYSTEM browser after the handoff succeeded.
// Charcoal matches the shell's WINDOW_DEFAULTS background.
function donePageHtml() {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${APP_NAME} — sign-in complete</title>`,
    '<style>',
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'background:#312e2b;color:#e8e6e3;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.card{text-align:center;padding:40px 32px;border-radius:16px;background:#262421;',
    'box-shadow:0 24px 60px -20px rgba(0,0,0,.6);max-width:340px}',
    'h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#a9a49c;font-size:14px}',
    '</style></head><body><main class="card"><h1>You are signed in</h1>',
    `<p>Head back to the ${APP_NAME} window — it will finish on its own.</p>`,
    '</main></body></html>',
  ].join('\n')
}

/**
 * Start the loopback handoff. Resolves { port, cancel } once the listener is
 * up; fires onToken({ token, next }) exactly once for the first valid
 * callback request, or onFailure(reason) on timeout/shutdown. The server and
 * its timer never keep the process alive.
 */
function startHandoff({ expectedState, onToken, onFailure }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let server = null
    let timer = null

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (server) server.close(() => {})
      fn(arg)
    }

    server = http.createServer((req, res) => {
      const result = readHandoffRequest(req, expectedState)
      if (!result.ok) {
        // One identical answer for everything invalid: no oracle.
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(donePageHtml())
      finish(onToken, { token: result.token, next: result.next })
    })

    server.on('error', (err) => {
      if (!settled) {
        settled = true
        if (timer) clearTimeout(timer)
        reject(err)
      }
    })

    // RFC 8252: let the OS pick a free loopback port.
    server.listen(0, LOOPBACK_HOST, () => {
      const { port } = server.address()
      timer = setTimeout(() => {
        finish(onFailure, 'timeout')
      }, HANDOFF_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()
      resolve({
        port,
        cancel() {
          finish(() => {}, 'cancelled')
        },
      })
    })
  })
}

module.exports = {
  buildBrowserSignInUrl,
  createState,
  donePageHtml,
  isGoogleAuthorizeStart,
  isSiteRelativePath,
  readHandoffRequest,
  startHandoff,
  statesMatch,
}
