# 5. Budget the initial payload in CI

- Status: accepted
- Date: 2026-09-02

## Context

`manualChunks: { pdf: ['jspdf'], three: ['three'], motion: [...] }` looked like
straightforward vendor splitting. It was not: Rollup hosted Vite's
dynamic-import preload helper inside the jsPDF chunk, every lazy route needs
that helper, so the entry chunk statically imported it — and every visitor
downloaded 114 KB gzipped of PDF machinery to look at the login page.

The build output said nothing. Each chunk was individually reasonable; the
problem was only visible in which of them `dist/index.html` preloads.

## Decision

Two changes:

- `manualChunks` is now a function that only ever assigns paths under
  `node_modules`, and only for React and the router — dependencies that are in
  the entry graph anyway, so a stable vendor chunk is a straight win. three.js
  and jsPDF are left to Rollup, which puts them in the chunk of the lazy route
  that needs them.
- `scripts/checkBundle.mjs` reads `dist/index.html`, sums the gzipped size of
  the entry script plus everything it preloads, and fails over 90 KB. It runs
  after `vite build`.

## Consequences

- Initial payload went from 209 KB gz to 58 KB gz.
- The same mistake now fails the build rather than sitting in the repo.
- The budget needs raising deliberately when the app legitimately grows, which
  is the point: it becomes a decision instead of a drift.
- three.js and jsPDF no longer have their own long-lived cache entries. Worth
  it: they were being downloaded by people who never reached those routes.
