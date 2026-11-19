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

- Acknowledgement within **2 working days**.
- An assessment (real or not, severity, affected components) within **5 working days**.
- A fix within the timeline for its severity (below). Identity, authorisation and data-exposure
  issues come first at equal severity.
- Credit in the fix notes if you want it.

## Vulnerability management

### Where findings come from

| Source | Where it runs |
|---|---|
| Private reports | GitHub private vulnerability reporting (above) |
| Secret scanning | CI `secret-scan` (gitleaks, full history) |
| Static analysis | CI `sast` (Semgrep: JavaScript incl. Express, Node.js, React, OWASP Top 10) |
| Dependencies | CI `npm audit` (production, high and above, blocking), Dependabot (weekly) |
| Container images | CI image scan (Trivy, fixable HIGH and CRITICAL) |
| Dockerfile / Compose | CI `iac-scan` (Trivy config) |
| Running application | CI OWASP ZAP baseline against the private staging stack |
| Audits and tests | `docs/security/`, penetration tests |

Every CI scanner is blocking: a new HIGH or CRITICAL finding stops the merge.

### Severity and fix timelines

Severity is the scanner's or the CVSS rating, raised one level for anything that touches
identity, authorisation, or personal data, and lowered one level only when the vulnerable code
cannot be reached (record why).

| Severity | Fix or mitigate within |
|---|---|
| Critical | 2 days |
| High | 7 days |
| Medium | 30 days |
| Low | 90 days, or the next planned release |

A leaked secret is always Critical: **rotate it first**, then remove it from the code. Rewrite
history only if the founder authorises it, because rewriting does not un-leak a pushed secret.

### Triage and tracking

1. **Record it.** Use a private GitHub security advisory for anything exploitable. Use an
   issue labelled `security` for scanner findings that are not exploitable as they stand.
2. **Assess it:** is it real, how severe, which components, and who owns it.
3. **Fix it** with a regression test where one is possible. Reference the advisory or issue in
   the commit.
4. **Close it** when CI is green with the fix merged. Publish the advisory once a fix is
   available.

### Accepted risks (false positives and exceptions)

Ignore files are the only place a finding may be accepted:

- `.gitleaks.toml`
- `.semgrepignore`
- `.trivyignore.yaml`
- `deploy/staging/zap-rules.tsv`

Each entry must:

- be scoped to the narrowest path or rule,
- say why it is safe,
- be reviewed when the file it covers changes.

A real vulnerability is never accepted to make CI green. An exception for one needs the founder's
written approval and an expiry date.

### Periodic review

- **Monthly:** review open security issues, advisories and Dependabot pull requests.
- **Every revision of the audit:** re-check the ignore files.
- **Penetration test:** an independent test before the first external pilot (R6), then yearly
  and after major changes to identity or authorisation.

## Scope and status

APEX is in development and is **not deployed**; there is no production environment yet. The current
security position, controls and known gaps are recorded in
[`docs/security/APEX_Security_Audit.md`](docs/security/APEX_Security_Audit.md).

## For contributors

- Identity and authorisation rules are binding: `docs/implementation/R1_IDENTITY_CONTRACT.md`,
  `R1_LINKING_ADDENDUM.md` and ADRs 0002–0004. Server-side default deny; never link accounts by email
  or name.
- Never commit `.env` files, keys, databases or backups. The CI scanners listed above are blocking;
  follow the accepted-risk rules rather than weakening a scanner.
