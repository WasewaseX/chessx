# ChessX Desktop Shell

An Electron shell around the ChessX web app: one hardened Chromium window,
no preload scripts, no custom IPC. The web app is the product; the shell's
whole job is to render it safely on the desktop and to keep the player's
sign-in alive.

## Run it

```bash
cd desktop
npm install        # downloads Electron (dev dependency, the only one)
npm run dev        # loads http://localhost:3000 (the local web app)
npm start          # loads the production origin baked into src/config.js
```

`npm run dev` sets `CHESSX_DESKTOP_URL=http://localhost:3000` for you. Point
it at any other deployment by exporting `CHESSX_DESKTOP_URL` yourself — but
only unpackaged builds honor that variable.

`npm run dist` is a deliberate placeholder: packaging (electron-builder or
packager, icons, code signing) is out of scope for this scaffold.

## What works

- **Hardened window**: sandboxed renderer, context isolation, no
  `nodeIntegration`, no `<webview>` (attachment is refused from any page),
  deny-by-default permission policy (clipboard read/write only), device
  permissions refused, display-media requests get an empty stream.
- **Navigation boundaries**: main-frame navigations are gated to the app's
  exact hostnames; popups are never allowed to open as popups — app URLs are
  rebuilt as real shell windows (capped at 8) and safe `https:`/`mailto:`
  targets go to the system browser. Redirects and subframes are deliberately
  not gated so OAuth and payment 302 chains keep working.
- **User-Agent contract**: Electron's identity tokens are stripped with a
  shape-based cleaner (with a loud assertion in dev), so every third party
  sees a normal Chrome UA. App hosts additionally get
  `ChessX-Desktop/<version> (<platform>; <arch>)` appended.
- **Resilience**: main-frame load failures (minus a deny-list of "not really
  offline" codes) land on a local offline page whose Retry button reloads the
  `?origin=` target; a renderer crash triggers exactly one automatic reload
  per 30 seconds.
- **Window state**: geometry is persisted (versioned, atomically written,
  debounced) and only restored when it provably overlaps a display by at
  least 120×60 — the shell never invents x/y.
- **Origin indicator**: the window title stays the page title on app hosts
  and grows ` — <host>` whenever the shell is showing any other origin.
- **Google sign-in handoff (RFC 8252)**: see below. Requires the web-side
  routes listed at the bottom — they are implemented in this repository.

## Google sign-in, end to end

1. You click "Continue with Google" in the shell. The web app returns the
   accounts.google.com authorize URL; the moment the shell's window is sent
   there, the shell cancels the inline navigation, parks the window on
   `signing-in.html`, and starts a loopback listener on `127.0.0.1` with an
   ephemeral port and a 16-byte state.
2. The system browser (which owns your Google session) opens
   `/signin?desktop_port=…&desktop_state=…` on the web app and starts a fresh
   Google flow carrying those values.
3. The OAuth callback on the web side detects the desktop handoff, mints a
   single-use token (only its SHA-256 is stored, 5-minute expiry) and
   redirects the system browser to
   `http://127.0.0.1:<port>/callback?state=…&token_hash=…`.
4. The shell's listener verifies the state in constant time, answers
   everything invalid with an identical 404, and on success shows a "signed
   in" page in the system browser. It then loads
   `/api/auth/desktop?token_hash=…` **inside the shell**, which creates a
   normal 30-day session, sets the standard session cookie, and redirects
   into the app. The cookie lives in the shell's persistent default session,
   so you stay signed in across restarts.

If anything stalls, the listener gives up after 5 minutes and returns the
window to the app.

## What the packaged build does differently

Packaged builds ignore `CHESSX_DESKTOP_URL` entirely and always load the
production origin from `src/config.js` (overridable at package time with
`CHESSX_PROD_ORIGIN`). Rationale: environment variables leave no trace in
code signatures or crash reports, so a packaged shell pointed at a stale dev
port by an inherited export would be indistinguishable from a bug. DevTools
are also only exposed in unpackaged builds.

## Web-side pieces the handoff needs

All implemented in this repo (they degrade to no-ops for browser users):

- `src/lib/server/desktop-handoff.ts` — mint/atomic-consume of the handoff
  token (`DesktopHandoffToken` table).
- `src/app/api/auth/desktop/route.ts` — redeems the token, creates the
  session, sets the standard cookie, redirects.
- `src/app/api/auth/google/start` + `/callback` — carry the desktop params
  through the OAuth round trip via a short-lived httpOnly cookie.
- `src/app/signin/page.tsx` + `src/components/views/auth-view.tsx` — pass
  `desktop_port`/`desktop_state` from the URL into the Google entry.
