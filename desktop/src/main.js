// main.js — the ChessX desktop shell, in strict lifecycle order:
//
//   1. single-instance lock
//   2. User-Agent fallback (pre-ready, so no request can precede it)
//   3. web-contents-created guards (central + popup-proof)
//   4. ready: permission policy, request UA stamp, menu, window factory
//
// The shell has no preload script and no custom IPC: the web app is a normal
// website in a hardened window, and the only out-of-band channel is the
// RFC 8252 loopback listener used during Google sign-in.

'use strict'

const path = require('path')
const { app, BrowserWindow, Menu, screen, session, shell } = require('electron')

const cfg = require('./config')
const nav = require('./navigation')
const ua = require('./user-agent')
const handoff = require('./auth-handoff')
const winState = require('./window-state')

// ---------------------------------------------------------------------------
// 1. Single instance — a second launch focuses the existing window instead.
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ---------------------------------------------------------------------------
// 2. UA fallback, pre-ready: every request made before `ready` (there can be
//    none from windows yet, but none is a promise, not a guarantee) sees the
//    clean shape already.
// ---------------------------------------------------------------------------

const agents = ua.applyUserAgent(app) // { clean, tagged }

// The origin the shell loads. Refined from resolveAppOrigin() at ready (it
// needs app.isPackaged); the production default is safe for pre-ready use.
let appOrigin = cfg.PRODUCTION_ORIGIN

const windows = new Set()
let handoffBusy = false
let activeHandoff = null

app.on('second-instance', () => focusOrCreateWindow())

// ---------------------------------------------------------------------------
// 3. Central guards — attached at web-contents-created so they cover every
//    webContents this app can ever create, which is what makes the posture
//    popup-proof: a renderer that talks the shell into opening a new window
//    does NOT inherit a weaker policy, because the new contents passes
//    through this same funnel.
// ---------------------------------------------------------------------------

app.on('web-contents-created', (_event, contents) => {
  // No <webview> tag, from any page, ever.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // Popups are never allowed to be themselves: the OS popup is denied and
  // the target is rebuilt (app URL → window factory, capped) or handed to
  // the system browser (safe external).
  nav.attachWindowOpenHandler(contents, {
    createAppWindow: (url) => createWindow({ url }),
    openExternal: (url) => openExternalUrl(url),
  })

  // Main-frame allowlist. DevTools contents (dev builds only) are exempt —
  // they are host UI, not web surface.
  if (contents.getType() !== 'devtools') {
    nav.attachNavigationGuards(contents)
  }
})

function openExternalUrl(url) {
  if (nav.isSafeExternalUrl(url)) {
    shell.openExternal(url).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 4. Ready — policy, UA stamping, menu, and the window factory.
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  appOrigin = cfg.resolveAppOrigin()

  nav.applyPermissionPolicy(session.defaultSession, cfg.ALLOWED_PERMISSIONS)
  ua.applyRequestUserAgent(session.defaultSession, agents)

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (windows.size === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

function buildMenu() {
  // Standard roles only. DevTools exists in dev builds; a packaged shell
  // ships without it.
  const viewSubmenu = [
    { role: 'reload' },
    { role: 'forceReload' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]
  if (!app.isPackaged) viewSubmenu.splice(2, 0, { role: 'toggleDevTools' })

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu', submenu: viewSubmenu },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Window factory
// ---------------------------------------------------------------------------

function focusOrCreateWindow() {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
      return
    }
  }
  if (app.isReady()) createWindow()
}

function createWindow(opts = {}) {
  if (windows.size >= cfg.MAX_APP_WINDOWS) return null

  const saved = winState.loadWindowState(app, screen)
  const win = new BrowserWindow({
    ...cfg.WINDOW_DEFAULTS,
    show: false,
    // No `partition` on purpose: the persistent default session is what
    // keeps the player signed in across restarts. A dedicated partition
    // would be an implicit "incognito" and log everyone out on upgrade.
    webPreferences: { ...cfg.WEB_PREFERENCES },
    // Restored geometry only when the saved state was provably sane and
    // on-screen; otherwise the window uses its defaults (no invented x/y).
    ...(saved && saved.bounds
      ? {
          x: saved.bounds.x,
          y: saved.bounds.y,
          width: saved.bounds.width,
          height: saved.bounds.height,
        }
      : {}),
  })

  windows.add(win)
  win.on('closed', () => windows.delete(win))
  winState.trackWindow(app, screen, win)

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (saved && saved.maximized) win.maximize()
    win.show()
  })
  // Hard deadline: if the renderer hangs before first paint, ready-to-show
  // never fires and the window would stay invisible forever.
  const showDeadline = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show()
      console.warn('[shell] window shown via 2s deadline (ready-to-show never fired)')
    }
  }, 2000)
  showDeadline.unref()

  wireDocumentUserAgent(win)
  wireOfflineRecovery(win)
  wireCrashRecovery(win)
  wireOriginIndicator(win)
  wireGoogleHandoff(win)

  const initial = opts.url && nav.isAppUrl(opts.url) ? opts.url : appOrigin
  win.loadURL(initial).catch(() => {})
  return win
}

function wireDocumentUserAgent(win) {
  ua.attachDocumentUserAgent(win.webContents, agents)
}

/**
 * Main-frame loads that failed for a non-deny-listed reason are treated as
 * connectivity loss: park the window on the local offline page, telling it
 * where to retry. file:// failures (our own pages) never loop through here.
 */
function wireOfflineRecovery(win) {
  win.webContents.on('did-fail-load', (_event, errorCode, _desc, url, isMainFrame) => {
    if (!isMainFrame) return
    if (!cfg.isOfflineFailure(errorCode)) return
    if (typeof url === 'string' && url.startsWith('file://')) return
    if (win.isDestroyed()) return
    win.webContents
      .loadFile(path.join(__dirname, cfg.OFFLINE_PAGE_FILE), { query: { origin: appOrigin } })
      .catch(() => {})
  })
}

/**
 * One automatic reload after a renderer crash, with a 30s cooldown so a
 * crash loop cannot spin the process. A second crash inside the cooldown is
 * left visible to the user instead of being masked.
 */
function wireCrashRecovery(win) {
  let lastRecoveryAt = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[shell] renderer gone:', details && details.reason)
    const now = Date.now()
    if (now - lastRecoveryAt < 30_000) return
    lastRecoveryAt = now
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload()
    }, 150)
    timer.unref()
  })
}

/**
 * Origin indicator: the title stays the page's own title for app URLs, and
 * gains ` — <host>` whenever the shell is showing some other origin, so a
 * Google or payment page can never impersonate the app chrome.
 */
function wireOriginIndicator(win) {
  const contents = win.webContents
  let lastPageTitle = cfg.WINDOW_DEFAULTS.title

  const composedTitle = () => {
    const u = nav.parseUrl(contents.getURL())
    const suffix = u && u.hostname && !nav.isAppUrl(u) ? ` — ${u.hostname}` : ''
    return `${lastPageTitle}${suffix}`
  }

  contents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    lastPageTitle = typeof title === 'string' && title.length > 0 ? title : cfg.WINDOW_DEFAULTS.title
    if (!win.isDestroyed()) win.setTitle(composedTitle())
  })
  contents.on('did-navigate', () => {
    if (!win.isDestroyed()) win.setTitle(composedTitle())
  })
  contents.on('did-navigate-in-page', () => {
    if (!win.isDestroyed()) win.setTitle(composedTitle())
  })
}

/**
 * Google sign-in interception. When the web app sends the shell's window to
 * the Google authorize URL (the address our /api/auth/google/start route
 * hands out), the shell does NOT render Google inline: it parks the window
 * on a local page, starts the RFC 8252 loopback listener, and re-launches
 * sign-in in the SYSTEM browser (which owns the user's Google cookies and
 * their passkeys). When the browser bounces back to 127.0.0.1 with the
 * single-use token, the shell itself loads
 *   /api/auth/desktop?token_hash=...&next=...
 * on the app origin; the web side consumes the token, sets the session
 * cookie, and redirects into the app.
 */
function wireGoogleHandoff(win) {
  win.webContents.on('will-navigate', (event, url) => {
    if (!handoff.isGoogleAuthorizeStart(url)) return
    event.preventDefault()
    if (handoffBusy || activeHandoff) return
    handoffBusy = true
    beginSignInHandoff(win)
  })
}

function beginSignInHandoff(win) {
  const expectedState = handoff.createState()

  const cleanup = () => {
    handoffBusy = false
    if (activeHandoff) {
      const h = activeHandoff
      activeHandoff = null
      h.cancel()
    }
  }

  win.once('closed', cleanup)

  handoff
    .startHandoff({
      expectedState,
      onToken: ({ token, next }) => {
        activeHandoff = null
        handoffBusy = false
        if (win.isDestroyed()) return
        const target = new URL('/api/auth/desktop', appOrigin)
        target.searchParams.set('token_hash', token)
        if (next) target.searchParams.set('next', next)
        // Consume the token IN the shell: the response carries the session
        // cookie, which the persistent default session keeps across restarts.
        win.loadURL(target.toString()).catch(() => {})
      },
      onFailure: (reason) => {
        activeHandoff = null
        handoffBusy = false
        console.warn('[shell] google handoff failed:', reason)
        if (win.isDestroyed()) return
        win.loadURL(appOrigin).catch(() => {})
      },
    })
    .then((h) => {
      activeHandoff = h
      // Park the shell on a quiet local page while the system browser works.
      return win.webContents
        .loadFile(path.join(__dirname, cfg.SIGNING_IN_PAGE_FILE), { query: { origin: appOrigin } })
        .catch(() => {})
        .then(() => shell.openExternal(handoff.buildBrowserSignInUrl(appOrigin, { port: h.port, state: expectedState })))
    })
    .catch((err) => {
      console.error('[shell] could not start google handoff:', err)
      cleanup()
      if (!win.isDestroyed()) win.loadURL(appOrigin).catch(() => {})
    })
}
