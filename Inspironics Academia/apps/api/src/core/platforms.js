import { validatePlatforms } from '@academy/shared';

// Which APEX platforms a person sees on the APEX home (Innovation Showcase, SlidesVault, Academia).
// Set when an access request is approved (the applicant asked; the approver confirmed). It is a display
// setting, not an authorization: the gateway still opens a platform only where the person has an
// account (Showcase and SlidesVault accounts are created and linked by an administrator, ADR 0003).
// Stored in the existing key/value `settings` table, so no schema change. No setting = show everything
// (administrators and everyone who joined before this existed).

export const platformKey = (userId) => `apex_platforms:${userId}`;

/** The person's platform list, or null when none was set. */
export async function userPlatforms(q, userId) {
  const [row] = await q.query('SELECT value FROM settings WHERE key = ?', [platformKey(userId)]);
  if (!row || row.value == null) return null;
  try {
    const v = validatePlatforms(JSON.parse(row.value));
    return v.error ? null : v.value;
  } catch {
    return null;
  }
}

/** Saves the person's platform list (inside the caller's transaction). */
export async function setUserPlatforms(q, userId, platforms, at = new Date().toISOString()) {
  await q.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [platformKey(userId), JSON.stringify(platforms), at],
  );
}
