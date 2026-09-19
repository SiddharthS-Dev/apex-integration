import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '#shared/ui/Logo'
import Loader from '#shared/ui/Loader'
import { loadShowcase } from '#features/showcase/model'
import { buildReportModel, generateReportPdf } from '../lib/reportPdf.js'

export default function MonthlyReport() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadShowcase().then(setData).catch((e) => setError(e.message))
  }, [])

  const model = useMemo(() => (data ? buildReportModel(data) : null), [data])

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      generateReportPdf(data)
    } catch (e) {
      setError(e.message || 'Could not build the PDF.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) return <div className="grid min-h-screen place-items-center text-sm text-muted">{error}</div>
  if (!model) return <Loader label="Compiling report" />

  const maxTech = model.topTech[0]?.count || 1

  return (
    <div className="relative min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08080c]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-5xl items-center gap-4 px-5">
          <Link to="/" className="flex items-center gap-3">
            <Logo size={28} />
            <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-chalk">Monthly Report</span>
          </Link>
          <Link to="/" className="ml-auto text-sm text-muted transition hover:text-chalk">
            ← Showcase
          </Link>
          <button onClick={download} disabled={busy} className="btn-primary !px-4 !py-2.5 text-[13px]">
            {busy ? 'Building…' : '↓ Download as PDF'}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 py-14">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <p className="eyebrow">Inspironics · Innovation Showcase</p>
          <h1 className="mt-4 text-[clamp(2.2rem,5.5vw,3.8rem)] font-black leading-[1.02] tracking-[-0.03em] text-chalk">
            Monthly Innovation Report
          </h1>
          <p className="mt-4 font-mono text-sm uppercase tracking-[0.24em] text-muted">{model.month}</p>
        </motion.div>

        {error && (
          <p className="mt-6 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{error}</p>
        )}

        <Section n="01" label="Executive summary" title="Where the estate stands">
          <div className="space-y-4">
            {model.summary.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-muted sm:text-[15px]">
                {p}
              </p>
            ))}
          </div>
        </Section>

        <Section n="02" label="Key metrics" title="The numbers behind the library">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {model.kpis.map((k, i) => (
              <div key={k.label} className="glass rounded-2xl p-4">
                <div className={`font-mono text-2xl font-bold ${i % 2 ? 'text-emerald-glow' : 'text-cyan-glow'}`}>{k.value}</div>
                <div className="label-mono mt-1">{k.label}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section n="03" label="Domain coverage" title="Plates by technology domain">
          <div className="space-y-2.5">
            {model.topTech.map((t) => (
              <div key={t.name} className="flex items-center gap-4">
                <span className="w-40 shrink-0 text-[13px] text-chalk">{t.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-emerald-glow"
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(t.count / maxTech) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-xs text-muted">{t.count}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section n="04" label="Milestones by category" title="What shipped this cycle">
          <div className="space-y-8">
            {model.byCat.map((c) => (
              <div key={c.name}>
                <div className="flex items-baseline justify-between border-b border-white/10 pb-2">
                  <h3 className="text-base font-bold text-chalk">{c.name}</h3>
                  <span className="font-mono text-[11px] text-emerald-glow">
                    {c.count} plates · {c.share}%
                  </span>
                </div>
                <ul className="mt-4 space-y-3">
                  {c.milestones.map((m) => (
                    <li key={m.title} className="flex gap-3">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" />
                      <div>
                        <p className="text-[13.5px] font-semibold text-chalk">{m.title}</p>
                        {m.note && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{m.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section n="05" label="Roadmap" title="Where the next cycle goes">
          <div className="space-y-3">
            {model.roadmap.map(([t, d], i) => (
              <div key={t} className="glass flex gap-4 rounded-2xl p-5">
                <span className="font-mono text-sm text-cyan-glow">0{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-chalk">{t}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="mt-16 flex flex-wrap items-center gap-4 border-t border-white/10 pt-8">
          <p className="font-mono text-[11px] text-muted/70">
            Generated {model.generatedAt.toLocaleString()} · Inspironics
          </p>
          <button onClick={download} disabled={busy} className="btn-primary ml-auto">
            {busy ? 'Building…' : '↓ Download as PDF'}
          </button>
        </div>
      </main>
    </div>
  )
}

function Section({ n, label, title, children }) {
  return (
    <motion.section
      className="mt-16"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6 }}
    >
      <p className="eyebrow">
        {n} · {label}
      </p>
      <h2 className="mt-3 border-b border-cyan-glow/25 pb-4 text-2xl font-bold tracking-[-0.02em] text-chalk">{title}</h2>
      <div className="mt-7">{children}</div>
    </motion.section>
  )
}
