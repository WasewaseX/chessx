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
  try {
    kickBankBootstrap()
  } catch {
    // Best effort only. The puzzle API routes kick the same idempotent
    // installer as a backstop on first use.
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  void import('./admin-bootstrap')
    .then((m) => m.ensureAdminAccount())
    .catch(() => {
      // Best effort only: a missing admin account must never block boot.
    })
  // Daily snapshot + empty-database admin guard (boot-maintenance.ts). Same
  // guarded dynamic-import shape: its module tree lazily requires node
  // builtins, which must never enter another runtime's webpack graph.
  void import('./boot-maintenance')
    .then((m) => m.kickBootMaintenance())
    .catch(() => {
      // Best effort only: failed maintenance must never block boot.
    })
  // OFF-BOX GitHub snapshots (the lesson of the lost database: local backups
  // die together with the volume). Every 2h, token-gated, rolling windows.
  // Its module tree also lazily requires node builtins — same guarded shape.
  if (!backupTimer && process.env.GH_BACKUP_TOKEN) {
    void import('./gh-snapshot')
      .then((m) => {
        setTimeout(() => m.runBackup('boot').catch(() => {}), 5 * 60 * 1000)
      })
      .catch(() => {})
    backupTimer = setInterval(scheduledGithubBackup, BACKUP_INTERVAL_MS)
    if (typeof backupTimer.unref === 'function') backupTimer.unref()
  }
}
