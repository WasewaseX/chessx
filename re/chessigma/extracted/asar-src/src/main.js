'use strict';

/**
 * Chessigma desktop shell — app lifecycle, window factory, menu.
 *
 * The shell is content-free: it opens a window on the LIVE production web app
 * and gets out of the way. Sign-in, Stripe checkout, Stockfish and every route
 * behave exactly as they do in a browser, because they ARE the browser — the
 * only deviations are the UA tag (which the web app uses to suppress ads and
 * segment telemetry) and the shell's own navigation/permission policy.
 *
 * The ORDER below is load-bearing. Several steps are silently ineffective if
 * moved:
 *   1. single-instance lock — before any other work
 *   2. UA fallback — module scope, pre-`ready`, so sessions created later inherit it
 *   3. web-contents-created guards — central, so a popup cannot escape them
 *   4. session policy — after `ready`, BEFORE the first window loads
 *   5. menu — before the first window, so macOS gets its edit/view roles
 *   6. window — needs `screen`, which needs `ready`
 *
 * Things this file must never do, each a parity or security regression:
 *   • append command-line switches (`js-flags`, `--disable-features`, …) — that
 *     changes V8/WASM behaviour relative to Chrome, i.e. Stockfish stops matching web
 *   • pass a `partition` to any window — a non-`persist:` partition is in-memory
 *     (signed out on every quit) and any partition splits the wasm code cache
 *   • inject CSP or response headers — that would apply on desktop only and could
 *     break prod for desktop users while browsers are fine
 *   • register a `certificate-error` handler — the default (reject) is correct
 *   • call session.clearStorageData() — it signs the user out
 */

const path = require('path');
const { app, BrowserWindow, Menu, session, shell } = require('electron');

const { APP_ORIGIN, WINDOW_DEFAULTS, WEB_PREFERENCES, isOfflineFailure, HELP_LINKS } = require('./config');
const { applyUserAgent, applyRequestUserAgent, attachDocumentUserAgent } = require('./user-agent');
const {
  attachNavigationGuards,
  attachWindowOpenHandler,
  applyPermissionPolicy,
  isAppUrl,
  returnPathFromAuthorizeUrl,
} = require('./navigation');
const { startHandoff } = require('./auth-handoff');
const windowState = require('./window-state');

const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const SIGNING_IN_PAGE = path.join(__dirname, 'signing-in.html');
const RENDERER_RECOVERY_COOLDOWN_MS = 30_000;
/**
 * Hard deadline for showing the window. `ready-to-show` waits for the REMOTE
 * page's first paint, so on a hanging network (DNS blackhole, captive portal
 * that neither resolves nor fails) it can be minutes — and until then the app
 * has a Dock icon and no window at all, which reads as "it didn't launch".
 * did-fail-load only rescues actual errors, not a socket that never answers.
 */
const SHOW_WINDOW_DEADLINE_MS = 2_000;

// 1. Single-instance lock. A top-level `return` is legal here: CommonJS wraps
//    every module in a function, and this must run before anything else.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Fail loudly on a malformed CHESSIGMA_DESKTOP_URL rather than opening a blank window.
try {
  // eslint-disable-next-line no-new
  new URL(APP_ORIGIN);
} catch {
  throw new Error(`Invalid APP_ORIGIN (check CHESSIGMA_DESKTOP_URL): ${APP_ORIGIN}`);
}

// 2. Clean + tag the UA. Throws if the Electron token survives — better a hard
//    startup failure than a shipped build Google refuses to sign in.
const USER_AGENTS = applyUserAgent(app);

// 3. Guards attached centrally, so a window created by the popup factory (or a
//    popup of a popup) can never be created without them.
app.on('web-contents-created', (_event, contents) => {
  attachWindowOpenHandler(contents, {
    createAppWindow,
    shell,
    countWindows: () => BrowserWindow.getAllWindows().length,
  });
  attachNavigationGuards(contents, {
    shell,
    onExternalised: (url) => console.warn(`[chessigma-desktop] navigation sent to OS browser: ${url}`),
    onOAuthHandoff: (url) => beginSignInHandoff(contents, url),
  });
  // webviewTag is already false; this is belt-and-braces.
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Keeps navigator.userAgent honest per document (the header half is applied
  // session-wide below). Must be post-commit; see attachDocumentUserAgent.
  attachDocumentUserAgent(contents, USER_AGENTS);
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) {
    createAppWindow(APP_ORIGIN, { trackState: true });
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // 4. Session policy — per session, not per window, so it must precede the load.
  applyPermissionPolicy(session.defaultSession);
  applyRequestUserAgent(session.defaultSession, USER_AGENTS);

  // 5. macOS copy/paste, select-all and zoom come from the standard menu roles.
  //    A `Menu.setApplicationMenu(null)` shell has broken ⌘C/⌘V — which would
  //    kill every "copy PGN"/"copy link" affordance and every text input.
  Menu.setApplicationMenu(buildMenu());

  // 6. Window state needs `screen`, which needs `ready`.
  createAppWindow(APP_ORIGIN, { trackState: true });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow(APP_ORIGIN, { trackState: true });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * The one and only window factory. Primary window and every popup go through
 * here, so they share webPreferences, background colour, offline handling and
 * (via web-contents-created) the navigation guards.
 *
 * No `partition`: all windows share the default persistent session, which is
 * what keeps the Supabase auth cookie alive across restarts and lets a second
 * window be signed in already.
 */
function createAppWindow(url, options = {}) {
  const { trackState = false } = options;
  const { screen } = require('electron'); // `screen` is unusable before 'ready'

  const saved = trackState ? windowState.read(app) : null;
  const bounds = saved
    ? windowState.validateBounds(saved.bounds, screen.getAllDisplays(), WINDOW_DEFAULTS)
    : null;

  const win = new BrowserWindow({
    show: false,
    width: WINDOW_DEFAULTS.width,
    height: WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    // Set at construction so the first frame is charcoal, not a white flash.
    backgroundColor: WINDOW_DEFAULTS.backgroundColor,
    // Default OS title bar: this is a web app in a window, not a custom chrome.
    ...(bounds || {}),
    webPreferences: { ...WEB_PREFERENCES },
  });

  attachOfflineFallback(win);
  attachOriginIndicator(win);
  if (trackState) windowState.track(app, win);

  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', show);
  // Failsafe: a charcoal window the user can quit beats no window at all.
  const showDeadline = setTimeout(show, SHOW_WINDOW_DEADLINE_MS);
  win.once('closed', () => clearTimeout(showDeadline));
  // Maximized restores; full-screen deliberately does not (one less way to trap
  // a user in a broken state on a machine whose displays have changed).
  if (saved && saved.isMaximized) win.maximize();

  // loadURL REJECTS on network failure — an uncaught rejection otherwise.
  // did-fail-load has already routed the user to the offline page.
  win.loadURL(url).catch(() => {});

  return win;
}

/**
 * Network failure → local offline page. Renderer crash → one reload.
 *
 * The filters matter more than the fallback: -3 ERR_ABORTED fires whenever a
 * navigation is superseded (a click mid-load, a JS redirect), and sub-resource
 * failures fire constantly. Either one, unfiltered, blanks the app at random.
 *
 * APP_ORIGIN is handed to the page as a query param so its Retry button returns
 * to the origin THIS shell is pointed at — a hard-coded production href would
 * quietly move a `npm run dev` session onto prod mid-debug.
 */
function attachOfflineFallback(win) {
  const contents = win.webContents;

  contents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (!isOfflineFailure(errorCode)) return;
    if (validatedURL && validatedURL.startsWith('file://')) return; // already the offline page
    contents.loadFile(OFFLINE_PAGE, { query: { origin: APP_ORIGIN } }).catch(() => {});
  });

  let recovering = false;
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    if (recovering) return; // reload once, never loop
    recovering = true;
    setTimeout(() => {
      recovering = false;
    }, RENDERER_RECOVERY_COOLDOWN_MS);
    contents.reload();
  });
}

/**
 * Runs the Google sign-in leg in the user's real browser and takes the finished
 * session back over a loopback redirect (see src/auth-handoff.js for the why —
 * short version: Google rejects OAuth in every embedded browser, and no UA or
 * client-hint spelling changes that).
 *
 * One handoff at a time per shell. A second click while one is pending cancels
 * the first, so a user who gave up and pressed the button again does not leave a
 * stale listener holding a live state.
 */
let pendingHandoff = null;

function beginSignInHandoff(contents, authorizeUrl) {
  if (pendingHandoff) pendingHandoff.cancel();

  const next = returnPathFromAuthorizeUrl(authorizeUrl);

  // Park the window on a local waiting page. Without it the click appears to do
  // nothing: the browser opens behind the app and this window stays on /signin.
  contents.loadFile(SIGNING_IN_PAGE, { query: { origin: APP_ORIGIN } }).catch(() => {});

  const handle = startHandoff({
    appOrigin: APP_ORIGIN,
    provider: 'google',
    next,
    shell,
    onToken: (redeemUrl) => {
      pendingHandoff = null;
      if (contents.isDestroyed()) return;
      // Redeeming happens over https, in THIS window, which is what puts the
      // session in the shell's own cookie jar rather than the browser's.
      contents.loadURL(redeemUrl).catch(() => {});
    },
    onFailure: (reason) => {
      pendingHandoff = null;
      console.warn(`[chessigma-desktop] sign-in handoff ended: ${reason}`);
      if (contents.isDestroyed()) return;
      // Never strand the user on the waiting page.
      contents.loadURL(`${APP_ORIGIN}/signin`).catch(() => {});
    },
  });

  pendingHandoff = handle;

  // Close the window mid-flow and the listener would otherwise sit on an open
  // port holding a live state until its 5-minute timeout — with nothing left to
  // deliver the session to. On macOS, closing the last window does not quit the
  // app, so that window is a real one.
  contents.once('destroyed', () => {
    if (pendingHandoff !== handle) return;
    pendingHandoff = null;
    handle.cancel();
  });
}

/**
 * The window has no address bar, so the user's only signal of WHERE they are is
 * the title. Whenever the loaded page is not one of the product's own hosts —
 * Stripe Checkout, Google sign-in, or anything a server 302 dropped us on (see
 * navigation.js rule 2, which deliberately does not gate `will-redirect`) — the
 * real hostname is appended to the title.
 *
 * This is the compensating control for ungated redirects. Without it, a 302 off
 * an allowlisted host renders attacker-controlled HTML in a window that is
 * pixel-identical to the app, and a cloned sign-in form is undetectable.
 *
 * `page-title-updated` must be preventDefault()ed, otherwise Electron overwrites
 * the title with the page's own the instant the document sets it.
 */
function attachOriginIndicator(win) {
  const contents = win.webContents;

  const decorate = (title) => {
    const url = contents.getURL();
    if (!url || url.startsWith('file://') || isAppUrl(url)) return title;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return title;
    }
    return host ? `${title} — ${host}` : title;
  };

  win.on('page-title-updated', (event, title) => {
    const decorated = decorate(title);
    if (decorated === title) return;
    event.preventDefault();
    win.setTitle(decorated);
  });

  // A navigation that never updates the title (a 302 chain landing on a page
  // with the same <title>) would otherwise keep the previous, undecorated one.
  contents.on('did-navigate', () => win.setTitle(decorate(contents.getTitle())));
}

/**
 * Built from standard roles only. The Developer submenu is omitted in packaged
 * builds; everything else is Chromium/OS behaviour we get for free.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Chessigma Website',
          click: () => shell.openExternal(HELP_LINKS.website),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
