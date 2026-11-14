/**
 * Apex identity assertions: the one definition of the X-Apex-Identity format.
 *
 *   X-Apex-Identity: <kid>.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, kid + "." + payloadB64))>
 *
 * The gateway signs one per request, per application, with that application's
 * own key (R1 identity contract §4.2). The application verifies it, in this
 * order (§4.4): format, known kid, constant-time signature, issuer, audience,
 * time (exp > now, iat <= now + 30, exp - iat <= 120), and finally that the
 * request came from a trusted source address.
 *
 * The same format, with `aud: "core"` and no user claims, is the gateway's
 * X-Apex-Service credential towards the Core.
 *
 * THIS FILE IS COPIED BYTE FOR BYTE into
 *   inspironics-innovation-showcase/apps/api/src/lib/apexIdentity.js
 *   slide vault/apps/api/src/http/apexIdentity.js
 * and a test in each application fails when a copy drifts from apex/identity.mjs.
 * Edit it here, then copy it over. Node built-ins only.
 */
import crypto from 'node:crypto'
import net from 'node:net'

export const ISSUER = 'apex-gateway'
export const IDENTITY_HEADER = 'x-apex-identity'
export const SERVICE_HEADER = 'x-apex-service'
/** exp - iat of every assertion the gateway issues. */
export const ASSERTION_TTL_SECONDS = 60
/** The longest exp - iat a verifier accepts. */
export const MAX_LIFETIME_SECONDS = 120
/** How far in the future an iat may be (clock skew). */
export const MAX_FUTURE_SKEW_SECONDS = 30
export const IDENTITY_MODES = Object.freeze(['off', 'optional', 'required'])

const KID_RE = /^[A-Za-z0-9_-]{1,64}$/
const B64URL_RE = /^[A-Za-z0-9_-]+$/
const MAX_HEADER_LENGTH = 8192
const MIN_KEY_BYTES = 32

const str = (v, max = 320) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

/**
 * The keys an application or the gateway knows, as a Map of kid -> Buffer.
 * Accepts the APEX_IDENTITY_KEYS JSON text (`{"<kid>": "<base64>"}`) or the
 * parsed object. Entries with a malformed kid or a key shorter than 32 bytes
 * are dropped, never guessed at.
 */
export function parseKeys(value) {
  const out = new Map()
  let obj = value
  if (typeof value === 'string') {
    if (!value.trim()) return out
    try {
      obj = JSON.parse(value)
    } catch {
      return out
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [kid, b64] of Object.entries(obj)) {
    if (!KID_RE.test(kid) || typeof b64 !== 'string') continue
    const key = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (key.length >= MIN_KEY_BYTES) out.set(kid, key)
  }
  return out
}

/** Signs a payload as `kid.payload.signature`. */
export function signAssertion(payload, { kid, key }) {
  if (!KID_RE.test(String(kid))) throw new Error('A key id is letters, digits, "-" and "_" only.')
  if (!key || Buffer.from(key).length < MIN_KEY_BYTES) throw new Error('An identity key is at least 32 bytes.')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = crypto.createHmac('sha256', key).update(`${kid}.${body}`).digest('base64url')
  return `${kid}.${body}.${signature}`
}

/**
 * A fresh assertion for one audience: `iss`, `aud`, `iat` and `exp` are set
 * here and cannot be overridden by `claims`.
 */
export function issueAssertion({ audience, kid, key, claims = {}, now = Date.now(), ttlSeconds = ASSERTION_TTL_SECONDS }) {
  const iat = Math.floor(now / 1000)
  const rest = { ...claims }
  for (const reserved of ['iss', 'aud', 'iat', 'exp']) delete rest[reserved]
  return signAssertion({ iss: ISSUER, aud: audience, ...rest, iat, exp: iat + ttlSeconds }, { kid, key })
}

/** Only the three fields a role carries, as strings. */
export function normaliseRoles(roles) {
  if (!Array.isArray(roles)) return []
  return roles
    .filter((r) => r && typeof r === 'object' && str(r.role, 64) && str(r.scope_type, 32))
    .map((r) => ({ role: r.role, scope_type: r.scope_type, scope_id: typeof r.scope_id === 'string' ? r.scope_id : '' }))
}

/**
 * Verifies an assertion header.
 *
 * @param {unknown} header  The raw header value.
 * @param {object} opts
 * @param {Map<string, Buffer>} opts.keys          From parseKeys().
 * @param {string} opts.audience                   This application's id.
 * @param {string} [opts.issuer]                   Defaults to 'apex-gateway'.
 * @param {number} [opts.now]                      ms; defaults to Date.now().
 * @param {boolean} [opts.requireSubject]          true for user assertions, false for service ones.
 * @param {string} [opts.sourceAddress]            The TCP peer (req.socket.remoteAddress — never X-Forwarded-For).
 * @param {{ matches: (ip: string) => boolean }} [opts.trustedSources]  From parseTrustedSources().
 * @returns {{ ok: true, claims: object } | { ok: false, reason: string }}
 */
export function verifyAssertion(header, { keys, audience, issuer = ISSUER, now = Date.now(), requireSubject = true, sourceAddress, trustedSources } = {}) {
  // 1. format
  if (typeof header !== 'string' || header.length > MAX_HEADER_LENGTH) return { ok: false, reason: 'format' }
  const parts = header.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'format' }
  const [kid, body, signature] = parts
  if (!KID_RE.test(kid) || !B64URL_RE.test(body) || !B64URL_RE.test(signature)) return { ok: false, reason: 'format' }

  // 2. known kid
  const key = keys instanceof Map ? keys.get(kid) : undefined
  if (!key) return { ok: false, reason: 'unknown_kid' }

  // 3. constant-time signature
  const expected = crypto.createHmac('sha256', key).update(`${kid}.${body}`).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' }

  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'format' }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'format' }

  // 4. issuer, 5. audience
  if (payload.iss !== issuer) return { ok: false, reason: 'issuer' }
  if (typeof audience !== 'string' || !audience || payload.aud !== audience) return { ok: false, reason: 'audience' }

  // 6. time
  const { iat, exp } = payload
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, reason: 'format' }
  const nowSeconds = Math.floor(now / 1000)
  if (!(exp > nowSeconds)) return { ok: false, reason: 'expired' }
  if (iat > nowSeconds + MAX_FUTURE_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' }
  if (exp - iat > MAX_LIFETIME_SECONDS || exp <= iat) return { ok: false, reason: 'lifetime' }

  // 7. source address
  if (trustedSources && !trustedSources.matches(sourceAddress)) return { ok: false, reason: 'source' }

  const sub = str(payload.sub, 200)
  if (requireSubject && !sub) return { ok: false, reason: 'subject' }

  return {
    ok: true,
    claims: {
      iss: payload.iss,
      aud: payload.aud,
      sub,
      app_user_id: str(payload.app_user_id, 200),
      email: str(payload.email),
      name: str(payload.name),
      roles: normaliseRoles(payload.roles),
      iat,
      exp,
    },
  }
}

/** '::ffff:127.0.0.1' -> '127.0.0.1', 'fe80::1%eth0' -> 'fe80::1'. */
function plainAddress(ip) {
  let s = String(ip || '').trim()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s)
  return mapped ? mapped[1] : s
}

/**
 * APEX_IDENTITY_TRUSTED_SOURCES: a comma list of 'loopback', IP addresses and
 * CIDR ranges (default 'loopback'). Returns a matcher and the entries that
 * could not be understood, so configuration can refuse them.
 */
export function parseTrustedSources(spec = 'loopback') {
  const list = new net.BlockList()
  const invalid = []
  const entries = String(spec ?? '').trim() ? String(spec).split(',') : ['loopback']
  for (const raw of entries) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry.toLowerCase() === 'loopback') {
      list.addSubnet('127.0.0.0', 8, 'ipv4')
      list.addAddress('::1', 'ipv6')
      continue
    }
    const [addr, prefix, extra] = entry.split('/')
    const ip = plainAddress(addr)
    const family = net.isIP(ip)
    if (!family || extra !== undefined) {
      invalid.push(entry)
      continue
    }
    const type = family === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) {
      list.addAddress(ip, type)
      continue
    }
    const bits = Number(prefix)
    if (!/^\d{1,3}$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
      invalid.push(entry)
      continue
    }
    list.addSubnet(ip, bits, type)
  }
  return {
    invalid,
    matches(address) {
      const ip = plainAddress(address)
      const family = net.isIP(ip)
      if (!family) return false
      return list.check(ip, family === 4 ? 'ipv4' : 'ipv6')
    },
  }
}

/**
 * What the asserted Core roles mean in one application (§4.4): 'admin' for
 * platform_admin (platform scope) or app_admin scoped to this application,
 * 'member' for any other role, null for no roles at all.
 */
export function accessFor(roles, audience) {
  const list = normaliseRoles(roles)
  if (!list.length) return null
  const admin = list.some(
    (r) => (r.role === 'platform_admin' && r.scope_type === 'platform') || (r.role === 'app_admin' && r.scope_type === 'app' && r.scope_id === audience)
  )
  return admin ? 'admin' : 'member'
}

/** APEX_IDENTITY_MODE, or null when it is not one of off|optional|required. */
export function parseIdentityMode(value, fallback = 'off') {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return fallback
  return IDENTITY_MODES.includes(s) ? s : null
}
