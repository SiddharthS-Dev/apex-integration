/**
 * Roles. Enforced on the server (`requireAdmin`); the client only uses them to
 * decide what to show, never to decide what is allowed.
 */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  VIEWER: 'viewer',
  GUEST: 'guest',
})

export const ALL_ROLES = Object.values(ROLES)

export const isAdmin = (user) => user?.role === ROLES.ADMIN
