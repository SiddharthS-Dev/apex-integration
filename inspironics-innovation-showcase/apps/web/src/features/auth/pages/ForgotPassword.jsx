import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell, { ErrorNote, Field, InfoNote, Submit } from '../components/AuthShell'
import { api } from '../api/authService.js'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setSent(await api.requestPasswordReset(email))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Password reset"
      title="Forgot your password?"
      sub="Enter your email and we'll send a reset code."
      footer={
        <Link to="/login" className="text-cyan-glow underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-glow/25 bg-emerald-glow/[0.06] p-5 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-glow/15 text-xl text-emerald-glow">
              ✓
            </div>
            <p className="mt-4 text-sm text-chalk">If an account exists for {sent.email}, a reset code is on its way.</p>
          </div>

          {sent.devToken && (
            <InfoNote>
              No mail service is wired into this build — your reset code is <strong>{sent.devToken}</strong>.
            </InfoNote>
          )}

          <button onClick={() => navigate('/reset-password', { state: { email: sent.email } })} className="btn-primary w-full">
            Enter reset code →
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
          <ErrorNote>{error}</ErrorNote>
          <Submit busy={busy}>Send reset code</Submit>
        </form>
      )}
    </AuthShell>
  )
}
