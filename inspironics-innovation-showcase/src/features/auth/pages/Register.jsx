import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell, { ErrorNote, Field, Submit } from '../components/AuthShell'
import GoogleButton from '../components/GoogleButton'
import { useAuth } from '../context/AuthContext'
import { api, passwordIssues } from '../api/authService.js'

export default function Register() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const issues = passwordIssues(form.password)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      const { email, devCode } = await api.register(form)
      navigate('/verify', { state: { email, devCode } })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Create account"
      title="Join the showcase"
      sub="We'll send a six-digit code to confirm your email."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-cyan-glow underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Your name"
          autoComplete="name"
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="••••••••"
          autoComplete="new-password"
          hint={form.password && issues.length ? `Needs ${issues.join(', ')}.` : 'At least 8 characters, with a letter and a number.'}
        />
        <Field
          label="Confirm password"
          type="password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          placeholder="••••••••"
          autoComplete="new-password"
        />

        <ErrorNote>{error}</ErrorNote>
        <Submit busy={busy}>Create account</Submit>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="label-mono">or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <GoogleButton
        label="Sign up with Google"
        onSession={(s) => {
          setSession(s)
          navigate('/', { replace: true })
        }}
        onError={setError}
      />
    </AuthShell>
  )
}
