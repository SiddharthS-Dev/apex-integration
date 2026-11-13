/**
 * The sign-in page offers "Continue as guest" only when the server says guest
 * access is on — it is off by default (GUEST_ENABLED), and the API refuses it.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { useDom } from './dom.mjs'

useDom()

async function mountLogin(config) {
  const [{ createElement: h, act }, { createRoot }, router, ctx, service, mod] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('react-router-dom'),
    import('../src/features/auth/context/AuthContext.jsx'),
    import('../src/features/auth/api/authService.js'),
    import('../src/features/auth/pages/Login.jsx'),
  ])
  const original = service.api.getConfig
  service.api.getConfig = async () => config
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(h(router.MemoryRouter, null, h(ctx.AuthProvider, null, h(mod.default))))
    )
    await act(async () => {}) // let the config request settle
    return host.textContent
  } finally {
    service.api.getConfig = original
    await act(async () => root.unmount())
  }
}

test('no guest button when the server has guest access off (or cannot be asked)', async () => {
  const off = await mountLogin({ guestEnabled: false })
  assert.match(off, /Sign in to the showcase/)
  assert.doesNotMatch(off, /Continue as guest/)
  assert.doesNotMatch(await mountLogin(null), /Continue as guest/)
})

test('the guest button appears when the server allows guests', async () => {
  assert.match(await mountLogin({ guestEnabled: true }), /Continue as guest/)
})

test('the HTTP auth service reads /api/auth/config, and answers null when it cannot', async () => {
  const { createHttpAuthService } = await import('../src/features/auth/api/httpAuthService.js')
  const ok = createHttpAuthService({ request: async (p) => (p === '/api/auth/config' ? { guestEnabled: false, allowRegistration: true } : null) })
  assert.deepEqual(await ok.getConfig(), { guestEnabled: false, allowRegistration: true })
  const down = createHttpAuthService({ request: async () => Promise.reject(new Error('offline')) })
  assert.equal(await down.getConfig(), null)
})
