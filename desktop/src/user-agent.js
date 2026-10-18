// user-agent.js — keeps Google (and any other third party) seeing a normal
// Chrome-shaped User-Agent, while app hosts get one extra honest token that
// identifies the desktop shell.
//
// Shape-based, not list-based: Electron injects two tokens into the UA
// string — `AppName/1.2.3` between "(KHTML, like Gecko)" and "Chrome/", and
// `Electron/x.y.z` between "Chrome/..." and "Safari/...". Rather than
// hardcoding what Electron 43 emits (which changes), we remove anything in
// those two positions that has the `name/version` shape and is not one of
// the tokens a real Chrome keeps there.

'use strict'

const { APP_HOSTS, DESKTOP_UA_TAG } = require('./config')

// Tokens a genuine Chrome UA legitimately carries in name/version shape.
// Nothing else in the two Electron injection positions survives.
const KEEP_TOKEN_RE = /^(?:Chrome|HeadlessChrome|Version|Safari)\/\S+$/

function stripToken(text, token) {
  return token ? text.replace(token, '') : text
}

function isNameVersionToken(token) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._+-]+$/.test(token) && !KEEP_TOKEN_RE.test(token)
}

/**
 * Remove the Electron-shaped tokens from a UA string. Pure and idempotent:
 * running it on an already-clean Chrome UA returns it unchanged.
 */
function cleanUserAgent(ua) {
  if (typeof ua !== 'string' || ua.length === 0) return ua

  // 1. Drop the Electron/x.y.z token wherever it sits.
  let out = ua.replace(/\s*Electron\/\S+/g, '')

  // 2. Drop app-name/version tokens Electron injects in the slot between
  //    "(KHTML, like Gecko)" and "Chrome/". If the "Chrome/" anchor is
  //    missing, fall back to scanning the whole string for stray
  //    name/version tokens that are not Chrome's own.
  const anchor = out.indexOf('Chrome/')
  const khtml = out.indexOf('(KHTML, like Gecko)')
  if (khtml !== -1 && anchor > khtml) {
    const head = out.slice(0, khtml + '(KHTML, like Gecko)'.length)
    const middle = out.slice(khtml + '(KHTML, like Gecko)'.length, anchor)
    const tail = out.slice(anchor)
    const kept = middle
      .split(/\s+/)
      .filter((t) => t.length > 0 && !isNameVersionToken(t))
      .join(' ')
    out = kept.length > 0 ? `${head} ${kept} ${tail}` : `${head} ${tail}`
  } else {
    out = out
      .split(/\s+/)
      .filter((t) => t.length > 0 && !isNameVersionToken(t))
      .join(' ')
  }

  return out.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Throw if any Electron token survived. Used in dev as a tripwire: if a
 * future Electron changes the UA shape and the stripper above stops
 * matching, this fails loudly in `npm run dev` instead of silently leaking
 * the shell's identity to every third-party host.
 */
function assertNoElectronToken(ua) {
  if (/\bElectron\//.test(ua)) {
    throw new Error(`user-agent: Electron token survived cleaning: ${ua}`)
  }
  const anchor = ua.indexOf('Chrome/')
  const khtml = ua.indexOf('(KHTML, like Gecko)')
  if (khtml !== -1 && anchor > khtml) {
    const middle = ua.slice(khtml + '(KHTML, like Gecko)'.length, anchor)
    const stray = middle.split(/\s+/).filter((t) => t && isNameVersionToken(t))
    if (stray.length > 0) {
      throw new Error(`user-agent: app token survived cleaning: ${stray.join(' ')}`)
    }
  }
}

/**
 * The tagged UA for our own hosts: clean Chrome shape plus one identifying
 * token at the end. Kept deliberately honest — it names the shell, its
 * version and the platform, which is what a well-behaved desktop client does.
 */
function buildUserAgent(cleanUa, version, platform, arch) {
  return `${cleanUa} ${DESKTOP_UA_TAG}/${version} (${platform}; ${arch})`
}

/**
 * Pick the right UA for a URL. App hosts get the tagged string; everything
 * else gets the clean Chrome shape (Google rejects requests that advertise
 * an embedded shell, and no third party needs our version number).
 */
function userAgentFor(url, agents) {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return agents.clean
  }
  return APP_HOSTS.has(host) ? agents.tagged : agents.clean
}

/**
 * Set the process-wide fallback BEFORE any window exists (call pre-ready).
 * Every request that has no more specific UA inherits this.
 */
function applyUserAgent(app) {
  const clean = cleanUserAgent(app.userAgentFallback || '')
  assertNoElectronToken(clean)
  const tagged = buildUserAgent(clean, app.getVersion(), process.platform, process.arch)
  app.userAgentFallback = clean // untagged default: never leak to third parties
  return { clean, tagged }
}

/**
 * One session-level listener that stamps the correct UA on every outgoing
 * request, based on where the request is actually going.
 */
function applyRequestUserAgent(ses, agents) {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = Object.assign({}, details.requestHeaders, {
      'User-Agent': userAgentFor(details.url, agents),
    })
    callback({ requestHeaders: headers })
  })
}

/**
 * Post-commit application for a document: once a navigation lands, pin the
 * contents' UA so subresource requests and renderer-reported
 * navigator.userAgent agree with the session-level stamp.
 */
function attachDocumentUserAgent(contents, agents) {
  const pin = (url) => {
    try {
      contents.setUserAgent(userAgentFor(url, agents))
    } catch {
      // contents can be torn down mid-navigation; nothing to do
    }
  }
  contents.on('did-navigate', (_event, url) => pin(url))
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame !== false) pin(url)
  })
}

module.exports = {
  attachDocumentUserAgent,
  applyRequestUserAgent,
  applyUserAgent,
  assertNoElectronToken,
  buildUserAgent,
  cleanUserAgent,
  userAgentFor,
}
