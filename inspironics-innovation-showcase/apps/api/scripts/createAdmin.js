/**
 * Create an administrator, or promote an existing account and reset its password.
 *
 *   npm run create-admin -w @inspironics/api -- you@company.com 'a-strong-password' "Your Name"
 */
import { ROLES } from '@inspironics/shared'
import { loadConfig, loadDotEnv } from '../src/config.js'
import { openDatabase } from '../src/db/index.js'
import { migrate } from '../src/db/migrate.js'
import { hashPassword } from '../src/lib/crypto.js'
import { createLogger } from '../src/lib/log.js'
import { createRepos } from '../src/services.js'

const [email, password, name] = process.argv.slice(2)
if (!email || !password) {
  console.error('usage: npm run create-admin -w @inspironics/api -- <email> <password> [name]')
  process.exit(1)
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('Password needs at least 8 characters, a letter and a number.')
  process.exit(1)
}

loadDotEnv()
const config = loadConfig()
const log = createLogger({ level: 'warn' })
const db = await openDatabase(config, log)
await migrate(db, log)
const repos = createRepos(db)

const id = email.trim().toLowerCase()
const existing = await repos.users.findByEmail(id)
const passwordHash = await hashPassword(password)
if (existing) {
  await repos.users.update(existing.id, { role: ROLES.ADMIN, verified: true, disabled: false, password_hash: passwordHash })
  console.log(`Promoted ${id} to administrator and set a new password.`)
} else {
  await repos.users.create({ email: id, name: name || id.split('@')[0], passwordHash, role: ROLES.ADMIN, verified: true })
  console.log(`Created administrator ${id}.`)
}
await db.close()
