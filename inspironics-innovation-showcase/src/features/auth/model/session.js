/** Session shape and lifetime. Pure — the repository decides where it lives. */
import { authPolicy } from '#shared/config'

export function createSession(user, isGuest = false) {
  const hours = isGuest ? authPolicy.guestSessionHours : authPolicy.sessionHours
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role || 'owner',
    },
    isGuest,
    issuedAt: Date.now(),
    expiresAt: Date.now() + hours * 60 * 60 * 1000,
  }
}

export const isLive = (session) => !!session && session.expiresAt > Date.now()
