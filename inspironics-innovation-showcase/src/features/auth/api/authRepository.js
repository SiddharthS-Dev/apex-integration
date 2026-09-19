/**
 * The storage contract the auth service is written against.
 *
 * This is the seam. `localAuthRepository.js` implements it over localStorage;
 * an `httpAuthRepository.js` would implement the same shape over `fetch`, and
 * nothing in `authService.js`, the model, the context or the pages would need
 * to change. Documented as a typedef rather than enforced at runtime, because
 * that is as much as plain JS can give us.
 *
 * @typedef {'verification' | 'reset'} TokenKind
 *
 * @typedef {object} AuthRepository
 * @property {() => Record<string, object>} readUsers
 * @property {(users: Record<string, object>) => void} writeUsers
 * @property {() => object | null} readSession
 * @property {(session: object) => void} writeSession
 * @property {() => void} clearSession
 * @property {(kind: TokenKind) => object | null} readToken
 * @property {(kind: TokenKind, record: object) => void} writeToken
 * @property {(kind: TokenKind) => void} clearToken
 * @property {(email: string, code: string) => void} writeDemoCode
 * @property {(email?: string) => string} readDemoCode
 * @property {() => void} clearDemoCode
 * @property {(ms?: number) => Promise<void>} latency
 */

export {}
