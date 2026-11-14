import { useQuery } from '@tanstack/react-query';
import { api, backendKind } from '@/api/client';

// Client-side view of the APEX Core role catalogue (R1 identity contract §2). It only shapes the forms:
// the API validates every grant against its own copy and refuses anything outside it.
export const ROLE_CATALOGUE = Object.freeze({
  platform_admin: { label: 'Platform admin', scopes: ['platform'], hint: 'Full administration of every app. Never self-granted.' },
  org_admin: { label: 'Organisation admin', scopes: ['organization'], hint: 'Manages members of one organisation.' },
  staff: { label: 'Staff', scopes: ['organization'], hint: 'Employee of the organisation. Grants no admin rights.' },
  assessor: { label: 'Assessor', scopes: ['platform', 'organization'] },
  app_admin: { label: 'App admin', scopes: ['app'], hint: 'Administers one app (Showcase or SlidesVault).' },
  learner: { label: 'Learner', scopes: ['platform', 'organization'] },
  mentor: { label: 'Mentor', scopes: ['platform', 'organization'] },
  student: { label: 'Student', scopes: ['platform', 'organization'] },
  intern: { label: 'Intern', scopes: ['platform', 'organization'] },
  alumni: { label: 'Alumni', scopes: ['platform', 'organization'] },
});
export const ROLES = Object.keys(ROLE_CATALOGUE);
export const roleLabel = (role) => ROLE_CATALOGUE[role]?.label || role;

export const APPS = Object.freeze({ showcase: 'Innovation Showcase', slidesvault: 'SlidesVault' });
export const SCOPE_LABELS = Object.freeze({ platform: 'Platform-wide', organization: 'Organisation', app: 'App' });

export const AUDIT_ACTIONS = [
  'role.granted', 'role.revoked', 'role.transitioned',
  'membership.created', 'membership.ended', 'organization.created',
  'identity_link.proposed', 'identity_link.confirmed', 'identity_link.rejected',
  'user.provisioned', 'auth.google_sign_in',
];

/** True when this build talks to the API server (the demo build has no Core). */
export const coreAvailable = backendKind !== 'demo';

/** "Organisation · Inspironics", "App · SlidesVault" or "Platform-wide". */
export function scopeText(scopeType, scopeId, orgNames = {}) {
  if (scopeType === 'platform') return SCOPE_LABELS.platform;
  if (scopeType === 'app') return `App · ${APPS[scopeId] || scopeId}`;
  if (scopeType === 'organization') return `Organisation · ${orgNames[scopeId] || scopeId}`;
  return `${scopeType} · ${scopeId}`;
}

export function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Plain-language message for a failed Core call. */
export function coreErrorText(err, fallback = 'Something went wrong. Please try again.') {
  const status = err?.status;
  const msg = err?.message;
  if (status === 401) return 'Your session has ended. Sign in again to continue.';
  if (status === 403) return msg && msg !== 'Forbidden' ? `Not allowed: ${msg}` : 'You do not have permission to do this.';
  if (status === 404) return msg && msg !== 'Not Found' ? msg : 'Not found. It may have been removed, or you cannot see it.';
  if (status === 409) return msg || 'This conflicts with the current state. Refresh and try again.';
  if (status === 503 && !coreAvailable) return 'Available when connected to the APEX Core API.';
  return msg || fallback;
}

/** Organisations visible to the current user, plus an id → name map. */
export function useOrganizations({ enabled = true } = {}) {
  const query = useQuery({ queryKey: ['core', 'organizations'], queryFn: () => api.core.organizations(), enabled: coreAvailable && enabled });
  const names = Object.fromEntries((query.data || []).map((o) => [o.id, o.name]));
  return { ...query, names };
}

/** A user's display label (name and email), loaded on demand and cached. */
export function useUserLabel(id) {
  const query = useQuery({
    queryKey: ['core', 'user', id],
    queryFn: () => api.core.user(id),
    enabled: coreAvailable && !!id,
    staleTime: 60_000,
    retry: false,
  });
  const u = query.data?.user;
  return u ? (u.full_name ? `${u.full_name} (${u.email})` : u.email) : null;
}
