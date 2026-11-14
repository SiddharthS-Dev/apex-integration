import crypto from 'node:crypto';
import net from 'node:net';
import { coreConfig } from './config.js';

// Gateway service assertions for POST /api/core/identity/resolve (contract §4.2–§4.4, ADR 0002).
//   X-Apex-Service: <kid>.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, kid + "." + payloadB64))>
//   payload { iss, aud: "core", iat, exp } (seconds; no user claims)
// Keys: APEX_IDENTITY_KEYS = JSON { kid: base64 } (current and previous kid, so rotation overlaps).
// Verification order: format, known kid, constant-time signature, iss, aud, exp/iat, trusted source.

const KID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const SERVICE_AUDIENCE = 'core';
const MIN_KEY_BYTES = 32;

/** Parses APEX_IDENTITY_KEYS. Invalid JSON or short keys are ignored (never trusted). */
export function parseKeys(raw) {
  const keys = new Map();
  if (!raw) return keys;
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return keys; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return keys;
  for (const [kid, b64] of Object.entries(obj)) {
    if (!KID_RE.test(kid) || typeof b64 !== 'string') continue;
    const key = Buffer.from(b64, 'base64');
    if (key.length >= MIN_KEY_BYTES) keys.set(kid, key);
  }
  return keys;
}

const stripMapped = (addr) => {
  const a = String(addr || '');
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : a;
};

/** Builds a matcher from 'loopback' and/or a comma list of IPs and CIDRs. */
export function trustedSourceMatcher(spec) {
  const list = new net.BlockList();
  for (const raw of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw.toLowerCase() === 'loopback') {
      list.addSubnet('127.0.0.0', 8, 'ipv4');
      list.addAddress('::1', 'ipv6');
      continue;
    }
    const [addr, bits] = raw.split('/');
    const family = net.isIP(addr);
    if (!family) continue;
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const n = Number(bits);
      if (Number.isInteger(n) && n >= 0 && n <= (family === 6 ? 128 : 32)) list.addSubnet(addr, n, type);
    }
  }
  return (address) => {
    const a = stripMapped(address);
    const family = net.isIP(a);
    if (!family) return false;
    return list.check(a, family === 6 ? 'ipv6' : 'ipv4');
  };
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Signs a payload (tests and tooling; the gateway has its own dependency-free signer). */
export function signAssertion(payload, kid, keyB64) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(Buffer.from(keyB64, 'base64'), `${kid}.${payloadB64}`).toString('base64url');
  return `${kid}.${payloadB64}.${sig}`;
}

/**
 * Verifies a service assertion. Returns { ok: true, payload, kid } or { ok: false, reason }.
 * `remoteAddress` must be the TCP peer (req.socket.remoteAddress), not a forwarded address.
 */
export function verifyServiceAssertion(header, {
  keys, issuer, audience = SERVICE_AUDIENCE, trustedSources, remoteAddress, nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof header !== 'string' || !header || header.length > 4096) return { ok: false, reason: 'missing' };
  const parts = header.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [kid, payloadB64, sigB64] = parts;
  if (!KID_RE.test(kid) || !B64URL_RE.test(payloadB64) || !B64URL_RE.test(sigB64)) return { ok: false, reason: 'format' };
  const key = keys.get(kid);
  if (!key) return { ok: false, reason: 'unknown_kid' };
  const expected = hmac(key, `${kid}.${payloadB64}`);
  const given = Buffer.from(sigB64, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'format' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'format' };
  if (payload.iss !== issuer) return { ok: false, reason: 'issuer' };
  if (payload.aud !== audience) return { ok: false, reason: 'audience' };
  const { iat, exp } = payload;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, reason: 'expiry' };
  if (!(exp > nowSeconds) || iat > nowSeconds + 30 || exp - iat > 120 || exp < iat) return { ok: false, reason: 'expiry' };
  if (!trustedSourceMatcher(trustedSources)(remoteAddress)) return { ok: false, reason: 'source' };
  return { ok: true, payload, kid };
}

/** Express-facing check with the environment's settings. */
export function verifyServiceRequest(req) {
  const cfg = coreConfig();
  return verifyServiceAssertion(req.get('x-apex-service'), {
    keys: parseKeys(cfg.identityKeys),
    issuer: cfg.identityIssuer,
    trustedSources: cfg.trustedSources,
    remoteAddress: req.socket?.remoteAddress,
  });
}
