// In-server snapshot scheduler glue. Reached only from instrumentation-node
// (nodejs runtime). Thin re-export so the scheduler stays out of hot paths.
export { runBackup, lastBackupAgeMs } from './gh-snapshot'
