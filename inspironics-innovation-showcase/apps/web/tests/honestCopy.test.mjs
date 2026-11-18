/**
 * Copy that must not claim what the product does not do: proof across
 * industries it has not shown, or emails it never sends (there is no mail
 * transport — codes come from an administrator, or on screen in the demo).
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('the About section does not claim proof across industries', () => {
  const about = src('features/site/components/AboutSection.jsx')
  assert.doesNotMatch(about, /proven across/)
  assert.match(about, /intended for energy, agriculture/)
})

test('auth pages do not claim a code was emailed', () => {
  const register = src('features/auth/pages/Register.jsx')
  const reset = src('features/auth/pages/ResetPassword.jsx')
  assert.doesNotMatch(register, /We'll send/)
  assert.match(register, /does not send email yet/)
  assert.doesNotMatch(reset, /the code we sent you/)
  assert.match(reset, /no email is sent yet/)
  for (const page of ['VerifyOtp.jsx', 'ForgotPassword.jsx']) {
    assert.match(src(`features/auth/pages/${page}`), /ask your administrator/, page)
  }
})
