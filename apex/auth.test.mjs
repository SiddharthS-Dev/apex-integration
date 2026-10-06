/**
 * Unit tests for the gateway's pure helpers. No server, no apps, no browser.
 *
 *   node --test apex/*.test.mjs
 *
 * Dependency-free, like the gateway: node:test and node:assert only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { APEX_COOKIE, classify, clearCookie, forwardCookies, mountPath, parseCookies, safeNext, scopeSetCookie } from './auth.mjs'
import { parseNetstatLine } from './stop.mjs'

/* -------------------------------------------------------------- safeNext -- */

test('safeNext keeps same-site paths', () => {
  for (const ok of ['/', '/vault/library', '/showcase/?q=a%20b#x', '/academia/verify/ABC-123', '/a/%2F%2Fb']) {
    assert.equal(safeNext(ok), ok)
  }
})

test('safeNext refuses anything that can leave the site', () => {
  const bad = [
    undefined,
    null,
    42,
    '',
    'https://evil.example/',
    'evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example', // browsers strip the tab: //evil.example
    '/\n/evil.example',
    '/\r/evil.example',
    '/ /evil.example',
    '/\u0000/evil.example',
    '/ /x',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/'.padEnd(3000, 'a'),
  ]
  for (const value of bad) assert.equal(safeNext(value), '/', `should refuse ${JSON.stringify(value)}`)
})

/* --------------------------------------------------------------- cookies -- */

test('mountPath gives the mount with one trailing slash', () => {
  assert.equal(mountPath('/vault'), '/vault/')
  assert.equal(mountPath('/vault/'), '/vault/')
})

test('scopeSetCookie moves Path=/ under the mount and leaves the rest alone', () => {
  assert.equal(
    scopeSetCookie('sv_session=abc; Path=/; HttpOnly; SameSite=Lax', '/vault'),
    'sv_session=abc; Path=/vault/; HttpOnly; SameSite=Lax'
  )
  assert.equal(scopeSetCookie('iea_session=x; path=/', '/academia'), 'iea_session=x; path=/academia/')
  assert.equal(scopeSetCookie('a=1; Max-Age=0; Path=/ ; Secure', '/showcase'), 'a=1; Max-Age=0; Path=/showcase/ ; Secure')
  // A path the app chose itself is its business.
  assert.equal(scopeSetCookie('a=1; Path=/api/dropbox', '/vault'), 'a=1; Path=/api/dropbox')
  // No Path attribute: nothing to rewrite.
  assert.equal(scopeSetCookie('a=1; HttpOnly', '/vault'), 'a=1; HttpOnly')
  // A value that merely looks like a path is not touched.
  assert.equal(scopeSetCookie('a=Path=/; Path=/', '/vault'), 'a=Path=/; Path=/vault/')
})

test('clearCookie clears at the mount and at the legacy Path=/', () => {
  const [mounted, legacy] = clearCookie('sv_session', '/vault')
  assert.match(mounted, /^sv_session=; Path=\/vault\/;.*Max-Age=0/)
  assert.match(legacy, /^sv_session=; Path=\/;.*Max-Age=0/)
  assert.deepEqual(clearCookie(APEX_COOKIE).length, 1)
  assert.match(clearCookie(APEX_COOKIE)[0], /^apex_session=; Path=\/;/)
})

test('forwardCookies sends a project its own session and nothing of the others', () => {
  const header = 'apex_session=A; theme=dark; sv_session=V; insp_session=S; iea_session=I; _ga=1'
  assert.equal(forwardCookies(header, 'sv_session'), 'theme=dark; sv_session=V; _ga=1')
  assert.equal(forwardCookies(header, 'insp_session'), 'theme=dark; insp_session=S; _ga=1')
  assert.equal(forwardCookies(header, undefined), 'theme=dark; _ga=1')
  assert.equal(forwardCookies('apex_session=A', 'sv_session'), '')
  assert.equal(forwardCookies(undefined, 'sv_session'), '')
})

test('forwardCookies keeps only the first copy of the own cookie (the mount-scoped one)', () => {
  // A browser sends the longer path first: /vault/'s cookie, then a legacy Path=/ one.
  assert.equal(forwardCookies('sv_session=NEW; sv_session=OLD', 'sv_session'), 'sv_session=NEW')
  assert.equal(parseCookies('sv_session=NEW; sv_session=OLD').sv_session, 'NEW')
})

test('parseCookies survives a malformed escape', () => {
  assert.equal(parseCookies('a=%E0%A4%A; b=2').b, '2')
})

/* --------------------------------------------------------------- sign-in -- */

test('classify sorts an app answer into ok / down / limited / refused', () => {
  const set = ['sv_session=abc; Path=/; HttpOnly']
  assert.equal(classify({ status: 200, cookies: set }, 'sv_session'), 'ok')
  assert.equal(classify({ status: 200, cookies: [] }, 'sv_session'), 'refused')
  assert.equal(classify({ status: 401, cookies: [] }, 'sv_session'), 'refused')
  assert.equal(classify({ status: 0 }, 'sv_session'), 'down')
  assert.equal(classify({ status: 503, cookies: [] }, 'sv_session'), 'down')
  assert.equal(classify({ status: 429, cookies: [] }, 'sv_session'), 'limited')
})

/* -------------------------------------------------------------- stop.mjs -- */

test('parseNetstatLine finds listeners by position, in any language', () => {
  assert.deepEqual(parseNetstatLine('  TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    1234'), { port: 5173, pid: 1234 })
  assert.deepEqual(parseNetstatLine('  TCP    0.0.0.0:4176      0.0.0.0:0    ABHÖREN      42'), { port: 4176, pid: 42 })
  assert.deepEqual(parseNetstatLine('  TCP    [::]:4177         [::]:0       ÉCOUTE       7'), { port: 4177, pid: 7 })
  // Connections are not listeners, whatever their state is called.
  assert.equal(parseNetstatLine('  TCP    127.0.0.1:5173    127.0.0.1:51000    ESTABLISHED    1234'), null)
  assert.equal(parseNetstatLine('  UDP    0.0.0.0:5353      *:*                         99'), null)
  assert.equal(parseNetstatLine('Active Connections'), null)
})
