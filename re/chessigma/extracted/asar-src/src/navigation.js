'use strict';

/**
 * What may load INSIDE the shell window, what gets handed to the system browser,
 * and what is dropped on the floor — plus the deny-by-default permission policy.
 *
 * Two rules define the posture:
 *
 *   1. Enforce on `will-navigate` (MAIN FRAME ONLY) + `setWindowOpenHandler`.
 *   2. Do NOT enforce on `will-redirect` or `will-frame-navigate`.
 *
 * Rule 2 is not laziness, it is the money path. Server 302s fire `will-redirect`
 * only — the Google OAuth chain, the Supabase callback leg and the Discord OAuth
 * round trip are all pure 302 chains, and severing one mid-flight strands the
 * user with no recovery. Sub-frames fire `will-frame-navigate` — and Stripe's
 * 3DS challenge renders in an iframe that navigates to the issuing bank's ACS
 * domain, an unbounded set nobody can allowlist. Gating either event breaks
 * sign-in or card payments silently, in production.
 *
 * The residual exposure of rule 2 is a 302 landing a non-allowlisted page in the
 * window. That page runs in a sandboxed, context-isolated renderer with no
 * preload, no IPC and no Node, so it gains no CAPABILITY a browser tab would not
 * — but it does gain something a browser tab never gives it: this window has no
 * address bar, so a redirected page is visually indistinguishable from the app.
 * The compensating control is the origin indicator in main.js, which puts the
 * real host in the title bar whenever it is not chessigma.com. Do not remove one
 * without the other.
 *
 * The classifiers are PURE (no require('electron') at module scope) so the unit
 * tests never need an Electron binary; the wiring below takes Electron objects
 * as parameters.
 */

const {
  INTERNAL_HOSTS,
  DEV_HTTP_HOSTS,
  DEV_HTTPS_HOSTS,
  APP_HOSTS,
  SUPABASE_HOSTS,
  EXTERNAL_PROTOCOLS,
  MAX_EXTERNAL_URL_LENGTH,
  ALLOWED_PERMISSIONS,
  MAX_APP_WINDOWS,
  OAUTH_AUTHORIZE_PATH,
  HANDOFF_PROVIDERS,
} = require('./config');

// ── Pure classifiers ──────────────────────────────────────────────────────────

function parseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * True when the URL may load in the app window.
 *
 * Exact-hostname matching via `new URL().hostname` + `Set.has` — which is what
 * makes `https://www.chessigma.com.evil.com` and `https://evil.com/?u=www.chessigma.com`
 * both fail. https is required; http is accepted only for the exact host:port of
 * an explicit `CHESSIGMA_DESKTOP_URL` dev origin, so prod can never downgrade.
 */
function isInternalUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol === 'https:') {
    return INTERNAL_HOSTS.has(url.hostname) || DEV_HTTPS_HOSTS.has(url.hostname);
  }
  if (url.protocol === 'http:') return DEV_HTTP_HOSTS.has(url.host);
  return false;
}

/**
 * True for the product's own hosts — the ONLY hosts whose pages may render
 * without the title-bar origin indicator (see attachOriginIndicator in main.js).
 * Narrower than isInternalUrl on purpose: Stripe Checkout and Google sign-in are
 * allowed in-window, but the user should still be told they are on stripe.com.
 */
function isAppUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol === 'https:') {
    return APP_HOSTS.includes(url.hostname) || DEV_HTTPS_HOSTS.has(url.hostname);
  }
  if (url.protocol === 'http:') return DEV_HTTP_HOSTS.has(url.host);
  return false;
}

/**
 * True for the Supabase call that STARTS an OAuth provider sign-in whose
 * provider refuses to run in an embedded browser (today: Google only).
 *
 * supabase-js does a page-initiated `window.location.assign` to
 * `https://<project>.supabase.co/auth/v1/authorize?provider=google&…`, so this
 * is the one point where the shell can still take over — after it, the user is
 * on Google's domain and it is too late.
 *
 * Deliberately narrow. It matches the authorize endpoint on the KNOWN Supabase
 * host and an explicitly listed provider, so `/auth/v1/callback`, magic links,
 * email OTP and any future provider that works fine in-window are all untouched
 * and keep loading in the app.
 */
function isHandoffOAuthStart(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol !== 'https:') return false;
  if (!SUPABASE_HOSTS.includes(url.hostname)) return false;
  if (url.pathname !== OAUTH_AUTHORIZE_PATH) return false;
  return HANDOFF_PROVIDERS.has((url.searchParams.get('provider') || '').toLowerCase());
}

/**
 * The `next` the web app was going to land on, recovered from the authorize
 * URL's own `redirect_to`. Without it a user who signed in from a deep link
 * would come back to the dashboard instead of where they were.
 */
function returnPathFromAuthorizeUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return null;
  const redirectTo = url.searchParams.get('redirect_to');
  if (!redirectTo) return null;
  let next = null;
  try {
    next = new URL(redirectTo).searchParams.get('next');
  } catch {
    return null;
  }
  // Site-relative only — this ends up in a URL we construct.
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

/**
 * True when the URL is safe to hand to the OS.
 *
 * shell.openExternal is the single most dangerous call in this shell — it is
 * invoked with page-controlled URLs, and `file://`, `smb://` and Windows'
 * `ms-msdt:` / `search-ms:` handlers are documented RCE paths. Allow-set only.
 */
function isSafeExternalUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false;
  if (url.protocol === 'https:' && !url.hostname) return false;
  return rawUrl.length < MAX_EXTERNAL_URL_LENGTH;
}

/**
 * The single decision function every call site shares.
 *   'internal' → load it (or open a new app window for it)
 *   'external' → hand it to the OS browser / mail client
 *   'block'    → drop it
 */
function classifyNavigation(rawUrl) {
  if (isInternalUrl(rawUrl)) return 'internal';
  if (isSafeExternalUrl(rawUrl)) return 'external';
  return 'block';
}

// ── Electron wiring ───────────────────────────────────────────────────────────

/**
 * Never returns `{action:'allow'}`.
 *
 * `allow` hands window creation to Chromium, which merges the page-supplied
 * `features` string ("width=400,height=300,...") into the child's
 * BrowserWindowConstructorOptions — a page-controlled surface. Deny always, and
 * build the window ourselves with the same factory, so a popup-of-a-popup
 * inherits the identical webPreferences and guards.
 *
 * Must return on EVERY path: an unrecognised return value (or a throw) is only
 * as good as a deny plus a console error.
 *
 * The internal branch is load-bearing, not theoretical — the coach panel does
 * `window.open('/games/<id>?...', '_blank')` and the Supercoach report is full of
 * `target="_blank"` deep links into /games/<id>. Those must stay in the app.
 */
function attachWindowOpenHandler(contents, { createAppWindow, shell, countWindows }) {
  contents.setWindowOpenHandler((details) => {
    const verdict = classifyNavigation(details.url);
    // Electron ships no popup blocker. Without a ceiling, one compromised script
    // can loop window.open() until the machine swaps, or spam the OS browser.
    if (typeof countWindows === 'function' && countWindows() >= MAX_APP_WINDOWS) {
      return { action: 'deny' };
    }
    // setImmediate keeps window creation off the synchronous, renderer-blocking path.
    if (verdict === 'internal') setImmediate(() => createAppWindow(details.url));
    else if (verdict === 'external') setImmediate(() => shell.openExternal(details.url));
    return { action: 'deny' };
  });
}

/**
 * Main-frame allowlist on `will-navigate` only (see the file header for why
 * `will-redirect` and `will-frame-navigate` are deliberately unguarded).
 *
 * `will-navigate` does not fire for `webContents.loadURL`, so the shell's own
 * initial load and its offline-recovery load can never be self-blocked.
 *
 * Uses `details.*`; the trailing positional params are deprecated in Electron 43.
 */
function attachNavigationGuards(contents, { shell, onExternalised, onOAuthHandoff }) {
  contents.on('will-navigate', (details) => {
    if (!details.isMainFrame) return;
    // Checked BEFORE the allowlist: the Supabase authorize host is internal, so
    // an allowlist-first order would let the Google leg load in-window and get
    // rejected. This is the last moment the shell still owns the navigation.
    if (typeof onOAuthHandoff === 'function' && isHandoffOAuthStart(details.url)) {
      details.preventDefault();
      onOAuthHandoff(details.url);
      return;
    }
    if (isInternalUrl(details.url)) return;
    details.preventDefault();
    if (isSafeExternalUrl(details.url)) shell.openExternal(details.url);
    // Externalising a navigation is normal for a marketing link and a BUG for an
    // auth or checkout leg — the window just sits on the old page either way, so
    // allowlist drift (Google adding a 2SV host, Stripe adding a subdomain) is
    // otherwise invisible. Surfaced, not swallowed.
    if (typeof onExternalised === 'function') onExternalised(details.url);
  });
}

/**
 * Deny-by-default permissions, applied once per SESSION (not per window).
 * Both handlers are required: most web APIs do a permission *check* and only
 * fall back to a *request* when the check is denied. Each callback must fire
 * exactly once or the web API stays pending forever.
 *
 * Note: clipboard writes still fail with NotAllowedError on an unfocused window.
 * That is Chromium's "document must be focused" rule, not this policy — do not
 * chase it as a permission bug.
 */
function applyPermissionPolicy(ses) {
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  ses.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );

  // WebUSB / WebHID / Web Serial bypass the permission handlers entirely.
  ses.setDevicePermissionHandler(() => false);
  // getDisplayMedia(): deny by calling back with an empty stream object.
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

module.exports = {
  isInternalUrl,
  isAppUrl,
  isSafeExternalUrl,
  isHandoffOAuthStart,
  returnPathFromAuthorizeUrl,
  classifyNavigation,
  attachWindowOpenHandler,
  attachNavigationGuards,
  applyPermissionPolicy,
};
