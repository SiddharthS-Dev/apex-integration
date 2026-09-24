/**
 * Access roles.
 *
 * The API enforces these (requireAdmin is the check that matters); the web app
 * uses them to decide what to render. Both sides comparing against the same
 * constant is what stops a typo becoming a silently hidden admin screen.
 */

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
});

/** Every role, for validation at the edges. */
export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

export function isAdmin(user) {
  return user?.role === ROLES.ADMIN;
}
