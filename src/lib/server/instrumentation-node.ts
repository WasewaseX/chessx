// Node-only boot logic for instrumentation. This module is reached ONLY
// through the NEXT_RUNTIME-guarded dynamic import in ../instrumentation.ts,
// which makes it a split chunk compiled for the nodejs runtime alone. It must
// stay free of any import from a non-node entry point: pulling bank-bootstrap
// into the root instrumentation graph (or the root layout) drags
// node:child_process into graphs compiled for other runtimes and every page
// 500s with UnhandledSchemeError.
//
// The admin bootstrap is loaded through the same guard shape the root
// instrumentation uses: the import() must sit AFTER the NEXT_RUNTIME early
// return so the edge compilation dead-eliminates the whole branch (its
// module tree needs node-only 'crypto' and cannot enter another runtime's
// webpack graph).
import { kickBankBootstrap } from '@/lib/server/bank-bootstrap'

const BACKUP_INTERVAL_MS = 2 * 60 * 60 * 1000 // every 2 hours
const BACKUP_MIN_GAP_MS = 60 * 60 * 1000 // never more often than hourly

let backupTimer: ReturnType<typeof setInterval> | null = null

async function scheduledGithubBackup(): Promise<void> {
  try {
    const mod = await import('./gh-snapshot')
    if (mod.lastBackupAgeMs() < BACKUP_MIN_GAP_MS) return
    await mod.runBackup('scheduled')
  } catch (err) {
    console.error('[boot-backup] failed:', err instanceof Error ? err.message : err)
  }
}

export function nodeBoot(): void {
  // Record the boot time for /api/build-info (deployment freshness probe).
  ;(globalThis as { __chessxBootIso?: string }).__chessxBootIso = new Date().toISOString()
  // Bank install is a detached child process (see bank-bootstrap.ts), but its
  // 546MB download still competes for disk/page-cache right when the first
  // webpack compile needs every spare byte — the Oct 24 OOM (next-server
  // killed at 3.44GB RSS, uptime 166s) landed exactly in this window. Delay
  // the kick past the boot-critical first minute; API routes kick it on first
  // puzzle use anyway, and the installer is idempotent.
  setTimeout(() => {
    try {
      kickBankBootstrap()
    } catch {
      // Best effort only. The puzzle API routes kick the same idempotent
      // installer as a backstop on first use.
    }
  }, 45 * 1000).unref?.()
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // STRICT ORDER (the Oct 20 account-loss lesson): boot-maintenance must
  // restore user data from the GitHub snapshot BEFORE any account bootstrap
  // runs — otherwise the fresh admin row makes an empty database look
  // populated and the restore skips. admin-bootstrap is therefore chained
  // behind the maintenance sequence, never fired in parallel.
  void import('./boot-maintenance')
    .then((m) => m.kickBootMaintenance())
    .then(() => import('./admin-bootstrap'))
    .then((m) => m.ensureAdminAccount())
    .catch(() => {
      // Best effort only: a missing admin account must never block boot.
    })
  // OFF-BOX GitHub snapshots (the lesson of the lost database: local backups
  // die together with the volume). Every 2h, token-gated, rolling windows.
  // Its module tree also lazily requires node builtins — same guarded shape.
  // Token resolution now falls back to the origin remote's embedded PAT
  // inside gh-snapshot.ts, so a lost .env.local can no longer silently
  // disable backups the way it did on Oct 20.
  if (!backupTimer) {
    void import('./gh-snapshot')
      .then((m) => {
        if (m.hasBackupToken()) {
          setTimeout(() => m.runBackup('boot').catch(() => {}), 5 * 60 * 1000)
          backupTimer = setInterval(scheduledGithubBackup, BACKUP_INTERVAL_MS)
          if (typeof backupTimer.unref === 'function') backupTimer.unref()
        }
      })
      .catch(() => {})
  }
}
