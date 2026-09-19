import { useEffect, useRef, useState } from 'react'
import { env } from '#shared/config'
import { api } from '../api/authService.js'

export const decodeJwt = (token) => {
  if (typeof token !== 'string') throw new Error('Invalid JWT')

  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid JWT')

  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)

  if (typeof atob !== 'function') throw new Error('Invalid JWT')

  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const json = new TextDecoder().decode(bytes)

  try {
    return JSON.parse(json)
  } catch {
    throw new Error('Invalid JWT')
  }
}

/**
 * Google sign-in.
 *
 * With VITE_env.googleClientId set, this renders the real Google Identity Services
 * button and exchanges the returned credential for a session. Without it, the
 * button falls back to a labelled demo identity so the flow stays walkable.
 */
export default function GoogleButton({ onSession, onError, label = 'Continue with Google' }) {
  const host = useRef(null)
  const [busy, setBusy] = useState(false)
  const [scriptFailed, setScriptFailed] = useState(false)

  useEffect(() => {
    if (!env.googleClientId) return
    const SRC = 'https://accounts.google.com/gsi/client'

    const render = () => {
      if (!window.google?.accounts?.id || !host.current) return
      window.google.accounts.id.initialize({
        client_id: env.googleClientId,
        callback: async ({ credential }) => {
          try {
            const p = decodeJwt(credential)
            onSession(await api.loginWithGoogle({ email: p.email, name: p.name, picture: p.picture }))
          } catch (e) {
            onError?.(e.message || 'Google sign-in failed.')
          }
        },
      })
      window.google.accounts.id.renderButton(host.current, {
        theme: 'filled_black',
        size: 'large',
        width: 340,
        text: 'continue_with',
        shape: 'pill',
      })
    }

    /** @type {HTMLScriptElement | null} */
    let script = document.querySelector(`script[src="${SRC}"]`)
    if (script) {
      if (window.google) render()
      else script.addEventListener('load', render)
    } else {
      script = document.createElement('script')
      script.src = SRC
      script.async = true
      script.defer = true
      script.onload = render
      script.onerror = () => setScriptFailed(true)
      document.head.appendChild(script)
    }
  }, [onSession, onError])

  if (env.googleClientId && !scriptFailed) return <div ref={host} className="flex justify-center" />

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          onSession(await api.loginWithGoogle({ email: 'demo.user@inspironics.net', name: 'Demo User' }))
        } catch (e) {
          onError?.(e.message)
        } finally {
          setBusy(false)
        }
      }}
      className="btn-ghost w-full"
    >
      <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.3 35.9 44 30.6 44 24c0-1.3-.1-2.6-.4-3.9z" />
      </svg>
      {busy ? 'Signing in…' : env.googleClientId ? label : `${label} (demo)`}
    </button>
  )
}
