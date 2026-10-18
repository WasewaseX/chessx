'use strict';

/**
 * Sign-in handoff: the Google leg runs in the user's real browser, and the
 * finished session comes back to this shell over a loopback redirect.
 *
 * Google refuses OAuth inside any embedded browser — "This browser or app may
 * not be secure", served at the identifier step. It is not a user-agent problem:
 * the shell already presents a byte-identical Chrome UA with no Electron token,
 * and adding Chrome's UA client hints on top changes nothing (both verified
 * against the live flow before this module was written). It is a deliberate
 * anti-phishing control, and the sanctioned answer is RFC 8252 — the same shape
 * Slack, Notion and Linear use.
 *
 * Sequence:
 *   1. bind an ephemeral listener on 127.0.0.1 (port 0 → the OS picks)
 *   2. mint 16 random bytes of `state`
 *   3. open the SYSTEM browser at /signin?desktop_port&desktop_state&provider
 *   4. the browser signs in completely normally — same PKCE, same cookies
 *   5. /api/auth/callback mints a single-use token and redirects here
 *   6. verify `state`, then load /api/auth/desktop?token_hash=… IN THE SHELL,
 *      which is what puts the session in this app's cookie jar
 *
 * The web half of the contract is lib/auth/desktop-handoff.ts.
 *
 * Security posture:
 *   • the listener binds to the loopback interface ONLY, so nothing off-machine
 *     can reach it, and it is open for at most HANDOFF_TIMEOUT_MS
 *   • `state` is compared in constant time, so the port cannot be probed for a
 *     valid state by timing
 *   • the listener is strictly single-use: the first VALID hand-back closes it,
 *     and a late or forged request finds nothing listening
 *   • the token in the URL is single-use and short-lived, and is redeemed over
 *     https by the shell itself
 */

const http = require('http');
const crypto = require('crypto');

const { LOOPBACK_HOST, HANDOFF_TIMEOUT_MS } = require('./config');

// ── Pure layer (no electron, no sockets — unit-testable) ──────────────────────

/** 16 bytes hex — the format lib/auth/desktop-handoff.ts validates. */
function createState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Length-safe constant-time compare. `timingSafeEqual` THROWS on a length
 * mismatch, which would both crash the listener and leak length by exception.
 */
function statesMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Where the system browser is sent to start the flow. */
function buildBrowserSignInUrl(appOrigin, { port, state, provider, next }) {
  const url = new URL('/signin', appOrigin);
  url.searchParams.set('desktop_port', String(port));
  url.searchParams.set('desktop_state', state);
  url.searchParams.set('provider', provider);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/** Where the shell navigates once it holds a valid token. */
function buildRedeemUrl(appOrigin, tokenHash, next) {
  const url = new URL('/api/auth/desktop', appOrigin);
  url.searchParams.set('token_hash', tokenHash);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/**
 * Parses one loopback request into a verdict. Split out from the server so the
 * matching rules are testable without binding a port.
 *
 * Returns `{ ok: true, tokenHash, next }` or `{ ok: false, reason }`.
 */
function readHandoffRequest(requestUrl, expectedState) {
  let url;
  try {
    url = new URL(requestUrl, `http://${LOOPBACK_HOST}`);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (url.pathname !== '/callback') return { ok: false, reason: 'not-callback' };
  if (!statesMatch(expectedState, url.searchParams.get('state') || '')) {
    return { ok: false, reason: 'bad-state' };
  }
  const tokenHash = url.searchParams.get('token_hash');
  if (!tokenHash) return { ok: false, reason: 'no-token' };
  const next = url.searchParams.get('next');
  return {
    ok: true,
    tokenHash,
    next: next && next.startsWith('/') && !next.startsWith('//') ? next : null,
  };
}

const DONE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in — Chessigma</title>
<style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       background:#171717;color:#e5e5e5;
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{text-align:center;padding:40px}
  h1{margin:0 0 8px;font-size:20px;color:#fff}
  p{margin:0;color:#a3a3a3}
</style></head>
<body><div class="card"><h1>You're signed in</h1>
<p>Chessigma is ready on your desktop. You can close this tab.</p></div></body></html>`;

// ── Electron / socket wiring ──────────────────────────────────────────────────

/**
 * Opens the loopback listener, launches the browser, and resolves the flow by
 * calling `onToken(redeemUrl)`.
 *
 * `onFailure(reason)` fires on timeout or a launch error so the caller can put
 * the window back somewhere useful instead of leaving a dead waiting screen.
 *
 * Returns a `cancel()` for the user-initiated case.
 */
function startHandoff({ appOrigin, provider, next, shell, onToken, onFailure }) {
  const state = createState();
  let settled = false;

  const server = http.createServer((req, res) => {
    const verdict = readHandoffRequest(req.url, state);

    if (!verdict.ok) {
      // Give nothing away about WHY: this port is reachable by any local
      // process, and a descriptive error is a probing oracle.
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DONE_PAGE);

    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // `close()` stops new connections; the browser's socket may linger on
    // keep-alive, so unref the server rather than waiting for it.
    server.close();
    onToken(buildRedeemUrl(appOrigin, verdict.tokenHash, verdict.next || next));
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    server.close();
    onFailure('timeout');
  }, HANDOFF_TIMEOUT_MS);
  // Never hold the process open on this listener alone.
  if (typeof timer.unref === 'function') timer.unref();

  server.on('error', (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    console.error('[chessigma-desktop] handoff listener failed:', err.message);
    onFailure('listen-failed');
  });

  // Port 0: the OS assigns a free port, so two shells (or a shell and any other
  // app) can never collide on a fixed one.
  server.listen(0, LOOPBACK_HOST, () => {
    const { port } = server.address();
    const target = buildBrowserSignInUrl(appOrigin, { port, state, provider, next });
    Promise.resolve(shell.openExternal(target)).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      console.error('[chessigma-desktop] could not open the browser:', err.message);
      onFailure('browser-launch-failed');
    });
  });

  return {
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
    },
  };
}

module.exports = {
  createState,
  statesMatch,
  buildBrowserSignInUrl,
  buildRedeemUrl,
  readHandoffRequest,
  startHandoff,
};
