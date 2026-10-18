// config.js — the single source of truth for the ChessX desktop shell.
// Every other module in this folder reads its knobs from here, so an origin
// change, a new window rule, or a tightened permission set can never drift
// between modules. Plain CommonJS, no dependencies beyond Electron itself.

'use strict'

const { app } = require('electron')

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

// Keep protocol + host, drop any path/trailing slash: the shell only ever
// deals with bare origins, and normalizing once here means every consumer
// can concatenate `${origin}/path` without re-checking for double slashes.
function normalizeOrigin(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

// The deployed web app the packaged shell loads. CHESSX_PROD_ORIGIN is read
// once at module load so a packaging step can substitute it (env-style
// "build time" substitution); the default is the current preview deployment.
const PRODUCTION_ORIGIN =
  normalizeOrigin(process.env.CHESSX_PROD_ORIGIN || '') ||
  'https://preview-chat-fd81b03d-d2f5-4f14-8b80-5bf6f2be4566.space-z.ai'

// Dev override, honored ONLY while the app is unpackaged. A packaged build
// launched from a terminal inherits whatever the developer happened to
// export, and environment variables leave no trace in code signatures or
// crash reports — so a "production" shell silently pointed at a stale
// localhost port would be indistinguishable from a bug report ghost.
// Packaged builds therefore always load PRODUCTION_ORIGIN.
function resolveAppOrigin() {
  if (!app.isPackaged && process.env.CHESSX_DESKTOP_URL) {
    return normalizeOrigin(process.env.CHESSX_DESKTOP_URL) || PRODUCTION_ORIGIN
  }
  return PRODUCTION_ORIGIN
}

const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).hostname

// Exact-hostname allowlists. Comparison is hostname-only and exact (port is
// deliberately ignored for app hosts so localhost:3000 and localhost:3001
// both work in dev); nothing else is ever treated as "ours".
const APP_HOSTS = new Set([PRODUCTION_HOST, 'localhost', '127.0.0.1'])
const AUTH_HOSTS = new Set(['accounts.google.com'])

// Protocols the shell will hand to the operating system. Everything else
// (file:, javascript:, custom schemes...) is refused.
const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
const MAX_EXTERNAL_URL_LENGTH = 2048

// How many app windows may exist at once (popups the app opens to our own
// origin are rebuilt through the window factory, up to this cap).
const MAX_APP_WINDOWS = 8

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const WINDOW_DEFAULTS = {
  width: 1280,
  height: 860,
  minWidth: 880,
  minHeight: 620,
  // The web app's dark shell surface (src/app/layout.tsx viewport themeColor
  // and the .dark --background in src/app/globals.css). Using the real value
  // keeps the pre-paint flash from showing a white rectangle.
  backgroundColor: '#312e2b',
  title: 'ChessX',
}

// Hardened renderer: no Node in the page, no preload surface, no webview tag.
// The shell communicates with the web app only through URLs and cookies —
// there is no custom IPC bridge by design.
const WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
  spellcheck: true,
}

// Permissions the web app may be granted. Deny-by-default for everything
// else (camera, mic, geolocation, notifications, ...). The deprecated sync
// clipboard read is kept because the app's copy paths still probe it.
const ALLOWED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
])

// Chromium net error codes that are NOT real connectivity loss: -3 ABORTED
// (navigation was canceled, e.g. by our own guards) and -20 BLOCKED_BY_CLIENT
// (the shell itself or an extension blocked the load). did-fail-load codes
// outside this deny-list are treated as offline and routed to offline.html.
const NON_OFFLINE_ERROR_CODES = new Set([-3, -20])

function isOfflineFailure(errorCode) {
  return (
    typeof errorCode === 'number' &&
    errorCode !== 0 &&
    !NON_OFFLINE_ERROR_CODES.has(errorCode)
  )
}

// ---------------------------------------------------------------------------
// Identity + Google handoff
// ---------------------------------------------------------------------------

const APP_NAME = 'ChessX'
// Appended to the Chrome-shaped User-Agent for app hosts only.
const DESKTOP_UA_TAG = 'ChessX-Desktop'

// RFC 8252 loopback handoff: the shell listens here on an ephemeral port.
const LOOPBACK_HOST = '127.0.0.1'
// How long the shell waits for the system browser to complete the OAuth
// round trip before giving up.
const HANDOFF_TIMEOUT_MS = 5 * 60_000
// Our OWN web-side entry point for Google sign-in (the route whose response
// carries the accounts.google.com authorize URL). The shell intercepts
// navigations to the authorize URL Google hands out from this entry —
// that interception is what moves the OAuth leg into the system browser.
const OAUTH_AUTHORIZE_PATH = '/api/auth/google/start'

// Local pages the shell loads via loadFile (paths are relative to this file).
const OFFLINE_PAGE_FILE = 'offline.html'
const SIGNING_IN_PAGE_FILE = 'signing-in.html'

module.exports = {
  APP_NAME,
  APP_HOSTS,
  ALLOWED_PERMISSIONS,
  AUTH_HOSTS,
  DESKTOP_UA_TAG,
  EXTERNAL_PROTOCOLS,
  HANDOFF_TIMEOUT_MS,
  LOOPBACK_HOST,
  MAX_APP_WINDOWS,
  MAX_EXTERNAL_URL_LENGTH,
  NON_OFFLINE_ERROR_CODES,
  OAUTH_AUTHORIZE_PATH,
  OFFLINE_PAGE_FILE,
  PRODUCTION_ORIGIN,
  SIGNING_IN_PAGE_FILE,
  WEB_PREFERENCES,
  WINDOW_DEFAULTS,
  isOfflineFailure,
  normalizeOrigin,
  resolveAppOrigin,
}
