# Architecture

A single-page React app with no backend. The interesting parts are a 235-plate
image corpus with derived aggregates, a Three.js city that acts as a navigation
surface, and an auth flow that has to behave like a real one without a server to
talk to.

## Layers

Three layers, bottom to top. Dependencies only ever point downwards.

```
              ┌──────────────────────────────────────────┐
   entry      │ src/main.jsx                             │  mounts the app
              └────────────────────┬─────────────────────┘
                                   │
              ┌────────────────────▼─────────────────────┐
   app        │ src/app/                                 │  composition root
              │  App.jsx · routes.jsx · pages/ · Navbar  │  may import anything
              └────────────────────┬─────────────────────┘
                                   │
       ┌───────────┬───────────┬───┴───────┬───────────┬───────────┐
       │           │           │           │           │           │
   ┌───▼───┐  ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐
   │ auth  │  │showcase │ │ecosystem│ │ copilot │ │ report  │ │  site   │   features
   └───┬───┘  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
       └───────────┴───────────┴───────┬───┴───────────┴───────────┘
                                       │
              ┌────────────────────────▼─────────────────┐
   shared     │ src/shared/  config · ui · lib           │  knows about nothing
              └──────────────────────────────────────────┘
```

### `src/shared/`

Things that belong to no feature: the config module, presentational components
used across features (`SectionHead`, `Loader`, `Logo`, `Markdown`,
`ErrorBoundary`), and small utilities (`scrollLock`, the `RouteSpec` typedef).
Shared code may not import a feature or the app.

`shared/config` is the only module in the codebase that reads
`import.meta.env`, and it owns every storage key and policy constant. The set of
things a deployment can change is exactly the shape of that file.

### `src/features/<name>/`

A feature owns a slice of the product end to end, and is organised by role
rather than by file type:

```
features/auth/
  index.js                 public surface — the only entry from outside
  routes.jsx               its own lazy route table
  api/                     transport and persistence
    authRepository.js        the storage contract (typedef)
    localAuthRepository.js   localStorage implementation
    authService.js           the flows, written against the contract
  model/                   pure domain rules, no React, no storage
    credentials.js · codes.js · session.js
  context/                 React state
  components/ · pages/     UI
```

Not every feature needs every folder. `ecosystem` has `model/` (data),
`render/` (the Three.js builders) and `components/`; `site` is components only.

### `src/app/`

The composition root. It wires providers, the error boundary, the suspense
fallback and the route table, and holds the one page that composes several
features at once (`Home`). It is the only layer allowed to know about every
feature simultaneously.

## Rules

Enforced by `npm run lint:arch` ([scripts/checkArchitecture.mjs](../scripts/checkArchitecture.mjs)),
which runs as part of `npm run build`:

1. **`shared/` must not depend on `features/` or `app/`.** It is the bottom of
   the stack.
2. **`features/` must not depend on `app/`.** A feature cannot know how it is
   composed.
3. **A feature's internals are private.** From outside, the only importable
   paths are `#features/<name>`, `#features/<name>/model` and
   `#features/<name>/routes.jsx`. Reaching for
   `#features/showcase/components/Gallery` fails the check.
4. **Relative imports stay inside their own layer.** Crossing a boundary uses
   an alias, so the cross-layer graph is greppable.

Rule 3 is what stops the structure eroding. It caught two violations while this
layout was being built, including a JSDoc `import()` that pointed a feature at
`app/`.

### Two barrels per feature

`#features/<name>` is the full surface, for the app and for UI. `#features/<name>/model`
is domain-only — data and pure functions, no React. Domain code in one feature
imports another feature's `model`, so a data module never drags a component tree
into its chunk.

## Path aliases

`#app/*`, `#features/*` and `#shared/*` are declared twice on purpose:

- **`imports` in `package.json`** — the Node standard. This is what the unit
  tests resolve, with no runner configuration at all.
- **`resolve.alias` in `vite.config.js`** — what the bundler resolves.

They must not drift — a mismatch fails either the test suite or the build
immediately. `tsconfig.json` mirrors them a third time, for the type checker and
for editors. Node ESM does not resolve a directory to its `index.js`, so barrel
specifiers have explicit entries in the `imports` map.

Convention: `.js` imports carry their extension (Node needs it), `.jsx` imports
omit it (only the bundler ever loads them).

## Auth without a backend

The reason auth is split three ways is that the store is temporary and the
flows are not. `authService.js` contains no storage access and no crypto — the
repository owns where state lives, `model/` owns the rules. Pointing the app at
a real API is one new file:

```js
export const api = createAuthService(createHttpAuthRepository('/api/auth'))
```

[tests/authRepositorySeam.test.mjs](../tests/authRepositorySeam.test.mjs) runs
every flow against an in-memory repository with no browser API present, which
is the proof that the seam is real rather than aspirational.

What is already production-shaped: PBKDF2-HMAC-SHA256 password hashing with
per-account salts, one-time codes stored only as salted hashes with attempt
limits, constant-time comparison, and session expiry re-checked on a timer, on
refocus and across tabs. What is not: it is all still in `localStorage`, and
`getDemoCode()` exists so the flow is completable without a mail service.

## Rendering budget

The Three.js city is the heaviest thing here.
[explorerQuality.js](../src/features/ecosystem/render/explorerQuality.js) defines
high/medium/low tiers plus off, auto-detects from the device, and remembers an
explicit choice. Only the counts that cost frame time change, so the low tier is
cheaper rather than unfinished. The scene also sits behind its own error
boundary: losing the city should still leave you a gallery.

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint:arch` | layer and boundary rules |
| `npm run typecheck` | `checkJs` over all of `src` — the JSDoc contracts, enforced |
| `npm test` | 53 tests on `node:test`: domain units plus jsdom component tests |
| `npm run check:routes` | asserts every ecosystem node resolves to a non-empty gallery |
| `npm run check:bundle` | initial payload against a 90 KB gz budget |
| `npm run build` | all of the above, around `vite build` |
| `npm run smoke` | end-to-end browser pass (needs a dev server and Chrome) |

### Payload

The entry graph is what a first-time visitor downloads before anything renders,
and it is budgeted:

| | gzipped |
| --- | --- |
| entry + React vendor chunk (eager) | ~58 KB |
| `EcosystemCanvas` incl. three.js (lazy, on scroll) | ~197 KB |
| `MonthlyReport` incl. jsPDF (lazy, on `/report`) | ~118 KB |

three.js is loaded by an `IntersectionObserver` gate, so the "3D off" tier and
the auth routes never fetch it at all.

## Known trade-offs

- **Still JavaScript, but checked.** `checkJs` is on for all of `src` with
  `strict: false`, so the JSDoc contracts fail the build — but a wrong
  repository implementation is caught by the seam test, not the compiler. A
  `.ts` migration is cheaper now that the errors are fixed (ADR 6).
- **Dependency advisories.** `npm audit` reports a critical ReDoS in jsPDF and
  an open-redirect in react-router. Both need major-version upgrades and
  deserve their own pass.
- **jsdom is not a browser.** Layout, compositing and focus visibility still
  need the smoke script.
- **`inspironics/`** at the repo root is the legacy image tree plus an unused
  Next.js prototype. The Vite plugin serves `inspironics/{thumbs,full}` at
  `/images`; the rest is not part of this app.
