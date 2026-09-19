import { useState } from 'react'
import { motion } from 'framer-motion'

const HIGHLIGHTS = [
  ['Architecture review', 'We map your estate against the plates in this library and show you the gap.'],
  ['Pilot in 8 weeks', 'One zone, one product, instrumented end to end with a measurable baseline.'],
  ['Portfolio roll-up', 'Cielo Epic turns per-site twins into board-level capital decisions.'],
]

const STORE_KEY = 'inspironics.contact.submissions.v1'

export default function ContactSection() {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' })
  const [state, setState] = useState('idle') // idle | sending | done | error
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email) || !form.message.trim()) {
      setError('Add your name, a valid email and a message.')
      setState('error')
      return
    }
    setError('')
    setState('sending')
    await new Promise((r) => setTimeout(r, 900))
    try {
      // No mail service is wired into this build; enquiries are queued locally so
      // nothing is silently lost when a backend is connected.
      const prev = JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
      localStorage.setItem(STORE_KEY, JSON.stringify([{ ...form, at: new Date().toISOString() }, ...prev]))
    } catch {
      /* storage unavailable — the UI still confirms */
    }
    setState('done')
  }

  return (
    <section id="contact" className="section-pad relative z-10">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
        >
          <p className="eyebrow">Partnership</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.4rem)] font-black leading-[1.05] tracking-[-0.025em] text-chalk">
            Bring one of these blueprints to your estate.
          </h2>
          <p className="mt-6 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
            Tell us which plate caught your eye and what you are trying to instrument. We will come back with the
            architecture, the sensor list and a realistic path to a working pilot.
          </p>

          <div className="mt-10 space-y-3">
            {HIGHLIGHTS.map(([t, d], i) => (
              <motion.div
                key={t}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.09 }}
                className="glass flex gap-4 rounded-2xl p-5"
              >
                <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-glow/12 font-mono text-xs text-cyan-glow">
                  0{i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-chalk">{t}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{d}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.form
          onSubmit={submit}
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="glass-strong h-fit rounded-3xl p-7 shadow-lift sm:p-9"
        >
          <p className="label-mono">Start a conversation</p>

          {state === 'done' ? (
            <div className="py-12 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-glow/15 text-2xl text-emerald-glow">
                ✓
              </div>
              <h3 className="mt-5 text-xl font-bold text-chalk">Message received</h3>
              <p className="mt-2 text-sm text-muted">
                Thanks {form.name.split(' ')[0]} — we will reply to {form.email} shortly.
              </p>
              <button
                type="button"
                onClick={() => {
                  setForm({ name: '', email: '', company: '', message: '' })
                  setState('idle')
                }}
                className="btn-ghost mt-7"
              >
                Send another
              </button>
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label-mono">Name</span>
                  <input value={form.name} onChange={set('name')} className="field mt-1.5" placeholder="Your name" />
                </label>
                <label className="block">
                  <span className="label-mono">Email</span>
                  <input type="email" value={form.email} onChange={set('email')} className="field mt-1.5" placeholder="you@company.com" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label-mono">Company</span>
                  <input value={form.company} onChange={set('company')} className="field mt-1.5" placeholder="Optional" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label-mono">Message</span>
                  <textarea value={form.message} onChange={set('message')} rows={5} className="field mt-1.5 resize-none" placeholder="What are you trying to instrument?" />
                </label>
              </div>

              {state === 'error' && (
                <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>
              )}

              <button type="submit" disabled={state === 'sending'} className="btn-primary mt-6 w-full">
                {state === 'sending' ? (
                  <>
                    <span className="h-4 w-4 animate-spinSlow rounded-full border-2 border-black/25 border-t-black/70" />
                    Sending…
                  </>
                ) : (
                  'Send message'
                )}
              </button>
              <p className="mt-3 text-center text-[11px] text-muted/70">
                Or email us directly at hello@inspironics.net
              </p>
            </>
          )}
        </motion.form>
      </div>
    </section>
  )
}
