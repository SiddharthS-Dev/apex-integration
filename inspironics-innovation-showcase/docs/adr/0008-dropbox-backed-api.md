# 8. Serve the library from Dropbox through our own API

- Status: accepted
- Date: 2026-09-23

## Context

The showcase shipped as a static site: 235 plates bundled into the build, and
accounts in `localStorage`. Adding a plate meant a rebuild; the library could
not grow with the work, and nothing about who used it was known.

The plates already live in Dropbox, and the SlidesVault project had settled a
design for exactly this — a presentation hub over Dropbox — that has held up in
use. This project adopts the same design.

## Decision

- **Dropbox is the source of truth; the browser never talks to it.** An API
  (`apps/api`) owns the connection, indexes the files, and proxies every byte.
  Catalog records carry same-origin paths only.
- **Credential model:** the OAuth refresh token is stored AES-256-GCM encrypted;
  access tokens exist only in process memory. Refreshes are single-flighted in
  process and locked across instances.
- **Sync, not live listing:** a scheduled, locked, resumable pipeline —
  discover, compare by revision, process through a bounded pool, archive what
  vanished (never delete), log the run.
- **Seed overlay:** the curated metadata of the original 235 plates is kept and
  applied by filename, ahead of any model classification.
- **Monorepo** with `@inspironics/shared` holding the taxonomy and plate
  contract, so the classifier can only answer in categories the gallery knows.
- **Two backends behind the client's existing seams** (`VITE_BACKEND`): the API,
  or the original in-browser demo. The auth service and the catalog loader are
  the only modules that know which.

## Consequences

- The site needs a server now. `start.bat demo` / `VITE_BACKEND=local` keeps the
  serverless build working for demos and for the original smoke suite.
- ADR 0004 predicted a backend would be "one new file implementing the
  repository contract". It was one new file, but a *service*
  (`httpAuthService.js`) rather than a repository: with a server, the flows
  themselves — code checks, hashing, attempt limits — belong on the server, so
  the contract that carried over is the service surface the pages call, not the
  storage one beneath it.
- Same-origin is a requirement, not a convenience: the session is a SameSite=Lax
  cookie and the plate viewer is an `<iframe>`.
- No mail transport yet: verification and reset codes are shown on screen
  outside production and must be mailed in production.
- AI classification is optional and off by default; without it, titles come
  from the seed, embedded metadata or the filename, and new plates are filed as
  Unclassified until an admin or the model classifies them.
