#!/usr/bin/env node
// Puzzle bank fetcher — runs as a DETACHED child process, outside Next.js.
//
// Why a child process: the bank is a ~546MB download + ~1.3GB decompression.
// Doing that inside the next-server process ballooned its RSS past 2.4GB and
// the kernel OOM-killed the whole app (twice). As a detached child it uses
// ~100MB of streaming memory, survives server restarts, and the Next side
// only reads this script's status file.
//
// Contract:
//   node bank-fetch.mjs <dbDir> <url>
//   - lock file:      <dbDir>/.bank-bootstrap.lock   (O_EXCL, stale after 15 min)
//   - status file:    <dbDir>/.bank-status.json      (rewritten as work progresses)
//   - download goes to <dbDir>/puzzles.db.part.gz, decompress to .tmp,
//     atomic rename to <dbDir>/puzzles.db only after verification.
//   - resumable: a complete .part.gz (size == content-length) is not re-downloaded.
import { createWriteStream, createReadStream, existsSync, statSync, unlinkSync, writeFileSync, openSync, readSync, closeSync, mkdirSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { renameSync } from 'node:fs'
import path from 'node:path'

const dbDir = process.argv[2]
const url = process.argv[3]
if (!dbDir || !url) {
  console.error('usage: bank-fetch.mjs <dbDir> <url>')
  process.exit(2)
}

const DB_PATH = path.join(dbDir, 'puzzles.db')
const LOCK_PATH = path.join(dbDir, '.bank-bootstrap.lock')
const PART_PATH = path.join(dbDir, 'puzzles.db.part.gz')
const TMP_PATH = path.join(dbDir, 'puzzles.db.tmp')
const STATUS_PATH = path.join(dbDir, '.bank-status.json')

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024
const MIN_VALID_DB_BYTES = 50 * 1024 * 1024
const LOCK_STALE_MS = 15 * 60 * 1000
const SQLITE_MAGIC = 'SQLite format 3'

const status = {
  phase: 'idle', // idle|downloading|decompressing|verifying|ready|failed
  bytes: 0,
  totalBytes: null,
  error: null,
  startedAt: Date.now(),
  finishedAt: null,
  pid: process.pid,
}
function saveStatus() {
  try {
    writeFileSync(STATUS_PATH, JSON.stringify(status))
  } catch {
    /* a failed status write must not abort the install */
  }
}

function fail(message) {
  status.phase = 'failed'
  status.error = message
  status.finishedAt = Date.now()
  saveStatus()
  for (const p of [TMP_PATH]) {
    try { unlinkSync(p) } catch {}
  }
  try { unlinkSync(LOCK_PATH) } catch {}
  process.exit(1)
}

// A truncated/corrupt .part.gz from a dead previous run must not pass resume check:
// completeness is judged against content-length at the resume decision below.

async function download() {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  const total = Number(head.headers.get('content-length') || 0)
  if (total > MAX_DOWNLOAD_BYTES) fail(`asset too large: ${total}`)

  if (existsSync(PART_PATH) && total && statSync(PART_PATH).size === total) {
    status.phase = 'decompressing'
    status.bytes = total
    status.totalBytes = total
    saveStatus()
    return // resume: the compressed asset is already fully here
  }
  try { unlinkSync(PART_PATH) } catch {}

  status.phase = 'downloading'
  status.bytes = 0
  status.totalBytes = total
  saveStatus()

  const resp = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'chessx-bank-fetch/1.0' } })
  if (!resp.ok || !resp.body) fail(`download failed: HTTP ${resp.status}`)

  let lastSave = 0
  let written = 0
  const { Readable } = await import('node:stream')
  const source = Readable.fromWeb(resp.body)
  source.on('data', (chunk) => {
    written += chunk.length
    status.bytes = written
    if (written > MAX_DOWNLOAD_BYTES) source.destroy(new Error('download exceeded the size cap'))
    if (Date.now() - lastSave > 1500) {
      lastSave = Date.now()
      saveStatus()
    }
  })
  await pipeline(source, createWriteStream(PART_PATH))
  saveStatus()
  if (statSync(PART_PATH).size < 1024 * 1024) fail('downloaded asset is implausibly small')
}

async function decompressAndInstall() {
  if (status.phase !== 'decompressing') {
    status.phase = 'decompressing'
    status.bytes = 0
    saveStatus()
  }
  let lastSave = 0
  let decompressed = 0
  const gz = createReadStream(PART_PATH)
  gz.on('data', (chunk) => {
    decompressed += chunk.length
    status.bytes = decompressed
    if (decompressed > MAX_DECOMPRESSED_BYTES) gz.destroy(new Error('decompressed stream exceeded the size cap'))
    if (Date.now() - lastSave > 1500) {
      lastSave = Date.now()
      saveStatus()
    }
  })
  await pipeline(gz, createGunzip(), createWriteStream(TMP_PATH))
  saveStatus()

  status.phase = 'verifying'
  saveStatus()
  const size = statSync(TMP_PATH).size
  if (size < MIN_VALID_DB_BYTES) fail(`installed database is too small (${size} bytes)`)
  const fd = openSync(TMP_PATH, 'r')
  const head = Buffer.alloc(SQLITE_MAGIC.length)
  readSync(fd, head, 0, head.length, 0)
  closeSync(fd)
  if (head.toString('utf8') !== SQLITE_MAGIC) fail('decompressed file is not a SQLite database')

  try { unlinkSync(DB_PATH) } catch {}
  renameSync(TMP_PATH, DB_PATH)
  try { unlinkSync(PART_PATH) } catch {}
  status.phase = 'ready'
  status.error = null
  status.finishedAt = Date.now()
  saveStatus()
  try { unlinkSync(LOCK_PATH) } catch {}
}

async function main() {
  mkdirSync(dbDir, { recursive: true })
  if (existsSync(DB_PATH)) {
    status.phase = 'ready'
    status.finishedAt = Date.now()
    saveStatus()
    try { unlinkSync(LOCK_PATH) } catch {}
    return
  }
  // Lock: exactly one installer per disk, with stale reclaim.
  if (existsSync(LOCK_PATH)) {
    try {
      const age = Date.now() - statSync(LOCK_PATH).mtimeMs
      if (age < LOCK_STALE_MS) {
        // someone else owns it; watch for the file to appear, then exit quietly
        for (let i = 0; i < 240; i++) {
          await new Promise((r) => setTimeout(r, 5000))
          if (existsSync(DB_PATH)) {
            status.phase = 'ready'
            status.finishedAt = Date.now()
            saveStatus()
            return
          }
        }
        fail('another installer held the lock; gave up waiting')
      }
      unlinkSync(LOCK_PATH)
    } catch {
      fail('lock inspection failed')
    }
  }
  try {
    writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
  } catch {
    fail('could not acquire the install lock')
  }

  try {
    await download()
    await decompressAndInstall()
  } catch (e) {
    fail(e && e.message ? e.message : String(e))
  }
}

main()
