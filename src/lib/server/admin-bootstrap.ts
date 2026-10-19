// Admin account bootstrap. Runs once per server boot, right after the puzzle
// bank kick: guarantees the operator account exists with every gate open.
//
// Contract:
//   - username "admin", password "admin1234" unless ADMIN_PASSWORD overrides
//   - created exactly once; the password is NEVER reset or overwritten by
//     later boots, so changing it in the app sticks
//   - if an account already squats the username it is promoted to admin only
//     when it is not yet admin; its password is left exactly as the operator
//     set it, never silently reset
//
// COMPILE CONTRACT: this module is reached from the instrumentation graph,
// which webpack compiles for EVERY runtime (the NEXT_RUNTIME guard protects
// execution, not compilation). Every import here must resolve under the edge
// target too — hence bcryptjs directly instead of @/lib/auth, which drags in
// the node-only 'crypto' module and breaks the edge build (the exact failure
// mode bank-bootstrap's header documents).
import 'server-only'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { seedForSkill } from '@/lib/rating'

const ADMIN_USERNAME = 'admin'
const ADMIN_EMAIL = 'admin@chessx.app'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin1234'
const BCRYPT_ROUNDS = 12

let started = false

export function ensureAdminAccount(): void {
  if (started) return
  started = true
  void (async () => {
    try {
      const existing = await db.user.findUnique({ where: { usernameLower: ADMIN_USERNAME } })
      if (existing) {
        if (existing.role !== 'admin') {
          await db.user.update({ where: { id: existing.id }, data: { role: 'admin' } })
          console.log('[admin-bootstrap] promoted existing "admin" account to role=admin')
        }
        return
      }

      const emailTaken = await db.user.findUnique({ where: { email: ADMIN_EMAIL } })
      if (emailTaken) {
        console.warn('[admin-bootstrap] email admin@chessx.app is taken; no admin account created')
        return
      }

      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS)
      await db.user.create({
        data: {
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          usernameLower: ADMIN_USERNAME,
          passwordHash,
          role: 'admin',
          profile: {
            create: { name: 'Admin', skillLevel: 'intermediate', onboarded: true },
          },
          ratings: {
            create: { pool: 'overall', rating: seedForSkill('intermediate'), rd: 350 },
          },
        },
      })
      console.log('[admin-bootstrap] operator account "admin" created (all features unlocked)')
    } catch (err) {
      console.warn('[admin-bootstrap] could not ensure the admin account:', err)
    }
  })()
}
