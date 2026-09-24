import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '#shared/ui/Logo'

/** Shared chrome for every auth screen. */
export default function AuthShell({ eyebrow, title, sub, children, footer }) {
  return (
    <div className="relative flex min-h-[100svh] items-center justify-center px-5 py-14">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-24 top-10 h-[420px] w-[420px] rounded-full bg-cyan-glow/[0.08] blur-[130px]" />
        <div className="absolute -right-24 bottom-0 h-[420px] w-[420px] rounded-full bg-emerald-glow/[0.06] blur-[130px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <Link to="/" className="mx-auto mb-8 flex w-fit items-center gap-3">
          <Logo size={34} />
          <span className="font-mono text-[11px] uppercase tracking-[0.26em] text-chalk">Inspironics</span>
        </Link>

        <div className="glass-strong rounded-2xl p-7 shadow-lift sm:p-9">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-2xl font-bold tracking-[-0.02em] text-chalk">{title}</h1>
          {sub && <p className="mt-2 text-[13px] leading-relaxed text-muted">{sub}</p>}
          <div className="mt-7">{children}</div>
        </div>

        {footer && <div className="mt-6 text-center text-[13px] text-muted">{footer}</div>}
      </motion.div>
    </div>
  )
}

export const Field = ({ label, hint = null, ...props }) => (
  <label className="block">
    <span className="label-mono">{label}</span>
    <input className="field mt-1.5" {...props} />
    {hint && <span className="mt-1.5 block text-[11px] text-muted/70">{hint}</span>}
  </label>
)

export const ErrorNote = ({ children }) =>
  children ? (
    <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-xs leading-relaxed text-rose-300">
      {children}
    </p>
  ) : null

export const InfoNote = ({ children }) =>
  children ? (
    <p className="rounded-lg border border-cyan-glow/30 bg-cyan-glow/[0.07] px-3 py-2.5 text-xs leading-relaxed text-cyan-glow">
      {children}
    </p>
  ) : null

export const Submit = ({ busy, children }) => (
  <button type="submit" disabled={busy} className="btn-primary w-full">
    {busy ? (
      <>
        <span className="h-4 w-4 animate-spinSlow rounded-full border-2 border-black/25 border-t-black/70" />
        Working…
      </>
    ) : (
      children
    )}
  </button>
)
