# 2. Use package.json `imports` for aliases, mirrored in Vite

- Status: accepted
- Date: 2026-09-02

## Context

Layering means crossing boundaries by alias rather than by `../../..`. The usual
answer is a bundler alias, but the unit tests run on plain Node with no bundler
and no runner config, so a Vite-only alias would have made every domain module
untestable without one.

## Decision

Declare `#app/*`, `#features/*` and `#shared/*` in the `imports` field of
`package.json` — a Node standard, resolved with no tooling — and mirror the same
three prefixes in `vite.config.js` and `jsconfig.json`.

Node ESM does not resolve a directory to its `index.js`, so each barrel gets an
explicit entry in the map alongside the wildcards.

## Consequences

- `node --test` resolves `#features/ecosystem/model` with zero configuration.
- The mapping is declared three times and must not drift. `jsconfig.json` is
  advisory; the two that matter are checked by the test suite and the build,
  since a mismatch fails one or the other immediately.
- Convention: `.js` specifiers keep their extension because Node needs it;
  `.jsx` omit it because only the bundler loads them.
