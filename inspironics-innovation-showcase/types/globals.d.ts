/**
 * Ambient declarations for browser APIs and third-party globals that the
 * standard lib does not describe.
 *
 * These are not conveniences — without them `checkJs` cannot tell a real typo
 * from a legitimate use of an optional API, so the whole check gets ignored.
 */

interface Navigator {
  /** Device Memory API: approximate RAM in GiB. Chromium only. */
  deviceMemory?: number
}

interface Window {
  /** Google Identity Services, injected by the GSI script tag. */
  google?: {
    accounts: {
      id: {
        initialize(config: Record<string, unknown>): void
        renderButton(parent: HTMLElement, options: Record<string, unknown>): void
        prompt?(): void
      }
    }
  }
  /** Guard flag set by shared/lib/reporter. */
  __inspironicsReporting?: boolean
}

/** Vite injects these at build time. */
interface ImportMetaEnv {
  /** The `base` from vite.config.js, with a trailing slash. */
  readonly BASE_URL?: string
  readonly MODE?: string
  readonly DEV?: boolean
  readonly PROD?: boolean
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_ERROR_ENDPOINT?: string
}

interface ImportMeta {
  readonly env?: ImportMetaEnv
}

/** Vite CSS imports are valid side-effect imports in the app. */
declare module '*.css'
