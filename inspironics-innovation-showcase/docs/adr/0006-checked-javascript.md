# 6. Check the JavaScript rather than migrate to TypeScript

- Status: accepted
- Date: 2026-09-02

## Context

The contracts in this codebase — the auth repository interface, the route spec,
the quality tiers — were JSDoc typedefs. They documented and autocompleted, but
nothing failed when an implementation disagreed with them, which is most of the
value of having written them down.

The obvious answer is a TypeScript migration. That means renaming ~60 files,
including a 2,600-line Three.js builder whose types are largely uninteresting,
in one large and risky change.

## Decision

`tsconfig.json` with `allowJs` and `checkJs`, `noEmit`, and `strict: false`.
The existing JSDoc becomes enforced, in place, with no renames. `npm run
typecheck` runs in the build and in CI.

Getting to zero errors took ~15 edits, and several were real looseness worth
fixing rather than silencing:

- jsPDF colour constants were `number[]` spread into a three-argument call, so
  a four-element palette entry would have reached runtime. Now tuples.
- `err.code = 'UNVERIFIED'` on a bare `Error` became an `UnverifiedAccountError`
  class.
- Several local components required every prop because none had defaults, so
  the inferred shape lied about what was optional.
- `types/globals.d.ts` declares `navigator.deviceMemory`, `window.google` and
  `ImportMetaEnv` — without them `checkJs` cannot distinguish a typo from a
  legitimate use of an optional API.

## Consequences

- The contracts now fail the build. `strict` is off, so this is a floor, not a
  ceiling.
- A `.ts` migration remains available and is now cheaper: the errors it would
  surface have already been fixed, and it can go feature by feature.
- Two type declarations of the alias map to keep in step (tsconfig paths and
  package.json imports).
