/** Errors the auth services share, whichever backend they talk to. */

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
