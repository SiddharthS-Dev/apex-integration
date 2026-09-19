import { strict as assert } from 'node:assert'
import test from 'node:test'

const { parseEnvFile, getEnvWarnings } = await import('../scripts/checkEnv.mjs')

test('parseEnvFile accepts env values with comments and preserves URL values', () => {
  const result = parseEnvFile(`
# comment
VITE_GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com
VITE_ERROR_ENDPOINT=https://example.com/api/errors
OTHER=ignored
`)

  assert.equal(result.VITE_GOOGLE_CLIENT_ID, 'abc.apps.googleusercontent.com')
  assert.equal(result.VITE_ERROR_ENDPOINT, 'https://example.com/api/errors')
})

test('parseEnvFile ignores blank and commented values', () => {
  const result = parseEnvFile(`
# comment
VITE_GOOGLE_CLIENT_ID=
VITE_ERROR_ENDPOINT=
`)

  assert.equal(result.VITE_GOOGLE_CLIENT_ID, '')
  assert.equal(result.VITE_ERROR_ENDPOINT, '')
})

test('getEnvWarnings reports missing production settings only when relevant', () => {
  assert.deepEqual(getEnvWarnings({}), [
    'VITE_GOOGLE_CLIENT_ID is not set. Google sign-in will remain in demo mode.',
  ])

  assert.deepEqual(getEnvWarnings({
    VITE_GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com',
    VITE_ERROR_ENDPOINT: 'https://example.com/api/errors',
  }), [])

  assert.deepEqual(getEnvWarnings({
    VITE_GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com',
    VITE_ERROR_ENDPOINT: 'ftp://example.com',
  }), ['VITE_ERROR_ENDPOINT should be an absolute http(s) URL when configured.'])
})
