'use strict';

/**
 * Remembers the window's size and position across restarts, with zero
 * dependencies and no way to break the app.
 *
 * Everything here is best-effort: a missing, corrupt, unreadable or stale state
 * file must fall back to defaults, never throw, and never block quit. The
 * failure mode of "user gets a default-sized window" is acceptable; the failure
 * mode of "app will not start" is not.
 *
 * `validateBounds` takes the display list as an ARGUMENT rather than calling
 * `screen.getAllDisplays()` itself, so it is unit-testable without Electron
 * (and because `screen` is unusable before the app 'ready' event anyway).
 */

const fs = require('fs');
const path = require('path');

const STATE_VERSION = 1;
const STATE_FILE = 'window-state.json';
const WRITE_DEBOUNCE_MS = 400;

/** A restored rect must keep at least this much of itself on a real display. */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 60;

// ── Pure ──────────────────────────────────────────────────────────────────────

function intersection(a, b) {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

/**
 * Returns usable bounds, or null when the saved rect cannot be trusted — a
 * monitor was unplugged, the resolution changed, or the file was hand-edited.
 *
 * On null the caller passes only width/height to BrowserWindow and lets the OS
 * centre the window. Never invent an x/y.
 *
 * `displays` is the Electron Display[] shape: each needs a `workArea` rect.
 * Electron bounds and workArea are both in DIP, so mixed-scaleFactor multi-monitor
 * setups compare apples to apples. Display ids are deliberately NOT used as a
 * restore key — they are not stable across reboots/replugs on every platform.
 */
function validateBounds(bounds, displays, defaults) {
  if (!bounds) return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < defaults.minWidth || height < defaults.minHeight) return null;
  if (!Array.isArray(displays) || displays.length === 0) return null;

  let best = null;
  let bestArea = 0;
  for (const display of displays) {
    const area = display && display.workArea;
    if (!area) continue;
    const overlap = intersection(bounds, area);
    if (overlap.width < MIN_VISIBLE_WIDTH || overlap.height < MIN_VISIBLE_HEIGHT) continue;
    const size = overlap.width * overlap.height;
    if (size > bestArea) {
      bestArea = size;
      best = area;
    }
  }
  if (!best) return null;

  return {
    x,
    y,
    width: Math.min(width, best.width),
    height: Math.min(height, best.height),
  };
}

/**
 * `getNormalBounds()`, never `getBounds()`. While maximized, getBounds() returns
 * the maximized rect — persisting it destroys the user's un-maximized size
 * forever. getNormalBounds() is the restored-state rect.
 */
function capture(win) {
  return {
    version: STATE_VERSION,
    bounds: win.getNormalBounds(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

function stateFilePath(app) {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function read(app) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath(app), 'utf8'));
    return parsed && parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null; // missing, corrupt, unreadable — never fatal
  }
}

function write(app, state) {
  try {
    const target = stateFilePath(app);
    const tmp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, target); // atomic within the same filesystem
  } catch {
    /* persistence is best-effort; never block quit */
  }
}

/**
 * Persists on the events that can change geometry, debounced so a drag does not
 * write once per frame. Only the PRIMARY window should be tracked — a secondary
 * window opened from setWindowOpenHandler must not overwrite the main geometry.
 *
 * Listens on 'close', not 'closed': by 'closed' the window is destroyed and
 * every getter throws.
 */
function track(app, win) {
  let timer = null;
  // capture() reads live BrowserWindow getters, which throw once the window is
  // destroyed — so it has to sit INSIDE the guard, not just write() does.
  const persist = () => {
    try {
      write(app, capture(win));
    } catch {
      /* window already gone — geometry is best-effort, never fatal */
    }
  };
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, WRITE_DEBOUNCE_MS);
  };

  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, debounced);
  }
  win.on('close', () => {
    clearTimeout(timer);
    persist();
  });
}

module.exports = {
  STATE_VERSION,
  validateBounds,
  capture,
  read,
  write,
  track,
};
