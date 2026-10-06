# Apex

The Inspironics home dashboard. One address, one port, three products:

| Path         | Project                        | Lives in                          |
| ------------ | ------------------------------ | --------------------------------- |
| `/`          | Apex dashboard                 | `apex/`                           |
| `/showcase/` | Inspironics Innovation Showcase | `inspironics-innovation-showcase/apps/web` |
| `/showcase/api` | Innovation Showcase API     | `inspironics-innovation-showcase/apps/api` |
| `/vault/`    | Inspironics SlidesVault        | `slide vault/apps/web`            |
| `/vault/api` | SlidesVault API                | `slide vault/apps/api`            |
| `/academia/` | Inspironics Academia           | `Inspironics Academia/apps/web`   |
| `/academia/api` | Inspironics Academia API    | `Inspironics Academia/apps/api`   |

---

## Running it

```
start.bat              dev, on http://localhost:5173
start.bat prod         builds every project, then serves them on 4173
start.bat prod 4180    the same, on a port of your choosing
stop.bat               stops everything Apex started
stop.bat 4180          the same, plus a gateway on a custom port
```

Open the dashboard, click a card, and that project opens in the same window at
the same address. The browser opens by itself once the gateway is listening.

First run installs each project's dependencies, which takes a few minutes.
After that, startup is a few seconds. The dashboard is reachable before the two
dev servers finish booting, so a card may read **Starting** for a moment before
it turns **Ready** — nothing to do, it polls and updates itself.

There is **one sign-in** for everything, at `/login`. Nothing — the dashboard,
any app, or their APIs — is reachable before it. Signing in checks the email
and password against every app's own accounts and opens every app that accepts
them at once, so no app asks again. An app that is down, or does not know the
account, is skipped rather than failing the sign-in; its dashboard card reads
**Sign in required** and leads back to the form. **Sign out** on the dashboard
signs out of all of them. When one app's own session ends, it sends you to
`/login?reauth=1`, which shows the form without signing the others out. The
standard account is `admin@inspironics.net` (`BOOTSTRAP_ADMIN_*` in each
`apps/api/.env`). See `apex/auth.mjs`.

Each app's session cookie is scoped to its own mount (`Path=/vault/` and so on)
and the gateway forwards it to that app only, never another app's cookie or
`apex_session`. The one exception to the sign-in is a certificate's
verification link, `/academia/verify/<id>`: signed out, the gateway answers it
with its own small page (`apex/public/verify.html`), backed by the one public
call `POST /academia/api/functions/verifyCertificate`.

### Settings

All optional, set in the environment before `start.bat`:

| Variable             | Default                     | What it does |
| -------------------- | --------------------------- | ------------ |
| `APEX_HOST`          | `127.0.0.1`                 | The interface the gateway listens on. Loopback means this machine only. `0.0.0.0` opens it to the network — prefer a reverse proxy. The apps' own dev servers and APIs always stay on `127.0.0.1`. |
| `APEX_PUBLIC_URL`    | `http://localhost:<port>`   | The URL browsers use. Behind an https reverse proxy set it, e.g. `https://apex.example.com`: every origin, OAuth redirect URI and API base handed to the apps is built from it, sign-in accepts it as an origin, and with `https` every app's session cookie becomes `Secure`. Register the redirect URIs `start.bat` prints for it. |
| `APEX_TRUST_PROXY`   | unset                       | Set to `1` when that proxy sets `X-Forwarded-For` (overwriting, not appending), `-Proto` and `-Host`. The gateway then takes the client address for its sign-in rate limit from the left-most `X-Forwarded-For`. Leave unset otherwise — any client could claim any address. |
| `APEX_SESSION_HOURS` | `12`                        | How long one sign-in lasts. Each app is started with the same `SESSION_TTL_HOURS`, so no app session outlives Apex's. |
| `APEX_PORT`          | `5173` dev, `4173` prod     | The gateway's port (`start.bat prod 4180` sets it too). |

`start.bat prod` runs every API with `NODE_ENV=production`. Over plain
`http://localhost` that still works: each app is told its cookies are not
`Secure` (`COOKIE_SECURE=false`, `SESSION_COOKIE_SECURE=false`). A public
`APEX_PUBLIC_URL` must be `https` — the Showcase API refuses to start in
production otherwise.

---

## How it fits together

The Showcase and SlidesVault are two complete single-page apps. They have their
own routers, their own auth, and — the part that decided the design — two
incompatible Tailwind themes: the Showcase is dark-only with `bg-ink` / cyan
tokens, SlidesVault is a shadcn-style HSL palette with a light/dark toggle.
Merged into one bundle, their `:root` variables and `body` rules would fight.

So Apex does not merge them. It puts a small gateway in front:

```
                    browser  ──►  http://localhost:5173
                                        │
                              apex/server.mjs  (the gateway)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
        /  dashboard      /showcase/ ──► vite :5174   /vault/ ──► vite :5175   /academia/ ──► vite :5176
     apex/public/index.html      (dev)                     (dev)                     (dev)
                             dist/ (prod)              dist/ (prod)              dist/ (prod)
```

Each project still builds and ships its own bundle, so their CSS can never
collide. What they share is an origin, which is what makes the dashboard feel
like one product instead of three bookmarks.

`apex/server.mjs` has **no dependencies** — Node builtins only. There is no
third `node_modules` and nothing to install for the shell itself.

### What each project needed

Mounting an SPA under a path rather than at the site root takes two things:
Vite must prefix the asset URLs, and the router must know it no longer owns `/`.

- `vite.config.js` — `base` (`/showcase/`, `/vault/`), its own dev port, and
  `hmr.clientPort: 5173` so hot reload still runs over the one open port.
- The router — `basename` taken from `import.meta.env.BASE_URL`, so it tracks
  `base` instead of hard-coding the mount.
- Anything built from an absolute `/…` path at runtime — the Showcase's
  `/images` and `/data/showcase.json`, SlidesVault's `/logo.svg` and its web
  manifest. These are invisible to `base`, because Vite only rewrites what it
  can see at build time.

Both apps still run standalone. `baseUrl === '/'` is the standalone case, and
the "← Apex" link in each app's header hides itself when there is no dashboard
to go back to.

### Both projects run on Dropbox

The Showcase and SlidesVault are each the full standalone monorepo — `apps/web`
(React), `apps/api` (the Dropbox integration layer) and `packages/shared` — and
work the same way: Dropbox holds the files, the API syncs and indexes them and
proxies every byte, and **the browser never talks to Dropbox**. Each API is
reached through the gateway under its app's mount (`/showcase/api`,
`/vault/api`) with the mount stripped, so the app, its API and its session
cookie (`insp_session`, `sv_session`) share one origin.

They use the same Dropbox app, so register **every** redirect URI in its App
Console (OAuth 2 → Redirect URIs), character for character:

```
http://localhost:5173/showcase/api/dropbox/oauth/callback
http://localhost:5173/vault/api/dropbox/oauth/callback
http://localhost:5173/academia/api/dropbox/oauth/callback
```

All three sign in with the same standard administrator — `admin@inspironics.net`,
set as `BOOTSTRAP_ADMIN_*` in each `apps/api/.env` (gitignored). Then **Admin
console → Connect Dropbox** in the Showcase, **Dropbox Settings → Connect**
in the vault, or **Admin → Integrations → Connect Dropbox** in the Academia
(`/academia/admin/integrations`, which also shows its redirect URI with a copy
button), pick the folder, and run a sync.

Each child process is started by `apex/run.mjs`, which gives it exactly the
environment `apex/projects.mjs` defines for it, computed from the gateway
port. It exists because both APIs read `PORT` and `DROPBOX_REDIRECT_URI` and
both web apps read `VITE_API_BASE_URL`: set globally in start.bat, one
project's values would leak into the other's. `node apex/run.mjs redirects`
prints the redirect URIs for the current port.

### SlidesVault and Dropbox

SlidesVault is the same monorepo as the standalone SlidesVault — `apps/web`
(the React client), `apps/api` (the Dropbox integration layer) and
`packages/shared` — and it works the same way. Dropbox holds the files; the
API syncs, indexes and enriches them, and serves the catalog, thumbnails and
file bytes. **The browser never talks to Dropbox**: every Dropbox call and
every byte goes through the API, and `apex/smoke.mjs` fails if the page ever
contacts a Dropbox host.

Under Apex the API is reached through the gateway at `/vault/api`, so the app,
the API and the `sv_session` cookie (SameSite=Lax) all share one origin —
which is what lets the presentation `<iframe>` carry the session. The gateway
strips `/vault` before forwarding, so the API still sees its own `/api/…`
paths.

#### Connecting Dropbox

1. In the [Dropbox App Console](https://www.dropbox.com/developers/apps), open
   the app and add this under **OAuth 2 → Redirect URIs**, character for
   character:

   ```
   http://localhost:5173/vault/api/dropbox/oauth/callback
   ```

   Add it beside the standalone's `http://localhost:4000/…` URI — an app can
   hold several. (For `start.bat prod` it is the same path on 4173, or on
   whatever port you passed; start.bat prints the exact one on launch.)
2. `start.bat`, open **SlidesVault**, sign in as the bootstrap admin from
   `slide vault/apps/api/.env`.
3. **Dropbox Settings → Connect**, approve at Dropbox, pick the sync folder,
   **Run sync now**. The scheduler keeps it current every 30 minutes after that.

The Dropbox app key and secret live in `slide vault/apps/api/.env` (gitignored).
apex/run.mjs sets the URL settings in it — `PORT`, `APP_BASE_URL`,
`DROPBOX_REDIRECT_URI` and friends — from the gateway port on every launch,
so they never drift from where Apex is actually served. If the file is
missing, start.bat creates it from `.env.example` and stops so you can fill in
the Dropbox credentials and an encryption key.

This install keeps its own database (`slide vault/apps/api/data/`), so it holds
its own Dropbox connection, separate from the standalone SlidesVault's.

### Inspironics Academia

The Academia (`Inspironics Academia/`, the Engineering Academy monorepo) is
mounted the same way, with two differences worth knowing:

- Its `vite.config.js` reads the mount and dev server from the environment
  apex/run.mjs gives it (`APEX_BASE`, `APEX_DEV_PORT`, `APEX_GATEWAY_PORT`),
  so `npm run dev` in its own folder still serves it standalone at `/`.
- Its API loads `apps/api/.env` with `--env-file-if-exists`, and the values
  apex/projects.mjs sets — `PORT`, `APP_BASE_URL`, `DROPBOX_REDIRECT_URI` —
  win over the file's. `APP_BASE_URL` is what sends the Dropbox OAuth return
  and password-reset links back under `/academia`.

For the one sign-in, its `.env` needs the same `BOOTSTRAP_ADMIN_EMAIL` as
the other two. Add `BOOTSTRAP_ADMIN_PASSWORD` as well and the account is
created at startup if it does not exist yet (it never resets an existing one).
Its database is `Inspironics Academia/apps/api/data/`.

### The ports

| Port | What                            |
| ---- | ------------------------------- |
| 5173 | the gateway — **the only one you open** |
| 5174 | Showcase dev server              |
| 5175 | SlidesVault dev server           |
| 5176 | Academia dev server              |
| 4176 | Showcase API (reached at `/showcase/api`) |
| 4175 | SlidesVault API (reached at `/vault/api`) |
| 4177 | Academia API (reached at `/academia/api`) |
| 4173 | the gateway in prod mode         |

All of 5174–5176 and the APIs on 4175–4177 are bound to `127.0.0.1` (Apex
starts each API with `HOST=127.0.0.1` and `TRUST_PROXY=loopback`, so it
believes the client address in the gateway's `X-Forwarded-For` and nobody
else's). None of them is meant to be visited directly — the API's OAuth
redirects and cookies only line up when it is reached through `/vault/api`.
The gateway itself listens on `APEX_HOST`, `127.0.0.1` by default, so Apex is
not reachable from another device unless you set `APEX_HOST=0.0.0.0` or put a
reverse proxy in front (see Settings above).

---

## Checking it still works

With Apex running:

```
node apex/smoke.mjs                              the integration itself
node apex/smoke.mjs http://localhost:4180        against a prod build
```

It drives a real browser: loads the dashboard, clicks each card, and checks the
project boots under its mount with no console errors — then signs in to
SlidesVault, because the login gate is where a wrong mount really shows.

The Showcase's own suites take a base URL, so they can be pointed through the
gateway too:

```
cd inspironics-innovation-showcase
node scripts/smoke.mjs http://localhost:5173/showcase
node scripts/flows.mjs http://localhost:5173/showcase
npm test
```

`scripts/smoke.mjs` skips its PDF step against a production build: that step
imports the app's source modules, which only a dev server serves.

---

## Adding another project

1. Add it to `PROJECTS` in `apex/projects.mjs` — `id`, `base`, `dir`, `devPort`.
2. In its `vite.config.js`, set `base` to the same mount, give it that
   `devPort` on `127.0.0.1`, and set `hmr.clientPort` to the gateway's port.
3. Give its router a `basename` of `import.meta.env.BASE_URL`.
4. Fix any absolute `/…` URLs it builds at runtime.
5. Add a card to `apex/public/index.html` (its `data-probe` is the mount) and
   launch it from `start.bat`. With an API, give it `sessionCookie` and
   `health` in `projects.mjs`: the sign-in page's steps and the dashboard's
   health probes come from there (`/auth/config`).

`apex/projects.mjs` is the source of truth for ports and mounts; the gateway,
the dashboard and the stop script all read from it.

---

## Troubleshooting

**The browser says ERR_CONNECTION_REFUSED on localhost:5173.** Nothing is
listening there, so Apex is not running — start it with `start.bat`. (If Apex
were up but a project were still booting, you would get its "Starting…" page
instead, not a refusal.)

This used to be a trap. Closing the gateway window left the two dev servers
running on 5174/5175, so the browser refused on 5173 while `start.bat` refused
to start — blocked by Apex's own orphans. Both ends are handled now: the
gateway takes its children down when it exits, and `start.bat` clears any
leftovers on the way up. Just run `start.bat` again.

**"Port N is in use by PID X, which does not belong to this folder."** Another
program has the port and Apex will not kill anything it does not own. Stop that
program, or move Apex's ports in `apex/projects.mjs`.

**A card stays on "Starting".** That project's dev server did not come up. Its
window is minimised, titled `Apex - Innovation Showcase`, `Apex - SlidesVault` or
`Apex - Inspironics Academia`;
the error is in there.

**A project 404s or loads unstyled.** Something is requesting an absolute path
that ignores the mount. Look in the browser's network tab for a request to
`/something` rather than `/showcase/something`, and route it through
`import.meta.env.BASE_URL`.
