import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell, { ErrorNote, InfoNote, Submit } from '../components/AuthShell'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/authService.js'

const LEN = 6

export default function VerifyOtp() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()

  const pending = api.getPendingVerification()
  const email = state?.email || pending?.email || ''

  const [digits, setDigits] = useState(Array(LEN).fill(''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // the stored record only holds a hash now; the plaintext lives behind the
  // clearly-demo-only accessor, so a reload can still show it
  const [devCode, setDevCode] = useState(state?.devCode || api.getDemoCode(email) || '')
  const [seconds, setSeconds] = useState(45)
  const inputs = useRef([])

  useEffect(() => {
    if (!email) navigate('/register', { replace: true })
    else inputs.current[0]?.focus()
  }, [email, navigate])

  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  const setAt = (i, v) => {
    const next = [...digits]
    next[i] = v.replace(/\D/g, '').slice(-1)
    setDigits(next)
    if (next[i] && i < LEN - 1) inputs.current[i + 1]?.focus()
  }

  const onKey = (i) => (e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < LEN - 1) inputs.current[i + 1]?.focus()
  }

  const onPaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, LEN)
    if (!text) return
    e.preventDefault()
    const next = Array(LEN).fill('')
    text.split('').forEach((c, i) => (next[i] = c))
    setDigits(next)
    inputs.current[Math.min(text.length, LEN - 1)]?.focus()
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = await api.verifyOtp({ email, code: digits.join('') })
      setSession(session)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setDigits(Array(LEN).fill(''))
      inputs.current[0]?.focus()
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError('')
    try {
      const { devCode: code } = await api.resendOtp(email)
      setDevCode(code)
      setSeconds(45)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <AuthShell
      eyebrow="Verify email"
      title="Enter your code"
      sub={`We sent a six-digit code to ${email}. It expires in 10 minutes.`}
      footer={
        <Link to="/login" className="text-cyan-glow underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex justify-between gap-2" onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              value={d}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={onKey(i)}
              inputMode="numeric"
              maxLength={1}
              aria-label={`Digit ${i + 1}`}
              className="field !px-0 !py-3.5 text-center font-mono text-xl"
            />
          ))}
        </div>

        {devCode && (
          <InfoNote>
            No mail service is wired into this build — your code is <strong>{devCode}</strong>.
          </InfoNote>
        )}
        <ErrorNote>{error}</ErrorNote>

        <Submit busy={busy}>Verify and continue</Submit>
      </form>

      <button
        type="button"
        onClick={resend}
        disabled={seconds > 0}
        className="mt-5 w-full text-center text-[12px] text-muted underline underline-offset-4 transition hover:text-cyan-glow disabled:no-underline disabled:opacity-50"
      >
        {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
      </button>
    </AuthShell>
  )
}
