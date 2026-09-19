/**
 * localStorage implementation of {@link import('./authRepository.js').AuthRepository}.
 *
 * Every read and write of auth state in the app funnels through here, which is
 * what makes the backend swap a single-file job. The artificial latency lives
 * here too: it models a network round trip, so a real transport would simply
 * not have it.
 */
import { storageKeys } from '#shared/config'

const TOKEN_KEYS = {
  verification: storageKeys.authPending,
  reset: storageKeys.authReset,
}

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value))

/** @returns {import('./authRepository.js').AuthRepository} */
export function createLocalAuthRepository() {
  const keyFor = (kind) => {
    const key = TOKEN_KEYS[kind]
    if (!key) throw new Error(`Unknown auth token kind: ${kind}`)
    return key
  }

  return {
    readUsers: () => readJson(storageKeys.authUsers, {}),
    writeUsers: (users) => writeJson(storageKeys.authUsers, users),

    readSession: () => readJson(storageKeys.authSession, null),
    writeSession: (session) => writeJson(storageKeys.authSession, session),
    clearSession: () => localStorage.removeItem(storageKeys.authSession),

    readToken: (kind) => readJson(keyFor(kind), null),
    writeToken: (kind, record) => writeJson(keyFor(kind), record),
    clearToken: (kind) => {
      localStorage.removeItem(keyFor(kind))
      localStorage.removeItem(storageKeys.authDemoCode)
    },

    // Demo affordance: nothing here can send email, so the code has to be
    // visible for the flow to be completable. It is kept under its own key,
    // separate from the record the checks trust, so a deployment with a mail
    // service deletes these three methods and their two call sites.
    writeDemoCode: (email, code) => writeJson(storageKeys.authDemoCode, { email, code }),
    readDemoCode: (email) => {
      const rec = readJson(storageKeys.authDemoCode, null)
      if (!rec || (email && rec.email !== email)) return ''
      return rec.code || ''
    },
    clearDemoCode: () => localStorage.removeItem(storageKeys.authDemoCode),

    latency: (ms = 420) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
