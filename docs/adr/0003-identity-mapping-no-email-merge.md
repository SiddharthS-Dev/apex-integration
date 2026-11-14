# 3. Link existing accounts by explicit, reviewed mappings — never by email alone

- Status: accepted — founder approved DEC-009 on 2026-11-14, adding: "Preserve passwordless Google sign-in through verified provider-and-subject mappings."
- Date: 2026-11-14
- Phase: R0 Discovery; implementation belongs to R1 (master plan Use Case 004)

## Context

Moving three user tables onto one Core identity (ADR 0002) means deciding which existing accounts belong
to the same person. Matching email addresses are tempting but unsafe:

- An address can be reused, shared or mistyped.
- An address can be registered by someone else. The Showcase had an account pre-hijack bug of exactly this kind (audit F-004, fixed in `2ccbb9b`).
- Accounts with the same address can differ in role, status, name or sign-in method.

R0 evidence (`docs/discovery/R0_DISCOVERY_REPORT.md` §3):

- The only address present in all three apps already has a **name difference** between apps. It is classified `multi-app-conflict`.
- A second address exists only in Academia.

## Decision

1. **Mapping records.** An `identity_links` table records `(core_user_id, app, app_user_id, status, proposed_by, reviewed_by, reviewed_at, evidence)`. Status is one of `proposed`, `confirmed` or `rejected`.
2. **The report proposes; it never links.** `tools/discovery/user-overlap.mjs` (R0) classifies accounts. An R1 migration step may create `proposed` links only for `multi-app-consistent` groups. Groups classified `multi-app-conflict` or `single-app-conflict` get no automatic proposal.
3. **A person confirms.** A platform administrator confirms or rejects each proposed link. A different administrator must review any link that grants an admin role. Every decision writes an audit event.
4. **The account holder can also prove a link.** Signed in to the Core, a user may claim an app account by signing in to it once (proof of possession). This produces a `confirmed` link with `evidence = 'possession'`.
5. **Unlinked accounts keep working** through the existing per-app login until linked or retired. Nothing is deleted.
6. **External sign-in is linked by provider and subject only.** A Google account is identified by its verified `(provider, subject)` pair, stored in `external_identities`, never by the email it reports. Signing in with Google finds the Core user only through that pair.
7. **Conflicts resolve to the least privilege.** A confirmed Core user starts with no admin role unless an administrator grants it explicitly through a role assignment.

## Rollback and recovery

- Links are additive rows. Rejecting or deleting a link restores the previous state; app user rows are not modified by linking.
- The R1 migration must run first as a dry run against a snapshot copy, producing the proposal list for review, exactly as the R0 report does.

## Consequences

- Linking is slower than an automatic merge, but it is safe and auditable. At the current scale (2 distinct emails) the review costs minutes.
- R1 needs a small admin screen for the review queue and a user flow for claiming by possession.
