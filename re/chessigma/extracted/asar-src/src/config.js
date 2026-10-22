'use strict';

/**
 * Single source of truth for the desktop shell: where it points, which hosts may
 * load INSIDE the window, which permissions exist, and how the window looks.
 * Every other module imports from here — no origin, host, colour or size string
 * is ever repeated elsewhere, because a duplicated allowlist is an allowlist
 * that will drift.
 *
 * The shell is CONTENT-FREE: it loads the live production web app, exactly like
 * mobile/capacitor.config.ts does for Capacitor. Prod deploys ARE the update, so
 * this file (and the shell around it) should almost never need to change.
 *
 *   Default origin : https://www.chessigma.com                (production)
 *   Local dev      : CHESSIGMA_DESKTOP_URL=http://localhost:3000
 *                    (mirrors mobile's CHESSIGMA_SERVER_URL override)
 */

/** The one origin every shipped build points at. */
const PRODUCTION_ORIGIN = 'https://www.chessigma.com';

/**
 * True in a packaged .app/.exe; false under `electron .` and under plain Node.
 *
 * This is `app.isPackaged`'s own implementation (`!process.defaultApp`), read
 * straight off `process` so this file stays loadable under `node --test` —
 * requiring the electron module here would drag an Electron binary into the unit
 * tests, which is exactly what the pure/wired split exists to avoid. The
 * `process.versions.electron` guard is what keeps it correct outside Electron,
 * where `defaultApp` is always undefined and a bare `!` would report "packaged".
 */
const IS_PACKAGED = Boolean(process.versions.electron) && !process.defaultApp;

/**
 * Where the shell points. Trimmed because a trailing space breaks new URL().
 *
 * CHESSIGMA_DESKTOP_URL is a DEVELOPMENT affordance and is ignored in packaged
 * builds. That guard is load-bearing, not tidiness: APP_ORIGIN's host is treated
 * as INTERNAL, so honouring an env var inside a signed, notarized app would let
 * any process running as the user — `launchctl setenv` on macOS, `HKCU\Environment`
 * on Windows, `~/.zshenv` on Linux, none of which need admin — repoint the app at
 * their origin and render it full-page in a window that has no address bar.
 * Tampering with the bundle breaks the code signature; setting an env var does
 * not, so the signature is only worth what this guard makes it worth.
 */
function resolveAppOrigin(env = process.env, isPackaged = IS_PACKAGED) {
  const override = (env.CHESSIGMA_DESKTOP_URL || '').trim();
  return !override || isPackaged ? PRODUCTION_ORIGIN : override;
}

const APP_ORIGIN = resolveAppOrigin();

/** The UA marker the web app parses (lib/desktop-mode-ua.ts). Never rename. */
const DESKTOP_UA_TAG = 'Chessigma-Desktop';

// ── Host allowlists ───────────────────────────────────────────────────────────
// Exact hostnames only. No suffix matching, ever: `endsWith('.chessigma.com')`
// would accept `www.chessigma.com.evil.com`, and `.includes()` would accept
// `https://evil.com/?u=www.chessigma.com`.

/** The product itself, plus the apex that 301s to it. */
const APP_HOSTS = ['www.chessigma.com', 'chessigma.com'];

/**
 * Google sign-in. These hosts get the CLEAN Chrome UA (no Chessigma token) —
 * Google blocks sign-in from anything that identifies as an embedded framework,
 * and an unknown product token on a Chrome-shaped UA is exactly the signal a
 * heuristic could latch onto. accounts.youtube.com is Google's cookie-sync hop.
 */
const AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com'];

/**
 * The Supabase GoTrue project host. Step 2 of Google sign-in is a *page-initiated*
 * navigation to /auth/v1/authorize (supabase-js does `window.location.assign`),
 * so it hits will-navigate — omit this host and sign-in dies on the first click.
 *
 * ⚠️ SYNC POINT. This duplicates the host inside the web app's
 * `NEXT_PUBLIC_SUPABASE_URL`, and nothing enforces the pairing: the web app reads
 * an env var at build time, the shell has this literal compiled into every
 * installed binary. Changing Supabase projects therefore needs a new desktop
 * RELEASE, not just a Vercel env change — and until users install it, Google
 * sign-in breaks for them (email OTP keeps working, since it never leaves the
 * app origin). This is one of only two values shared across the boundary; the
 * other, the UA tag, IS pinned by desktop/test/web-contract.test.js.
 */
const SUPABASE_HOSTS = ['ozvvyafyqcgjftdotcae.supabase.co'];

/**
 * Hosted Checkout + hosted Billing Portal are full-page `window.location.href`
 * assignments; there is no Stripe.js / Elements anywhere in the web app.
 * billing.stripe.com is required even for a pure "buy" button, because
 * /api/stripe/create-checkout returns a PORTAL url for subscription plan changes.
 */
const STRIPE_HOSTS = [
  'checkout.stripe.com',
  'js.stripe.com',
  'hooks.stripe.com',
  'billing.stripe.com',
];

/** Everything allowed to load in-window over https. */
const INTERNAL_HOSTS = new Set([
  ...APP_HOSTS,
  ...AUTH_HOSTS,
  ...SUPABASE_HOSTS,
  ...STRIPE_HOSTS,
]);

/**
 * Hosts that are internal ONLY because the operator pointed the shell somewhere
 * else with CHESSIGMA_DESKTOP_URL. Always empty in a packaged build, because
 * resolveAppOrigin() has already dropped the override there.
 *
 * Two sets because the matching key differs by protocol. http:// is a downgrade,
 * so it is matched on host:PORT — `http://localhost:9999` stays blocked when the
 * shell was pointed at `http://localhost:3000`. https:// previews (a Vercel
 * deployment URL) are matched on hostname, like every other https entry.
 */
const DEV_HTTP_HOSTS = new Set();
const DEV_HTTPS_HOSTS = new Set();
try {
  const origin = new URL(APP_ORIGIN);
  if (origin.protocol === 'http:') DEV_HTTP_HOSTS.add(origin.host);
  else if (origin.protocol === 'https:') DEV_HTTPS_HOSTS.add(origin.hostname);
} catch {
  /* main.js validates APP_ORIGIN at startup and fails loudly. */
}

/**
 * Protocols the shell will hand to the OS. `mailto:` is load-bearing — the
 * Support button and the Supercoach report error boundary both window.open a
 * mailto: URL, and an http/https-only filter turns them into silent no-ops.
 * `http:` is deliberately absent: the product is https-only, so a plaintext
 * outbound link is a smell. Everything else (file:, smb:, ms-msdt:, javascript:)
 * is a documented RCE vector through shell.openExternal.
 */
const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:']);

/** Guard against handler-argument overflow in the OS URL dispatcher. */
const MAX_EXTERNAL_URL_LENGTH = 2048;

// ── Window ────────────────────────────────────────────────────────────────────

/**
 * backgroundColor is DESIGN.md charcoal (`surface.page`) so the very first frame
 * is charcoal rather than a white flash. Min size keeps the app above the width
 * where the web layout starts folding into its mobile treatment.
 */
const WINDOW_DEFAULTS = {
  width: 1280,
  height: 860,
  minWidth: 880,
  minHeight: 620,
  backgroundColor: '#171717',
};

/**
 * webPreferences, spelled out even where it matches the Electron 43 default —
 * this is the security posture and it should be readable in one place rather
 * than inferred from version history. There is NO preload and NO IPC, so the
 * whole renderer→main privilege-escalation class does not exist in this app.
 * `webSecurity` is deliberately absent: never set it, never disable it.
 */
const WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  spellcheck: true,
};

// ── Session policy ────────────────────────────────────────────────────────────

/**
 * Clipboard only, as an ALLOW-SET rather than a deny-list: Chromium emits
 * permission names that are not in Electron's documented union (observed:
 * `web-app-installation`, `background-sync`) and new ones ship with every
 * Chromium bump, so a switch over known strings would silently grant them.
 * The web app has ~20 clipboard writes and zero reads, and zero call sites for
 * notifications / geolocation / getUserMedia / fullscreen — denying the rest costs
 * nothing. `deprecated-sync-clipboard-read` is CHECK-only (document.execCommand).
 */
const ALLOWED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
]);

/**
 * did-fail-load codes that must NOT show the offline page. A DENY-list, not an
 * allow-list, and that direction is the whole point: Electron ships no built-in
 * net-error page (Chromium's live in //chrome, not //content), so any main-frame
 * failure we do not catch paints nothing at all — a solid charcoal rectangle
 * with no text and no way out. An allow-list of "network is gone" codes silently
 * does that to every family it forgot, and the ones it forgets are the ones that
 * matter: -200/-201/-202 (corporate TLS-inspecting proxy, skewed clock),
 * -107 ERR_SSL_PROTOCOL_ERROR, -104 ERR_CONNECTION_FAILED, -324 ERR_EMPTY_RESPONSE.
 *
 *   -3  ERR_ABORTED           — fires whenever a navigation is superseded (a
 *                               click mid-load, a JS redirect). The #1 cause of
 *                               spurious offline pages.
 *   -20 ERR_BLOCKED_BY_CLIENT — a blocked sub-resource.
 *
 * HTTP 4xx/5xx never emit did-fail-load at all, so Vercel error pages render
 * normally and never reach this filter.
 */
const NON_OFFLINE_ERROR_CODES = new Set([
  -3, // ERR_ABORTED
  -20, // ERR_BLOCKED_BY_CLIENT
]);

/** True when a main-frame did-fail-load should fall back to the offline page. */
function isOfflineFailure(errorCode) {
  if (typeof errorCode !== 'number' || errorCode >= 0) return false;
  return !NON_OFFLINE_ERROR_CODES.has(errorCode);
}

/**
 * Ceiling on simultaneously open app windows. Electron has no popup blocker, so
 * without a cap one compromised script can spawn BrowserWindows until the
 * machine swaps. Well above any real use (the only in-app popups are
 * `window.open('/games/<id>')` from the coach panel and report deep links).
 */
const MAX_APP_WINDOWS = 8;

/**
 * Help menu target. Always the public site, never APP_ORIGIN — a dev build's
 * Help menu pointing at localhost would be a confusing surprise. There is no
 * "Support" entry on purpose: support is a `mailto:` the web app already renders
 * (config.crisp.id is empty, so ButtonSupport falls through to mail), and that
 * path already works from inside the shell.
 */
const HELP_LINKS = {
  website: 'https://www.chessigma.com/',
};

// ── Sign-in handoff ───────────────────────────────────────────────────────────

/**
 * Google refuses OAuth inside ANY embedded browser and answers "This browser or
 * app may not be secure" at the identifier step. That is not a user-agent
 * problem and cannot be spelled around: the shell already presents a
 * byte-identical Chrome UA with no Electron token, and injecting Chrome's UA
 * client hints on top of it changes nothing (both verified against the live
 * flow). It is a deliberate anti-phishing control on embedded user-agents.
 *
 * So the Google leg does not run in this window at all. The shell hands it to
 * the system browser and takes the finished session back over a loopback
 * redirect — RFC 8252, the same shape Slack/Notion/Linear use. The web-side
 * contract lives in lib/auth/desktop-handoff.ts.
 *
 * ⚠️ SYNC POINT with that file: the parameter names and the state format are
 * agreed across the boundary and pinned by desktop/test/web-contract.test.js.
 */
const OAUTH_AUTHORIZE_PATH = '/auth/v1/authorize';

/** Only Google blocks embedded browsers; nothing else is diverted. */
const HANDOFF_PROVIDERS = new Set(['google']);

/**
 * The shell listens here for the browser's hand-back. 127.0.0.1 literal, not
 * `localhost`: binding by name can land on ::1 or follow a hosts-file override,
 * and the web side hard-codes the same literal when it builds the redirect.
 */
const LOOPBACK_HOST = '127.0.0.1';

/**
 * How long the loopback listener stays open. Generous because the user may have
 * to pick an account, do 2FA, or find the browser window — but bounded, because
 * an open port with a pending state is not something to leave lying around.
 */
const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;

module.exports = {
  PRODUCTION_ORIGIN,
  IS_PACKAGED,
  resolveAppOrigin,
  APP_ORIGIN,
  DESKTOP_UA_TAG,
  APP_HOSTS,
  AUTH_HOSTS,
  SUPABASE_HOSTS,
  STRIPE_HOSTS,
  INTERNAL_HOSTS,
  DEV_HTTP_HOSTS,
  DEV_HTTPS_HOSTS,
  EXTERNAL_PROTOCOLS,
  MAX_EXTERNAL_URL_LENGTH,
  WINDOW_DEFAULTS,
  WEB_PREFERENCES,
  ALLOWED_PERMISSIONS,
  MAX_APP_WINDOWS,
  NON_OFFLINE_ERROR_CODES,
  isOfflineFailure,
  HELP_LINKS,
  OAUTH_AUTHORIZE_PATH,
  HANDOFF_PROVIDERS,
  LOOPBACK_HOST,
  HANDOFF_TIMEOUT_MS,
};
