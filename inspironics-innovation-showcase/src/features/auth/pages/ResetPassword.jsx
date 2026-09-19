import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell, { ErrorNote, Field, Submit } from '../components/AuthShell'
import { api, passwordIssues } from '../api/authService.js'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const pending = api.getPendingReset()

  const [form, setForm] = useState({
    email: state?.email || pending?.email || '',
    token: '',
    password: '',
    confirm: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const issues = passwordIssues(form.password)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      await api.resetPassword(form)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Password reset"
      title={done ? 'Password updated' : 'Choose a new password'}
      sub={done ? 'You can sign in with your new password now.' : 'Enter the code we sent you, then pick a new password.'}
      footer={
        <Link to="/login" className="text-cyan-glow underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div className="space-y-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-glow/15 text-2xl text-emerald-glow">
            ✓
          </div>
          <button onClick={() => navigate('/login', { replace: true })} className="btn-primary w-full">
            Sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="email"
          />
          <Field
            label="Reset code"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder="6-digit code"
            inputMode="numeric"
          />
          <Field
            label="New password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            hint={form.password && issues.length ? `Needs ${issues.join(', ')}.` : undefined}
          />
          <Field
            label="Confirm new password"
            type="password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            autoComplete="new-password"
          />
          <ErrorNote>{error}</ErrorNote>
          <Submit busy={busy}>Update password</Submit>
        </form>
      )}
    </AuthShell>
  )
}
