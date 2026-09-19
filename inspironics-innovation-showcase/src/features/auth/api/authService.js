/**
 * Auth flows — register, verify, sign in, reset — written against the
 * {@link import('./authRepository.js').AuthRepository} contract.
 *
 * This file holds no storage access and no crypto: the repository owns where
 * state lives, `../model/*` owns the rules, and what is left here is the
 * sequence of steps and the wording of the errors. Pointing it at a real
 * backend means calling `createAuthService()` with an HTTP repository.
 */
import { authPolicy } from '#shared/config'
import { checkCodeRecord, createCodeRecord } from '../model/codes.js'
import {
  EMAIL_RE,
  needsRehash,
  normaliseEmail,
  passwordIssues,
  passwordMatches,
  withNewPassword,
} from '../model/credentials.js'
import { createSession } from '../model/session.js'
import { createLocalAuthRepository } from './localAuthRepository.js'

const CODE_ERRORS = {
  expired: 'That code has expired — request a new one.',
  locked: 'Too many incorrect attempts — request a new code.',
}

/**
 * Sign-in refused because the account has not been verified yet. Carries the
 * freshly issued code so the caller can route straight to the verify page.
 */
export class UnverifiedAccountError extends Error {
  /** @param {string} email @param {string} devCode */
  constructor(email, devCode) {
    super('This account is not verified yet.')
    this.name = 'UnverifiedAccountError'
    this.code = 'UNVERIFIED'
    this.email = email
    this.devCode = devCode
  }
}

/** @param {import('./authRepository.js').AuthRepository} repo */
export function createAuthService(repo) {
  /** Issue a code, persist only its hash, and hand the plaintext back. */
  const issue = async (kind, email, ttlMs) => {
    const { code, record } = await createCodeRecord(email, ttlMs)
    repo.writeToken(kind, record)
    repo.writeDemoCode(email, code)
    return code
  }

  /** Verify a submitted code, keeping the attempt counter honest. */
  const consume = async (kind, email, code, missingMessage) => {
    const stored = repo.readToken(kind)
    if (!stored || stored.email !== email) throw new Error(missingMessage)

    const result = await checkCodeRecord(stored, code)
    if (result.ok === true) return result.record

    if (result.reason === 'wrong') {
      repo.writeToken(kind, result.record)
      const n = result.attemptsLeft
      throw new Error(`That code is not correct — ${n} attempt${n === 1 ? '' : 's'} left.`)
    }
    repo.clearToken(kind)
    throw new Error(CODE_ERRORS[result.reason])
  }

  const startSession = (user, isGuest = false) => {
    const session = createSession(user, isGuest)
    repo.writeSession(session)
    return session
  }

  return {
    getSession: () => repo.readSession(),

    async register({ name, email, password }) {
      await repo.latency()
      const id = normaliseEmail(email)
      if (!EMAIL_RE.test(id)) throw new Error('Enter a valid email address.')
      const issues = passwordIssues(password)
      if (issues.length) throw new Error(`Password needs ${issues.join(', ')}.`)

      const users = repo.readUsers()
      if (users[id]?.verified) throw new Error('An account with that email already exists.')

      users[id] = await withNewPassword(
        {
          id,
          name: (name || '').trim() || id.split('@')[0],
          email: id,
          verified: false,
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
        password
      )
      repo.writeUsers(users)
      // A server would email this. Locally we surface it so the flow completes.
      return { email: id, devCode: await issue('verification', id, authPolicy.otpTtlMs) }
    },

    /** Live verification in progress, if any. Never returns the code itself. */
    getPendingVerification() {
      const rec = repo.readToken('verification')
      if (!rec || rec.expiresAt < Date.now()) return null
      return { email: rec.email, expiresAt: rec.expiresAt }
    },

    /** Demo affordance — see `localAuthRepository`. */
    getDemoCode: (email) => repo.readDemoCode(email ? normaliseEmail(email) : undefined),

    async resendOtp(email) {
      await repo.latency()
      const id = normaliseEmail(email)
      if (!repo.readUsers()[id]) throw new Error('No pending registration for that email.')
      return { email: id, devCode: await issue('verification', id, authPolicy.otpTtlMs) }
    },

    async verifyOtp({ email, code }) {
      await repo.latency()
      const id = normaliseEmail(email)
      await consume('verification', id, code, 'No verification in progress for that email.')

      const users = repo.readUsers()
      if (!users[id]) {
        // a verification can outlive its account if storage was cleared in
        // part, or edited from another tab; drop the dead token rather than
        // throw raw
        repo.clearToken('verification')
        throw new Error('That account no longer exists — please register again.')
      }
      users[id].verified = true
      repo.writeUsers(users)
      repo.clearToken('verification')
      return startSession(users[id])
    },

    async login({ email, password }) {
      await repo.latency()
      const id = normaliseEmail(email)
      const users = repo.readUsers()
      const user = users[id]
      if (!user || !(await passwordMatches(user, password))) {
        throw new Error('Email or password is incorrect.')
      }

      if (needsRehash(user)) {
        // right password against a legacy digest: re-stretch it properly now
        await withNewPassword(user, password)
        repo.writeUsers(users)
      }

      if (!user.verified) {
        throw new UnverifiedAccountError(id, await issue('verification', id, authPolicy.otpTtlMs))
      }
      return startSession(user)
    },

    async loginWithGoogle(profile) {
      await repo.latency(260)
      const id = normaliseEmail(profile?.email || 'google.user@inspironics.net')
      const users = repo.readUsers()
      users[id] = {
        ...(users[id] || {}),
        id,
        email: id,
        name: profile?.name || users[id]?.name || id.split('@')[0],
        picture: profile?.picture || users[id]?.picture,
        verified: true,
        provider: 'google',
        role: users[id]?.role || 'owner',
        createdAt: users[id]?.createdAt || new Date().toISOString(),
      }
      repo.writeUsers(users)
      return startSession(users[id])
    },

    async guest() {
      await repo.latency(160)
      return startSession(
        { id: 'guest', email: 'guest@inspironics.net', name: 'Guest', role: 'guest', verified: true },
        true
      )
    },

    async requestPasswordReset(email) {
      await repo.latency()
      const id = normaliseEmail(email)
      // Always succeeds, so the response cannot be used to enumerate accounts.
      if (!repo.readUsers()[id]) return { email: id, devToken: null }
      return { email: id, devToken: await issue('reset', id, authPolicy.resetTtlMs) }
    },

    getPendingReset() {
      const rec = repo.readToken('reset')
      if (!rec || rec.expiresAt < Date.now()) return null
      return { email: rec.email, expiresAt: rec.expiresAt }
    },

    async resetPassword({ email, token, password }) {
      await repo.latency()
      const id = normaliseEmail(email)
      await consume('reset', id, token, 'No reset in progress for that email.')
      const issues = passwordIssues(password)
      if (issues.length) throw new Error(`Password needs ${issues.join(', ')}.`)

      const users = repo.readUsers()
      if (!users[id]) {
        repo.clearToken('reset')
        throw new Error('That account no longer exists — please register again.')
      }
      await withNewPassword(users[id], password)
      users[id].verified = true
      repo.writeUsers(users)
      repo.clearToken('reset')
      return { email: id }
    },

    logout: () => repo.clearSession(),
  }
}

/** The instance the app uses: the flows, over localStorage. */
export const api = createAuthService(createLocalAuthRepository())

export { EMAIL_RE, passwordIssues } from '../model/credentials.js'
