import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell, { ErrorNote, Field, InfoNote, Submit } from '../components/AuthShell'
import GoogleButton from '../components/GoogleButton'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/authService.js'

export default function Login() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const dest = location.state?.from || '/'

  const [form, setForm] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const land = (session) => {
    setSession(session)
    navigate(dest, { replace: true })
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      land(await api.login(form))
    } catch (err) {
      if (err.code === 'UNVERIFIED') {
        navigate('/verify', { state: { email: err.email, devCode: err.devCode } })
        return
      }
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Secure access"
      title="Sign in to the showcase"
      sub="The innovation library is gated — sign in, or continue as a guest to browse."
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="text-cyan-glow underline underline-offset-4">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@company.com"
        />
        <div>
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
          />
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-[11px] text-muted underline underline-offset-4 hover:text-cyan-glow">
              Forgot password?
            </Link>
          </div>
        </div>

        <ErrorNote>{error}</ErrorNote>
        <InfoNote>{info}</InfoNote>

        <Submit busy={busy}>Sign in</Submit>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="label-mono">or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <div className="space-y-3">
        <GoogleButton onSession={land} onError={setError} />
        <button
          type="button"
          onClick={async () => {
            setBusy(true)
            land(await api.guest())
          }}
          className="w-full py-2 text-center text-[12px] text-muted underline underline-offset-4 transition hover:text-cyan-glow"
        >
          Continue as guest
        </button>
      </div>
    </AuthShell>
  )
}
