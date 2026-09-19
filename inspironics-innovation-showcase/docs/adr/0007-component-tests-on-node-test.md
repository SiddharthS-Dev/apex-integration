# 7. Component tests on node:test, with an esbuild JSX hook

- Status: accepted
- Date: 2026-09-02

## Context

Unit coverage stopped at the domain layer. Everything with a DOM — the three
overlays, the filters, the quality picker — was only exercised by the browser
smoke script, which needs a dev server and a real Chrome and takes minutes.
That is the wrong loop for testing whether Tab wraps inside a dialog.

## Decision

Stay on `node --test`, and give it the two things it lacks:

- `tests/dom.mjs` installs a fresh jsdom per test.
- `tests/jsxLoader.mjs` is a Node module hook that transforms `.jsx` through
  esbuild, which is already installed because Vite depends on it. Registered
  via `--import ./tests/register.mjs`.

No test runner, no config file, no second toolchain.

## Consequences

- 16 DOM tests covering the dialog behaviour and the add-plate modal, running
  in about a second.
- Writing them found two real defects that the browser suite had missed: the
  scroll lock kept its reference count in module state, which does not survive
  a new document (now stored on the `<body>` element), and jsdom's realm
  handling exposed that a stale `CustomEvent` constructor silently breaks the
  custom-item change event.
- jsdom is not a browser. Layout, compositing and focus-visibility still need
  the smoke script — as the skip link proved, since headless Chrome will not
  settle a transform transition without a visible window.
