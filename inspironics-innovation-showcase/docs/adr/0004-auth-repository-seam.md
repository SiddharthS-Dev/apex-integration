# 4. Put auth behind a repository contract

- Status: accepted
- Date: 2026-09-02

## Context

The build ships without a server, so accounts, one-time codes and sessions live
in `localStorage`. That is temporary; the flows around them are not. The old
`lib/auth.js` interleaved all three concerns — flow, storage and crypto — in one
file, so "swap in a backend" meant rewriting it and hoping the behaviour held.

## Decision

Three pieces:

- `model/` — credential rules, code policy, session shape. Pure functions.
- `api/authRepository.js` — the storage contract, as a typedef.
- `api/authService.js` — the flows, written against that contract, containing no
  storage access and no crypto.

`createAuthService(repo)` is the seam. The default export wires it to
`createLocalAuthRepository()`.

## Consequences

- A real backend is one new file implementing the contract, plus one changed
  line. Nothing in the model, the context, the pages or the tests moves.
- `tests/authRepositorySeam.test.mjs` runs every flow against an in-memory
  repository with no browser API present. If that ever needs a DOM, the seam has
  leaked.
- One more indirection to read through when following a single flow.
- The contract is a typedef, so a wrong implementation fails at runtime rather
  than at build time. The seam test is the compensating control.
