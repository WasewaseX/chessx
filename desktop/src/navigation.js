// navigation.js — pure URL classifiers plus the Electron wiring that turns
// them into hard boundaries: exact-hostname allowlists, a never-allow window
// open handler, main-frame navigation gating, and a deny-by-default
// permission policy. The classifiers are dependency-free so they can be read
// (and reasoned about) on their own.

'use strict'

const {
  APP_HOSTS,
  AUTH_HOSTS,
  EXTERNAL_PROTOCOLS,
  MAX_APP_WINDOWS,
  MAX_EXTERNAL_URL_LENGTH,
} = require('./config')

// ---------------------------------------------------------------------------
// Pure classifiers
// ---------------------------------------------------------------------------

/** URL | null — never throws, whatever the input. */
function parseUrl(input) {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

/** Exact-hostname membership. Port-insensitive on purpose (see config.js). */
function isInternalUrl(url, hosts) {
  const u = typeof url === 'string' ? parseUrl(url) : url
  return !!u && hosts.has(u.hostname)
}

/** Our own web app (deployed origin + localhost dev hosts). */
function isAppUrl(url) {
  return isInternalUrl(url, APP_HOSTS)
}

/** Google's authorize/consent hosts. */
function isAuthUrl(url) {
  return isInternalUrl(url, AUTH_HOSTS)
}

/**
 * Safe to hand to the operating system's browser/mail handler: an allow-listed
 * protocol, bounded length (protocol handlers have choked on absurd URLs),
 * and no credentials smuggled into the URL.
 */
function isSafeExternalUrl(url) {
  const u = typeof url === 'string' ? parseUrl(url) : url
  if (!u) return false
  if (!EXTERNAL_PROTOCOLS.has(u.protocol)) return false
  if (u.username || u.password) return false
  return u.toString().length <= MAX_EXTERNAL_URL_LENGTH
}

/**
 * One label for "what is this URL to the shell": open it here, hand it to
 * the OS, or drop it on the floor.
 */
function classifyNavigation(url) {
  if (isAppUrl(url)) return 'app'
  if (isAuthUrl(url)) return 'auth'
  if (isSafeExternalUrl(url)) return 'external'
  return 'blocked'
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Central, popup-proof window-open policy. NEVER returns { action: 'allow' }:
 * the original popup is always denied, and anything worth showing is rebuilt
 * inside the shell (app URLs → window factory, capped) or handed to the OS
 * (safe external URLs). setImmediate keeps the rebuild outside the handler
 * call stack, which Electron requires for spawning windows.
 */
function attachWindowOpenHandler(contents, { createAppWindow, openExternal }) {
  contents.setWindowOpenHandler((details) => {
    setImmediate(() => {
      const kind = classifyNavigation(details.url)
      if (kind === 'app' && typeof createAppWindow === 'function') {
        createAppWindow(details.url)
      } else if ((kind === 'auth' || kind === 'external') && typeof openExternal === 'function') {
        openExternal(details.url)
      }
      // kind === 'blocked': dropped silently
    })
    return { action: 'deny' }
  })
}

/**
 * Main-frame navigation gate on every webContents. will-navigate fires for
 * main-frame, page-initiated navigations (links, location changes); the
 * factory's programmatic loadURL/loadFile calls do NOT pass through it.
 *
 * Deliberately NOT gated: will-redirect and will-frame-navigate. Google's
 * consent screen and payment providers hop through 302 chains on several
 * hosts and embed subframes from CDNs; gating those breaks real flows while
 * adding nothing — the dangerous case (a page jumping the top-level window
 * somewhere we do not own) is covered here, popups are covered by the open
 * handler, and the session's deny-by-default permission policy covers the
 * rest of the capability surface.
 */
function attachNavigationGuards(contents) {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
  })
}

/**
 * Deny-by-default permission policy for a session: only the allow-set in
 * config.js is granted, device permissions (USB/serial/BLuetooth HID) are
 * refused outright, and display-media requests get an empty stream.
 */
function applyPermissionPolicy(ses, allowedPermissions) {
  const allowed = allowedPermissions || new Set()
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    callback({}) // no streams, ever
  })
}

module.exports = {
  applyPermissionPolicy,
  attachNavigationGuards,
  attachWindowOpenHandler,
  classifyNavigation,
  isAppUrl,
  isAuthUrl,
  isInternalUrl,
  isSafeExternalUrl,
  parseUrl,
}
