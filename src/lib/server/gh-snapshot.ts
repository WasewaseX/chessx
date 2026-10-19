// GitHub-backed database snapshots — canonical implementation.
//
// The sandbox volume can be rebuilt between sessions, which has already cost
// the user their account data once. This module makes custom.db survive by
// pushing a compressed snapshot to a PRIVATE GitHub repo and restoring it on
// boot when the local database is empty.
//
//   - Local rolling copies: db/backups/ (last 7 kept)
//   - Remote:               latest.db.gz + daily-YYYY-MM-DD.db.gz (last 30 kept)
//   - puzzles.db is intentionally NOT backed up: it is re-importable from the
//     lichess dump and far too large for the GitHub Contents API.
//
// Env: GH_BACKUP_TOKEN (PAT), GH_BACKUP_REPO (default WasewaseX/chessx-backups)

// WEBPACK CONSTRAINT (see bank-bootstrap.ts — do not undo): this module is
// reached from instrumentation, which webpack compiles for multiple targets.
// Static node builtin imports here break the edge/client graphs. All node
// builtins are required LAZILY through eval('require') below.
function nodeRequire(mod: string): any {
  return (eval('require'))(mod)
}

const REPO = process.env.GH_BACKUP_REPO || 'WasewaseX/chessx-backups'
const TOKEN = process.env.GH_BACKUP_TOKEN || ''
const DB_PATH = process.env.DATABASE_URL?.replace(/^file:/, '') || 'db/custom.db'
const LOCAL_DIR = 'db/backups'
const KEEP_LOCAL = 7
const KEEP_REMOTE = 30

function api(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

async function ensureRepo(): Promise<boolean> {
  if (!TOKEN) return false
  const res = await api(`/repos/${REPO}`)
  if (res.status === 200) return true
  const create = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO.split('/')[1],
      private: true,
      description: 'chessx database snapshots (automatic)',
    }),
  })
  if (create.status === 201 || create.status === 422) return true // 422 = already exists
  console.error('[gh-snapshot] repo create failed:', create.status)
  return false
}

async function putFile(path: string, content: Buffer, message: string): Promise<void> {
  let sha: string | undefined
  const head = await api(`/repos/${REPO}/contents/${path}?ref=main`)
  if (head.status === 200) {
    const json = (await head.json()) as { sha?: string }
    sha = json.sha
  }
  const put = await api(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: content.toString('base64'), sha, branch: 'main' }),
  })
  if (!put.ok) throw new Error(`upload ${path} -> ${put.status}`)
}

/** Create a consistent SQLite snapshot of the live database via VACUUM INTO. */
async function snapshotLocal(targetPath: string): Promise<void> {
  const { PrismaClient } = nodeRequire('@prisma/client')
  const db = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
  try {
    await db.$queryRawUnsafe(`VACUUM INTO '${targetPath}'`)
  } finally {
    await db.$disconnect()
  }
}

export async function runBackup(trigger: string): Promise<boolean> {
  if (!TOKEN) {
    console.log('[gh-snapshot] no GH_BACKUP_TOKEN set; skipping snapshot')
    return false
  }
  const { mkdirSync, readdirSync, readFileSync, unlinkSync, copyFileSync, existsSync } = nodeRequire('fs')
  const { execSync } = nodeRequire('child_process')
  try {
    mkdirSync(LOCAL_DIR, { recursive: true })

    // 1. Consistent snapshot of the live db.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const localFile = `${LOCAL_DIR}/snapshot-${stamp}.db`
    if (existsSync(localFile)) unlinkSync(localFile)
    await snapshotLocal(localFile)
    execSync(`gzip -f '${localFile}'`, { stdio: 'pipe' })

    // 2. Rolling local copies.
    copyFileSync(`${localFile}.gz`, `${LOCAL_DIR}/latest.db.gz`)
    const files = readdirSync(LOCAL_DIR)
      .filter((f: string) => f.startsWith('snapshot-') && f.endsWith('.db.gz'))
      .sort()
    while (files.length > KEEP_LOCAL) unlinkSync(`${LOCAL_DIR}/${files.shift()}`)

    // 3. Push to GitHub: rolling latest + one per day.
    if (!(await ensureRepo())) return false
    const gz = readFileSync(`${localFile}.gz`)
    await putFile('latest.db.gz', gz, `snapshot (${trigger}) ${dayKey()}`)
    await putFile(`daily-${dayKey()}.db.gz`, gz, `daily snapshot (${trigger}) ${dayKey()}`)

    // 4. Prune remote daily snapshots beyond KEEP_REMOTE.
    const list = await api(`/repos/${REPO}/contents/?ref=main`)
    if (list.status === 200) {
      const entries = (await list.json()) as { name: string; sha: string }[]
      const daily = entries.filter((e) => e.name.startsWith('daily-')).sort()
      while (daily.length > KEEP_REMOTE) {
        const old = daily.shift()
        if (old)
          await api(`/repos/${REPO}/contents/${old.name}`, {
            method: 'DELETE',
            body: JSON.stringify({ message: 'prune old snapshot', sha: old.sha }),
          })
      }
    }
    console.log(`[gh-snapshot] snapshot pushed (${trigger}, ${Math.round(gz.length / 1024)} KB)`)
    return true
  } catch (err) {
    console.error('[gh-snapshot] failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/** Age of the newest local snapshot; Infinity when none exists. */
export function lastBackupAgeMs(): number {
  try {
    const { statSync } = nodeRequire('fs')
    return Date.now() - statSync(`${LOCAL_DIR}/latest.db.gz`).mtimeMs
  } catch {
    return Infinity
  }
}

/** Pull latest.db.gz from GitHub into the local DB. Only call when empty. */
export async function restoreFromGithub(): Promise<boolean> {
  if (!TOKEN) {
    console.log('[gh-snapshot] no GH_BACKUP_TOKEN; cannot pull snapshot')
    return false
  }
  const { execSync } = nodeRequire('child_process')
  const { existsSync, writeFileSync } = nodeRequire('fs')
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/latest.db.gz`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github.raw',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status !== 200) {
      console.log('[gh-snapshot] no remote snapshot yet (status', res.status + ')')
      return false
    }
    const gz = Buffer.from(await res.arrayBuffer())
    writeFileSync('/tmp/chessx-restore.db.gz', gz)
    if (existsSync(DB_PATH)) execSync(`cp '${DB_PATH}' '/tmp/chessx-pre-restore.db'`)
    execSync(`gunzip -f /tmp/chessx-restore.db.gz && cp /tmp/chessx-restore.db '${DB_PATH}'`)
    console.log(`[gh-snapshot] restored database from GitHub (${Math.round(gz.length / 1024)} KB gz)`)
    return true
  } catch (err) {
    console.error('[gh-snapshot] restore failed:', err instanceof Error ? err.message : err)
    return false
  }
}
