'use strict';

/**
 * The user-agent contract between this shell and the web app.
 *
 * The shell presents a VANILLA CHROME UA with one appended token:
 *
 *   <clean Chrome UA> Chessigma-Desktop/<version> (<platform>; <arch>)
 *
 * The web app matches that token (lib/desktop-mode-ua.ts, /Chessigma-Desktop\//)
 * to suppress ads and register desktop telemetry. Everything else about the
 * request must be indistinguishable from Chrome, for one reason: Google blocks
 * OAuth sign-in from anything that identifies as an embedded framework, and
 * Electron's default UA carries TWO disqualifying tokens — ` Electron/<ver>` and
 * an auto-inserted ` <app-name>/<app-version>`.
 *
 * EVERY OTHER HOST sees a byte-identical Chrome UA, in the request header AND in
 * `navigator.userAgent`. That default is the important half: Electron's own UA
 * carries two disqualifying tokens (` Electron/<ver>` and an auto-inserted
 * ` <app-name>/<app-version>`), but the trap is broader than Electron. Our own
 * token was enough for Google to serve "This browser or app may not be secure"
 * at the credential step, so third parties are shown nothing at all.
 *
 * The top half of this file is PURE — no require('electron') at module scope —
 * so `node --test` can exercise it with literal strings and no Electron binary.
 * The Electron wiring at the bottom takes its objects as parameters.
 */

const { DESKTOP_UA_TAG } = require('./config');
const { isAppUrl } = require('./navigation');

// ── Pure layer ────────────────────────────────────────────────────────────────

/**
 * Turns Electron's default UA into a vanilla-Chrome UA.
 *
 * Electron builds its UA as:
 *   Mozilla/5.0 (<frozen platform>) AppleWebKit/537.36 (KHTML, like Gecko)
 *   <AppName>/<AppVersion> Chrome/<ver> Electron/<ver> Safari/537.36
 *
 * The strip is SHAPE-based, not name-based, and that is the whole point: if
 * anyone ever adds `productName` to package.json (electron-builder commonly
 * wants one) the app token silently becomes `Chessigma/1.0.0`, and a hard-coded
 * `/chessigma-desktop\//` strip would keep "working" while shipping `Electron/`
 * straight to Google. `appName`/`appVersion` are accepted as an optional
 * belt-and-braces second pass, never as the primary mechanism.
 *
 * Idempotent: an already-clean Chrome UA passes through unchanged.
 */
function cleanUserAgent(rawUserAgent, appName, appVersion) {
  let ua = String(rawUserAgent || '');

  // 1. Drop `Electron/<version>` wherever it sits.
  ua = ua.replace(/\sElectron\/\S+/g, '');

  // 2. Optional literal pass, when the caller knows the app token.
  if (appName) {
    const name = escapeRegExp(String(appName).replace(/\s+/g, ''));
    const version = appVersion ? escapeRegExp(String(appVersion)) : '\\S+';
    ua = ua.replace(new RegExp(`\\s${name}/${version}`, 'gi'), '');
  }

  // 3. Shape pass: everything Electron inserted between the "(KHTML, like Gecko)"
  //    marker and "Chrome/". Nothing legitimate lives in that slot.
  ua = ua.replace(/(\(KHTML, like Gecko\) )(?:(?!Chrome\/)\S+ )+(?=Chrome\/)/, '$1');

  return ua.replace(/\s{2,}/g, ' ').trim();
}

/** The `<platform>` token: exactly one of macos | windows | linux. */
function platformTag(platform) {
  const value = platform || process.platform;
  if (value === 'darwin') return 'macos';
  if (value === 'win32') return 'windows';
  return 'linux';
}

/** `<clean Chrome UA> Chessigma-Desktop/<version> (<platform>; <arch>)`. */
function buildUserAgent(baseUserAgent, version, platform, arch) {
  const tag = platformTag(platform);
  const cpu = arch || process.arch;
  return `${baseUserAgent} ${DESKTOP_UA_TAG}/${version} (${tag}; ${cpu})`;
}

/**
 * The one invariant that breaks Google sign-in SILENTLY. Called on every start
 * and asserted in the unit tests; a throw here is preferable to a shipped build
 * that shows users "This browser or app may not be secure".
 */
function assertNoElectronToken(userAgent) {
  if (/Electron\//i.test(userAgent)) {
    throw new Error(`cleanUserAgent failed to strip the Electron token: ${userAgent}`);
  }
  return userAgent;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Electron wiring ───────────────────────────────────────────────────────────

/**
 * Sets the session-wide UA. Must run at MODULE SCOPE in main.js, before `ready`.
 *
 * `app.userAgentFallback` is the only hook that is both global and
 * order-independent — it propagates to the default session, to any
 * `persist:` partition, and to every webContents created later.
 * `session.setUserAgent()` explicitly does not affect existing WebContents and
 * pins the session (which would make this assignment silently ineffective), and
 * `webContents.setUserAgent()` is per-page. Do not add either.
 *
 * Returns both variants. The tagged one is the fallback because the first load
 * is always our own origin; everything else is corrected per navigation.
 */
function applyUserAgent(app) {
  const clean = assertNoElectronToken(
    cleanUserAgent(app.userAgentFallback, app.getName(), app.getVersion())
  );
  const tagged = buildUserAgent(clean, app.getVersion());
  app.userAgentFallback = tagged;
  return { clean, tagged };
}

/** The UA a given URL should be seen with. Only our own hosts get the token. */
function userAgentFor(url, { clean, tagged }) {
  return isAppUrl(url) ? tagged : clean;
}

/**
 * Request-header half: no third party ever receives the Chessigma token.
 *
 * This used to be scoped to Google's auth hosts only, which was an allowlist of
 * one vendor. Any other host that sniffs user agents would have broken the same
 * way, so the rule is inverted: tagged for us, vanilla Chrome for everyone else.
 *
 * This is the ONLY onBeforeSendHeaders listener the shell will ever install.
 * Electron keeps just the last one attached per session, so a second listener
 * anywhere silently disables this one.
 */
function applyRequestUserAgent(ses, agents) {
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    // The callback MUST fire exactly once on every path or the request hangs.
    callback({
      requestHeaders: { ...details.requestHeaders, 'User-Agent': userAgentFor(details.url, agents) },
    });
  });
}

/**
 * Document half: `navigator.userAgent` inside the loaded page.
 *
 * The header rewrite alone is NOT enough. Google's sign-in page loads fine with
 * a clean header and then blocks at the credential step by reading
 * navigator.userAgent from JS, which still reported our token.
 *
 * It has to run on `did-navigate`, i.e. AFTER the document commits. Calling
 * setUserAgent from `will-navigate`, `will-redirect` or `did-start-navigation`
 * aborts the navigation outright (net::ERR_ABORTED, verified). Post-commit it
 * updates the live document immediately, with no reload and no abort.
 */
function attachDocumentUserAgent(contents, agents) {
  const sync = (url) => {
    const wanted = userAgentFor(url, agents);
    if (contents.getUserAgent() !== wanted) contents.setUserAgent(wanted);
  };
  contents.on('did-navigate', (_event, url) => sync(url));
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) sync(url);
  });
  return sync;
}

module.exports = {
  cleanUserAgent,
  platformTag,
  buildUserAgent,
  assertNoElectronToken,
  userAgentFor,
  applyUserAgent,
  applyRequestUserAgent,
  attachDocumentUserAgent,
};
