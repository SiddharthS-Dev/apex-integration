import { config } from '../config.js';

// Per-account lockout: after config.loginMaxFailures consecutive failures for one account (keyed by its
// normalised email) within LOCK_WINDOW_MS, that account is refused (429) for LOCK_WINDOW_MS whatever the
// client IP; a successful password check clears it. Shared by legacy sign-in (auth/routes.js) and the
// Core password re-check of the linking flow (core/linking.js), so failures on either path count
// together. Kept in memory, so it is per process and forgotten on restart — acceptable for a
// single-instance deployment; a multi-instance one would need it in the database.
export const LOCK_WINDOW_MS = 15 * 60_000;
const loginFailures = new Map(); // key -> { count, first, lockedUntil }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailures) if (v.lockedUntil <= now && v.first + LOCK_WINDOW_MS <= now) loginFailures.delete(k);
}, LOCK_WINDOW_MS).unref();

/** The lockout key of an account: its email, trimmed and lower-cased (as legacy sign-in uses it). */
export const lockoutKey = (email) => String(email || '').trim().toLowerCase();

/** Milliseconds the account is still locked for (0 when it is not locked). */
export function lockedFor(key, now = Date.now()) {
  const entry = loginFailures.get(key);
  return entry && entry.lockedUntil > now ? entry.lockedUntil - now : 0;
}

export function noteFailure(key, now = Date.now()) {
  let entry = loginFailures.get(key);
  if (!entry || entry.first + LOCK_WINDOW_MS <= now) entry = { count: 0, first: now, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= config.loginMaxFailures) entry.lockedUntil = now + LOCK_WINDOW_MS;
  loginFailures.set(key, entry);
}

export function clearFailures(key) {
  loginFailures.delete(key);
}
