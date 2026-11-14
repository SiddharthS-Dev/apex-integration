#!/usr/bin/env node
/**
 * End-to-end smoke test of the private staging stack (R1 identity contract §5). Node built-ins only;
 * self-contained, so it also runs inside a throwaway container on the backend network.
 *
 *   node deploy/staging/smoke.mjs [gateway]   from the host, through the published gateway port
 *   node smoke.mjs bypass                     from a container on the backend network, straight at
 *                                             the APIs (CI: docker run --network apex-staging-backend)
 *
 * gateway mode reads deploy/staging/.env.staging (SMOKE_ENV_FILE overrides) for the test admin and
 * the port; SMOKE_BASE_URL overrides the address. bypass mode needs SMOKE_KID (the current key id,
 * not secret); SMOKE_SHOWCASE_URL, SMOKE_SLIDESVAULT_URL and SMOKE_CORE_URL override the targets.
 * Set SMOKE_CHECK_UNPUBLISHED=0 to skip the "no app port reachable from the host" check (only
 * meaningful where the stack runs in containers).
 *
 * Never prints a secret: only statuses, codes and the names of the checks.
 * Exit code 0 when every check passed, 1 otherwise.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ---------------------------------------------------------------- pure helpers (tested) -- */

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/**
 * An assertion in the gateway's format (apex/identity.mjs):
 * `<kid>.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, kid + "." + payloadB64))>`.
 * The smoke test signs with keys it makes up, so every one of these must be refused.
 */
export function forgeAssertion({ kid, key, audience, claims = {}, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const payload = { iss: 'apex-gateway', aud: audience, ...claims, iat: nowSeconds, exp: nowSeconds + 60 }
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', key).update(`${kid}.${body}`).digest('base64url')
  return `${kid}.${body}.${sig}`
}

/** Claims of a user who does not exist, with the most powerful role there is. */
export const INTRUDER = Object.freeze({
  sub: 'forged-core-user',
  app_user_id: null,
  email: 'intruder@forged.invalid',
  name: 'Forged',
  roles: [{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }],
})

/** A minimal cookie jar: name -> value from Set-Cookie headers; an expired/emptied cookie is dropped. */
export function updateJar(jar, setCookies = []) {
  for (const line of setCookies) {
    const [pair, ...attrs] = String(line).split(';')
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a)) ||
      attrs.some((a) => /^\s*expires\s*=/i.test(a) && Date.parse(a.split('=').slice(1).join('=')) < Date.now())
    if (!value || expired) jar.delete(name)
    else jar.set(name, value)
  }
  return jar
}

export const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

/** KEY=VALUE env file, optional single or double quotes (as generate-secrets.mjs writes it). */
export function parseEnv(text) {
  const out = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && ((value[0] === "'" && value.endsWith("'")) || (value[0] === '"' && value.endsWith('"')))) value = value.slice(1, -1)
    out[line.slice(0, eq).trim()] = value
  }
  return out
}

/* --------------------------------------------------------------------------- harness -- */

function harness() {
  const results = []
  return {
    results,
    async check(name, fn) {
      try {
        await fn()
        results.push({ name, ok: true })
        console.log(`  ok    ${name}`)
      } catch (error) {
        results.push({ name, ok: false })
        console.log(`  FAIL  ${name}\n        ${error.message}`)
      }
    },
    finish() {
      const failed = results.filter((r) => !r.ok)
      console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
      return failed.length ? 1 : 0
    },
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message)
}

async function call(base, pathname, { method = 'GET', headers = {}, body, jar, timeoutMs = 15_000 } = {}) {
  const h = { ...headers }
  if (jar?.size) h.Cookie = cookieHeader(jar)
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(base + pathname, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, setCookies: res.headers.getSetCookie?.() || [] }
}

const describe = (r) => `status ${r.status}${r.json?.code ? ` code ${r.json.code}` : ''}`

/** True when nothing accepts a TCP connection at host:port within the timeout. */
function refused(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (v) => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(timeoutMs, () => done(true))
    s.once('connect', () => done(false))
    s.once('error', () => done(true))
  })
}

/* ----------------------------------------------------------------------- gateway mode -- */

async function gatewayMode() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const envFile = process.env.SMOKE_ENV_FILE || path.join(here, '.env.staging')
  const env = { ...parseEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''), ...process.env }
  const base = (process.env.SMOKE_BASE_URL || `http://127.0.0.1:${env.APEX_STAGING_PORT || 4173}`).replace(/\/+$/, '')
  const email = String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = env.BOOTSTRAP_ADMIN_PASSWORD || ''
  const kid = env.APEX_IDENTITY_KID || 'k0'
  if (!email || !password) throw new Error(`BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not found (${envFile})`)

  const origin = new URL(base).origin
  const t = harness()
  const jar = new Map()
  const forged = (audience) => forgeAssertion({ kid, key: crypto.randomBytes(32), audience, claims: INTRUDER })
  console.log(`\n  APEX staging smoke — gateway ${base}\n`)

  await t.check('gateway health: /auth/config answers 200 with the three apps', async () => {
    const r = await call(base, '/auth/config')
    expect(r.status === 200, describe(r))
    const ids = (r.json?.apps || []).map((a) => a.id).sort().join(',')
    expect(ids === 'academia,showcase,vault', `apps: ${ids}`)
  })

  await t.check('signed out: app APIs refused at the gateway, even with a forged X-Apex-Identity', async () => {
    for (const [p, aud] of [['/showcase/api/auth/me', 'showcase'], ['/vault/api/presentations', 'slidesvault']]) {
      const r = await call(base, p, { headers: { 'X-Apex-Identity': forged(aud) } })
      expect(r.status === 401 && r.json?.code === 'APEX_SIGNIN_REQUIRED', `${p}: ${describe(r)}`)
    }
  })

  await t.check('sign-in with a wrong password is refused', async () => {
    const r = await call(base, '/auth/login', { method: 'POST', headers: { Origin: origin }, body: { email, password: `${password}-wrong` } })
    expect(r.status === 401, describe(r))
  })

  await t.check('sign-in through the gateway with the bootstrap test admin', async () => {
    const r = await call(base, '/auth/login', { method: 'POST', headers: { Origin: origin }, body: { email, password } })
    expect(r.status === 200, describe(r))
    updateJar(jar, r.setCookies)
    expect(jar.has('apex_session'), 'no apex_session cookie')
    expect(jar.has('iea_session'), 'no Core (iea_session) cookie')
    const apps = (r.json?.apps || []).slice().sort().join(',')
    expect(apps === 'academia,showcase,vault', `signed in to: ${apps} (showcase and vault count only through the Core identity)`)
  })

  await t.check('Core: /academia/api/core/me lists platform_admin and the Inspironics membership', async () => {
    const r = await call(base, '/academia/api/core/me', { jar })
    expect(r.status === 200, describe(r))
    expect(r.json?.user?.email === email, 'another user')
    expect((r.json?.roles || []).some((x) => x.role === 'platform_admin' && x.scope_type === 'platform'), 'no platform_admin role')
    expect((r.json?.memberships || []).length >= 1, 'no membership')
  })

  await t.check('Showcase (identity required): /showcase/api/auth/me is the asserted Core user, as admin', async () => {
    const r = await call(base, '/showcase/api/auth/me', { jar })
    expect(r.status === 200, describe(r))
    expect(r.json?.user?.email === email, 'another user')
    expect(r.json?.user?.role === 'admin', `role ${r.json?.user?.role}`)
  })

  await t.check('SlidesVault (identity required): /vault/api/auth/me and /vault/api/presentations', async () => {
    const me = await call(base, '/vault/api/auth/me', { jar })
    expect(me.status === 200, `auth/me ${describe(me)}`)
    expect(me.json?.email === email, 'another user')
    expect(me.json?.role === 'admin', `role ${me.json?.role}`)
    const list = await call(base, '/vault/api/presentations', { jar })
    expect(list.status === 200 && Array.isArray(list.json?.items), `presentations ${describe(list)}`)
  })

  await t.check('a forged X-Apex-Identity from the client is stripped: the real session decides', async () => {
    const sc = await call(base, '/showcase/api/auth/me', { jar, headers: { 'X-Apex-Identity': forged('showcase') } })
    expect(sc.status === 200 && sc.json?.user?.email === email, `showcase: ${describe(sc)} ${sc.json?.user?.email === INTRUDER.email ? '(forged identity accepted!)' : ''}`)
    const sv = await call(base, '/vault/api/auth/me', { jar, headers: { 'X-Apex-Identity': forged('slidesvault') } })
    expect(sv.status === 200 && sv.json?.email === email, `slidesvault: ${describe(sv)}`)
  })

  await t.check('a forged X-Apex-Service is stripped: the Core resolve endpoint refuses the request', async () => {
    const service = forgeAssertion({ kid, key: crypto.randomBytes(32), audience: 'core' })
    const r = await call(base, '/academia/api/core/identity/resolve', { method: 'POST', jar, headers: { 'X-Apex-Service': service }, body: { sub: 'anyone' } })
    expect(r.status === 401 || r.status === 403, describe(r))
  })

  await t.check('invitation only: Core registration closed, app sign-in routes closed in required mode', async () => {
    const reg = await call(base, '/academia/api/auth/register', { method: 'POST', jar, body: { email: `new-${Date.now()}@apex-staging.invalid`, password: crypto.randomBytes(12).toString('base64url'), full_name: 'Nobody' } })
    expect(reg.status === 403, `register ${describe(reg)}`)
    for (const p of ['/showcase/api/auth/login', '/vault/api/auth/login']) {
      const r = await call(base, p, { method: 'POST', jar, body: { email, password } })
      expect(r.status === 403, `${p}: ${describe(r)}`)
    }
  })

  if (process.env.SMOKE_CHECK_UNPUBLISHED !== '0') {
    await t.check('no app or database port is reachable from the host (only the gateway is published)', async () => {
      for (const port of [4175, 4176, 4177, 5432]) expect(await refused('127.0.0.1', port), `127.0.0.1:${port} accepts connections`)
    })
  }

  await t.check('sign-out revokes access: the old cookies no longer reach any app', async () => {
    const stale = new Map(jar)
    const out = await call(base, '/auth/logout', { method: 'POST', headers: { Origin: origin }, jar })
    expect(out.status === 200, `logout ${describe(out)}`)
    for (const p of ['/showcase/api/auth/me', '/vault/api/presentations', '/academia/api/core/me']) {
      const r = await call(base, p, { jar: stale })
      expect(r.status === 401, `${p} with the signed-out cookies: ${describe(r)}`)
    }
  })

  return t.finish()
}

/* ------------------------------------------------------------------------ bypass mode -- */

async function bypassMode() {
  const showcase = (process.env.SMOKE_SHOWCASE_URL || 'http://showcase-api:4176').replace(/\/+$/, '')
  const vault = (process.env.SMOKE_SLIDESVAULT_URL || 'http://slidesvault-api:4175').replace(/\/+$/, '')
  const core = (process.env.SMOKE_CORE_URL || 'http://core:4177').replace(/\/+$/, '')
  const realKid = process.env.SMOKE_KID
  if (!realKid) throw new Error('SMOKE_KID (the current identity key id) is required')
  const t = harness()
  console.log('\n  APEX staging smoke — direct backend bypass attempts (must all be refused)\n')

  // Unknown kid, and the real kid with a key that is not the service's.
  const forgeries = (audience, claims) => [
    ['unknown kid', forgeAssertion({ kid: 'kforged', key: crypto.randomBytes(32), audience, claims })],
    ['real kid, wrong key', forgeAssertion({ kid: realKid, key: crypto.randomBytes(32), audience, claims })],
  ]

  await t.check('the APIs are reachable from this network (health 200), so refusals below are real', async () => {
    for (const [name, url] of [['showcase', `${showcase}/api/health`], ['slidesvault', `${vault}/api/health`], ['core', `${core}/api/health`]]) {
      const r = await call(url, '')
      expect(r.status === 200, `${name}: ${describe(r)}`)
    }
  })

  for (const [name, base, p, audience] of [
    ['Showcase', showcase, '/api/auth/me', 'showcase'],
    ['SlidesVault', vault, '/api/presentations', 'slidesvault'],
  ]) {
    await t.check(`${name} direct, no assertion -> 401`, async () => {
      const r = await call(base, p)
      expect(r.status === 401, describe(r))
    })
    for (const [label, header] of forgeries(audience, INTRUDER)) {
      await t.check(`${name} direct, self-made assertion (${label}) -> 401`, async () => {
        const r = await call(base, p, { headers: { 'X-Apex-Identity': header } })
        expect(r.status === 401, describe(r))
      })
    }
    await t.check(`${name} direct, legacy password sign-in -> 403`, async () => {
      const r = await call(base, '/api/auth/login', { method: 'POST', body: { email: 'anyone@apex-staging.invalid', password: 'not-a-password' } })
      expect(r.status === 403, describe(r))
    })
  }

  await t.check('Core resolve direct, no service assertion -> 401', async () => {
    const r = await call(core, '/api/core/identity/resolve', { method: 'POST', body: { sub: 'anyone' } })
    expect(r.status === 401, describe(r))
  })
  for (const [label, header] of forgeries('core', {})) {
    await t.check(`Core resolve direct, self-made service assertion (${label}) -> 401`, async () => {
      const r = await call(core, '/api/core/identity/resolve', { method: 'POST', headers: { 'X-Apex-Service': header }, body: { sub: 'anyone' } })
      expect(r.status === 401, describe(r))
    })
  }

  return t.finish()
}

/* ------------------------------------------------------------------------------- main -- */

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2] || 'gateway'
  const run = mode === 'bypass' ? bypassMode : mode === 'gateway' ? gatewayMode : null
  if (!run) {
    console.error(`  Unknown mode "${mode}". Use gateway or bypass.`)
    process.exit(2)
  }
  run().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`  smoke: ${error.message}`)
      process.exit(1)
    }
  )
}
