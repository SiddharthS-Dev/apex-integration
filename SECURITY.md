# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability**
(private vulnerability reporting must be enabled in Settings → Code security). Include what you
found, how to reproduce it, and the affected component (`apex/` gateway, APEX Core / Inspironics
Academia, Innovation Showcase, SlidesVault, or `onboarding/`).

Never include real user data, passwords, tokens or keys in a report. If you came across a secret,
say where it is; do not paste it.

## What to expect

- Acknowledgement of the report.
- An assessment and, where it is a real issue, a fix on a priority basis: identity, authorisation
  and data-exposure issues first.
- Credit in the fix notes if you want it.

## Scope and status

APEX is in development and is **not deployed**; there is no production environment yet. The current
security position, controls and known gaps are recorded in
[`docs/security/APEX_Security_Audit.md`](docs/security/APEX_Security_Audit.md).

## For contributors

- Identity and authorisation rules are binding: `docs/implementation/R1_IDENTITY_CONTRACT.md`,
  `R1_LINKING_ADDENDUM.md` and ADRs 0002–0004. Server-side default deny; never link accounts by email
  or name.
- Never commit `.env` files, keys, databases or backups. CI runs secret scanning (gitleaks),
  static analysis (Semgrep), dependency audits, Dockerfile/Compose and container image scans, and an
  OWASP ZAP baseline against the private staging stack.
