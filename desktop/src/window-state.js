// window-state.js — crash-proof window geometry persistence.
//
// Design rules that keep this safe:
//  - The state file is advisory only. Anything unreadable, wrong-version or
//    off-screen is discarded and the window falls back to its defaults — we
//    NEVER invent x/y (a window restored to a position no display covers is
//    the classic "app opens invisible" bug).
//  - Writes are atomic: tmp file + rename, so a crash mid-write cannot leave
//    a half JSON file behind.
//  - Resize/move saves are debounced (400ms); the close path captures and
//    writes synchronously inside the destroyed-guard, so quitting maximized
//    still records the normal (restorable) bounds via getNormalBounds().

'use strict'

const fs = require('fs')
const path = require('path')

const SAVE_DEBOUNCE_MS = 400
const STATE_VERSION = 1
// A restored window must overlap some display's work area by at least this
// much, or the saved geometry is thrown away.
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 60

function stateFilePath(app) {
  return path.join(app.getPath('userData'), 'chessx-window-state.json')
}

function boundsAreSane(b) {
  return (
    !!b &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height) &&
    b.width >= 400 &&
    b.height >= 300
  )
}

/** True when the bounds overlap at least one display's work area enough. */
function isVisibleSomewhere(bounds, screen) {
  try {
    for (const display of screen.getAllDisplays()) {
      const wa = display.workArea
      const overlapW =
        Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x)
      const overlapH =
        Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y)
      if (overlapW >= MIN_VISIBLE_WIDTH && overlapH >= MIN_VISIBLE_HEIGHT) return true
    }
  } catch {
    // screen not ready yet — treat as unverifiable and refuse the restore
    return false
  }
  return false
}

/** Read + validate the saved state. Returns null when nothing is usable. */
function loadWindowState(app, screen) {
  try {
    const raw = fs.readFileSync(stateFilePath(app), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== STATE_VERSION) return null
    if (!boundsAreSane(parsed)) return null
    if (!isVisibleSomewhere(parsed, screen)) return null
    return {
      bounds: { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height },
      maximized: parsed.maximized === true,
    }
  } catch {
    return null // missing or corrupt file is a normal first-run condition
  }
}

/** Atomic write: tmp file in the same directory, then rename over the target. */
function writeWindowState(app, state) {
  const file = stateFilePath(app)
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    // A failed save is a lost convenience, never an error the user sees.
    try {
      fs.unlinkSync(tmp)
    } catch {
      // nothing to clean up
    }
  }
}

/** Capture the window's restorable geometry, or null when it is gone. */
function captureWindowBounds(win) {
  try {
    if (win.isDestroyed()) return null
    // getNormalBounds returns pre-maximize geometry even while maximized,
    // which is exactly what we want to restore into.
    return win.getNormalBounds()
  } catch {
    return null
  }
}

/**
 * Keep a window's state saved. Returns nothing; the bookkeeping lives here.
 * Debounced on resize/move/maximize transitions, synchronous on close.
 */
function trackWindow(app, screen, win) {
  let timer = null
  let lastSaved = null

  const snapshot = () => {
    const bounds = captureWindowBounds(win)
    if (!bounds) return null
    let maximized = false
    try {
      if (!win.isDestroyed()) maximized = win.isMaximized() || win.isFullScreen()
    } catch {
      maximized = false
    }
    return { version: STATE_VERSION, ...bounds, maximized, savedAt: new Date().toISOString() }
  }

  const saveNow = () => {
    const snap = snapshot()
    if (!snap) return
    lastSaved = snap
    writeWindowState(app, snap)
  }

  const scheduleSave = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, scheduleSave)
  }

  // Close is the last reliable moment: capture synchronously, guarded
  // against the window already being torn down.
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    saveNow()
  })
  win.on('closed', () => {
    if (timer) clearTimeout(timer)
  })

  return {
    flush() {
      if (timer) clearTimeout(timer)
      if (!lastSaved) saveNow()
    },
  }
}

module.exports = {
  STATE_VERSION,
  captureWindowBounds,
  isVisibleSomewhere,
  loadWindowState,
  stateFilePath,
  trackWindow,
  writeWindowState,
}
