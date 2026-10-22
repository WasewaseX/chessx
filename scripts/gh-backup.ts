// CLI wrapper: push a snapshot of the live database to the GitHub backup repo.
// Canonical logic lives in src/lib/server/gh-snapshot.ts (shared with the
// in-server scheduler).
import { runBackup } from '../src/lib/server/gh-snapshot'

const trigger = process.argv[2] || 'manual'
runBackup(trigger)
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
