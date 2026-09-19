# 1. Organise src/ by feature, in three layers

- Status: accepted
- Date: 2026-09-02

## Context

`src/` was grouped by file type: `components/inspironics/` held eighteen
components side by side, `lib/` held ten unrelated modules, `pages/` held seven.
Nothing said which parts belonged together, and the graph showed it — the
gallery imported `SectionHead` from inside `EcosystemExplorer`, and any module
could reach any other.

## Decision

Three layers: `shared/` (belongs to no feature), `features/<name>/` (a slice of
the product, end to end), `app/` (the composition root). Dependencies point
downwards only. A feature is organised by role — `api/`, `model/`, `context/`,
`components/`, `pages/` — not by file type.

Each feature exposes a public surface through `index.js`, plus a domain-only
`model/index.js` so one feature's data code can use another's without pulling in
a component tree.

## Consequences

- Where a file goes is now a question with an answer.
- Cross-feature coupling is visible: it has to pass through a barrel.
- The build fails if the rules are broken (see ADR 3).
- Two barrels per feature is slightly more ceremony than one.
