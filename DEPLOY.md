# Deploying ChessX

The app is a Next.js 16 (App Router) + Prisma/SQLite application. Every push to
`main` is built by CI (`.github/workflows/ci.yml`) — a green check on the
latest commit means the exact commit you deploy will build.

## What already works

- `bun run build` — generates the Prisma client, builds with webpack (the
  project requires webpack; Next 16's Turbopack default is incompatible with
  the custom config), and collects the standalone bundle.
- `bun run start` — starts the production server via `scripts/start-prod.ts`.

## Option A — Vercel (recommended)

1. Push to `main` (or open the repo on Vercel and import `WasewaseX/chessx`).
2. Set the environment variable:
   - `DATABASE_URL` = `file:/tmp/custom.db` (or a mounted volume path)
3. Deploy. The build command (`bun run build`) already runs
   `prisma generate && next build --webpack`.
4. After the first deploy, sign in with the boot-created `admin` account.

Note: SQLite on Vercel is ephemeral per-instance. For durable data, either use
a mounted volume (Railway/Fly/VPS) or keep the built-in GitHub snapshot
system (below) which restores the database on every boot.

## Option B — Docker-capable host (Railway / Fly.io / VPS)

```bash
bun install
bun run build
DATABASE_URL=file:/data/custom.db bun run start
```

Mount a volume at `/data` (or anywhere) and point `DATABASE_URL` at it.

## Durable data (built in)

- On boot: if the database is empty, it restores the newest snapshot from the
  private backup repo and re-creates the guaranteed accounts.
- Every 2 hours: a gzip'd SQLite snapshot is pushed to the private repo
  (`GH_BACKUP_TOKEN` + `GH_BACKUP_REPO` env vars; daily copies kept 30 days).
- Manual: `bun run backup` (push now) · `bun run backup:restore` (pull now).

## Mini services (optional)

`mini-services/game-service` (port 3030, rated multiplayer) and
`mini-services/mcp-server` (port 3031, MCP tools) run independently:

```bash
cd mini-services/game-service && bun install && bun run dev
cd mini-services/mcp-server && bun install && bun run dev
```

Health: Settings → System status in the app shows every subsystem live.

## Keeping the deployment up to date

Every completed work session pushes to `main` and CI verifies the build. To
update a hosted copy: pull the latest `main` and redeploy — the boot
maintenance (accounts, ship notes, database restore) makes restarts safe.
