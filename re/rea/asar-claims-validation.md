# Chessigma asar — scripted claims validation

Generated: 2026-10-19T11:09:41.391Z

Source tree: /home/z/my-project/re/chessigma/extracted/asar (9 files, all read in full)

> NOTE: the prior report docs/chessigma-re-report.md was NOT present on disk when task 2-b started
> (the /home/z/my-project/re/ directory did not exist). The Chessigma 1.0.2 artifact was re-acquired
> from the upstream CDN (sha256 verified against cdn.chessigma.dev/desktop/latest.json) and the asar
> re-extracted. The claims below were derived from a full read of the asar source, then validated
> by this scripted pass. "Expected" states whether the regex SHOULD match (yes) or MUST NOT match (no).

| ID | Claim | Expected | Verdict | Evidence (file:line) |
|---|---|---|---|---|
| C01 | Production origin hard-coded to https://www.chessigma.com | present | PASS | src/config.js:20 |
| C02 | CHESSIGMA_DESKTOP_URL env override is ignored in packaged builds | present | PASS | src/config.js:48 |
| C03 | User-agent tag sent to own origin: Chessigma-Desktop/<version> (<platform>; <arch>) | present | PASS | src/config.js:54 |
| C04 | Supabase GoTrue project host embedded: ozvvyafyqcgjftdotcae.supabase.co | present | PASS | src/config.js:86 |
| C05 | Stripe hosted checkout + billing hosts allowlisted in-window | present | PASS | src/config.js:91, src/config.js:98 |
| C06 | Google auth hosts include accounts.google.com and accounts.youtube.com | present | PASS | src/config.js:68, src/config.js:70 |
| C07 | Renderer sandboxed: contextIsolation true, nodeIntegration false, sandbox true | present | PASS | src/config.js:165 |
| C08 | No preload script / no IPC bridge anywhere in the shell (only comment mentions; no preload: assignment) | absent | PASS (absent as expected) | — |
| C09 | Permission allow-set is clipboard-only (clipboard-read, clipboard-sanitized-write, deprecated-sync-clipboard-read) | present | PASS | src/config.js:187 |
| C10 | Google OAuth runs in system browser via RFC 8252 loopback handoff on 127.0.0.1 | present | PASS | src/config.js:266 |
| C11 | OAuth state is 16 random bytes hex, compared in constant time | present | PASS | src/auth-handoff.js:46 |
| C12 | Session redeem endpoint: /api/auth/desktop?token_hash=… loaded in the shell | present | PASS | src/auth-handoff.js:21, src/auth-handoff.js:73 |
| C13 | Loopback listener serves exactly /callback and is single-use | present | PASS | src/auth-handoff.js:92 |
| C14 | Navigation allowlist enforced on will-navigate (main frame only); will-redirect deliberately unguarded | present | PASS | src/navigation.js:10 |
| C15 | window.open always denied; internal popups re-created through the shell factory; ceiling MAX_APP_WINDOWS=8 | present | PASS | src/config.js:225 |
| C16 | Offline page fallback for all main-frame failures except ERR_ABORTED(-3) / ERR_BLOCKED_BY_CLIENT(-20) | present | PASS | src/config.js:209 |
| C17 | Window geometry persisted to userData/window-state.json (atomic tmp+rename, version 1) | present | PASS | src/window-state.js:21 |
| C18 | shell.openExternal allow-set: https: and mailto: only; URL length cap 2048 | present | PASS | src/config.js:137 |
| C19 | DevTools menu role only in unpackaged builds (app.isPackaged gate) | present | PASS | src/main.js:330 |
| C20 | No embedded crypto keys: only crypto.randomBytes/timingSafeEqual are used | absent | PASS (absent as expected) | — |
| C21 | No auto-update mechanism (no electron-updater / autoUpdater) — prod deploys are the update | absent | PASS (absent as expected) | — |
| C22 | webview tag disabled and will-attach-webview prevented | present | PASS | src/main.js:92 |
| C23 | UA strip is shape-based (removes Electron/<ver> and any token between "(KHTML, like Gecko)" and "Chrome/") | present | PASS | src/user-agent.js:65 |
| C24 | Google OAuth authorize start is detected only on known Supabase host + /auth/v1/authorize + provider=google | present | PASS | src/config.js:256 |

**Totals: 24 pass / 0 fail**

## Evidence detail


### C01 Production origin hard-coded to https://www.chessigma.com
- `src/config.js:20`: `const PRODUCTION_ORIGIN = 'https://www.chessigma.com';`

### C02 CHESSIGMA_DESKTOP_URL env override is ignored in packaged builds
- `src/config.js:48`: `return !override || isPackaged ? PRODUCTION_ORIGIN : override;`

### C03 User-agent tag sent to own origin: Chessigma-Desktop/<version> (<platform>; <arch>)
- `src/config.js:54`: `const DESKTOP_UA_TAG = 'Chessigma-Desktop';`

### C04 Supabase GoTrue project host embedded: ozvvyafyqcgjftdotcae.supabase.co
- `src/config.js:86`: `const SUPABASE_HOSTS = ['ozvvyafyqcgjftdotcae.supabase.co'];`

### C05 Stripe hosted checkout + billing hosts allowlisted in-window
- `src/config.js:91`: `* billing.stripe.com is required even for a pure "buy" button, because`
- `src/config.js:98`: `'billing.stripe.com',`

### C06 Google auth hosts include accounts.google.com and accounts.youtube.com
- `src/config.js:68`: `* heuristic could latch onto. accounts.youtube.com is Google's cookie-sync hop.`
- `src/config.js:70`: `const AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com'];`

### C07 Renderer sandboxed: contextIsolation true, nodeIntegration false, sandbox true
- `src/config.js:165`: `contextIsolation: true, nodeIntegration: false, sandbox: true,`

### C09 Permission allow-set is clipboard-only (clipboard-read, clipboard-sanitized-write, deprecated-sync-clipboard-read)
- `src/config.js:187`: `'deprecated-sync-clipboard-read',`

### C10 Google OAuth runs in system browser via RFC 8252 loopback handoff on 127.0.0.1
- `src/config.js:266`: `const LOOPBACK_HOST = '127.0.0.1';`

### C11 OAuth state is 16 random bytes hex, compared in constant time
- `src/auth-handoff.js:46`: `return crypto.randomBytes(16).toString('hex');`

### C12 Session redeem endpoint: /api/auth/desktop?token_hash=… loaded in the shell
- `src/auth-handoff.js:21`: `*   6. verify `state`, then load /api/auth/desktop?token_hash=… IN THE SHELL,`
- `src/auth-handoff.js:73`: `const url = new URL('/api/auth/desktop', appOrigin);`

### C13 Loopback listener serves exactly /callback and is single-use
- `src/auth-handoff.js:92`: `if (url.pathname !== '/callback') return { ok: false, reason: 'not-callback' };`

### C14 Navigation allowlist enforced on will-navigate (main frame only); will-redirect deliberately unguarded
- `src/navigation.js:10`: `*   2. Do NOT enforce on `will-redirect` or `will-frame-navigate`.`

### C15 window.open always denied; internal popups re-created through the shell factory; ceiling MAX_APP_WINDOWS=8
- `src/config.js:225`: `const MAX_APP_WINDOWS = 8;`

### C16 Offline page fallback for all main-frame failures except ERR_ABORTED(-3) / ERR_BLOCKED_BY_CLIENT(-20)
- `src/config.js:209`: `-3, // ERR_ABORTED`

### C17 Window geometry persisted to userData/window-state.json (atomic tmp+rename, version 1)
- `src/window-state.js:21`: `const STATE_FILE = 'window-state.json';`

### C18 shell.openExternal allow-set: https: and mailto: only; URL length cap 2048
- `src/config.js:137`: `const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:']);`

### C19 DevTools menu role only in unpackaged builds (app.isPackaged gate)
- `src/main.js:330`: `...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),`

### C22 webview tag disabled and will-attach-webview prevented
- `src/main.js:92`: `contents.on('will-attach-webview', (event) => event.preventDefault());`

### C23 UA strip is shape-based (removes Electron/<ver> and any token between "(KHTML, like Gecko)" and "Chrome/")
- `src/user-agent.js:65`: `ua = ua.replace(/(\(KHTML, like Gecko\) )(?:(?!Chrome\/)\S+ )+(?=Chrome\/)/, '$1');`

### C24 Google OAuth authorize start is detected only on known Supabase host + /auth/v1/authorize + provider=google
- `src/config.js:256`: `const OAUTH_AUTHORIZE_PATH = '/auth/v1/authorize';`
