# 3. Enforce the layering with a script, not a linter plugin

- Status: accepted
- Date: 2026-09-02

## Context

Documented layering decays. The conventional enforcement is ESLint with an
import-boundaries plugin, which means adding a linter, a config and two or three
dependencies to a project that currently has none.

## Decision

`scripts/checkArchitecture.mjs`: a dependency-free scan of every import in
`src/`, checked against four rules, wired into `npm run build`.

It resolves aliases and relative paths the same way the bundler does, so it sees
the real graph rather than a text pattern.

## Consequences

- Broken boundaries fail the build, on any machine, with no install step.
- It caught two violations while the structure was being built — including a
  JSDoc `import()` type reference that pointed a feature at `app/`, which is
  exactly the kind of thing a reviewer would wave through.
- It only understands imports. It cannot see, say, a feature depending on
  another's DOM structure. Adopting ESLint later would supersede it.
