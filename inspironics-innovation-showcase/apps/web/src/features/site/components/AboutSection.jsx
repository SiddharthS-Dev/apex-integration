import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import SectionHead from '#shared/ui/SectionHead'

const CAPABILITIES = [
  {
    icon: '◈',
    title: 'Agentic AI',
    desc: 'Autonomous agents that close the loop from signal to action, with human override at every step.',
    color: '#00F0FF',
  },
  {
    icon: '◉',
    title: 'IoT & Edge',
    desc: 'Device onboarding, secure telemetry and on-site inference across heterogeneous estates.',
    color: '#00FFB2',
  },
  {
    icon: '◇',
    title: 'Digital Twins',
    desc: 'Living models of rooms, buildings and portfolios that simulate before you commit capital.',
    color: '#B48CFF',
  },
  {
    icon: '⬢',
    title: 'Security',
    desc: 'Zero-trust identity, attested devices and encrypted transport from sensor to cockpit.',
    color: '#FF9FD1',
  },
  {
    icon: '◑',
    title: 'Analytics',
    desc: 'Streaming pipelines and decision surfaces that turn raw telemetry into operator confidence.',
    color: '#9BB4FF',
  },
  {
    icon: '❋',
    title: 'Sustainability',
    desc: 'Carbon accounting, ESG reporting and energy optimisation measured against real consumption.',
    color: '#7CFF9B',
  },
]

function Counter({ to, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const reduce = useReducedMotion()
  const [n, setN] = useState(reduce ? to : 0)

  useEffect(() => {
    if (!inView || reduce) return
    const t0 = performance.now()
    const dur = 1400
    let raf
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur)
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, reduce])

  return (
    <span ref={ref} className="font-mono">
      {n}
      {suffix}
    </span>
  )
}

export default function AboutSection({ stats, heroItem }) {
  return (
    <section id="about" className="section-pad relative z-10">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="eyebrow">About Inspironics</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.4rem)] font-black leading-[1.05] tracking-[-0.025em] text-chalk">
            We build the nervous system for physical infrastructure.
          </h2>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Every plate in this showcase is a working answer to the same question: how do you make a building, a plant, a
            campus or a city legible enough to run itself? Sensing, connectivity, twins and agentic decisioning — designed
            as one stack, deployed as products, and proven across energy, agriculture, hospitality, healthcare,
            manufacturing and data centres.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            The Caleido family — Kombos, Domi, Xenia and Mints — carries that stack into each domain, with Cielo Epic
            rolling the resulting twins up into portfolio-level intelligence.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { v: stats.totalCount, s: '+', l: 'Plates' },
              { v: stats.techs.length, s: '', l: 'Domains' },
              { v: stats.aiN, s: '', l: 'AI-Driven' },
              { v: stats.esgN, s: '', l: 'ESG-Linked' },
            ].map((s) => (
              <div key={s.l} className="glass rounded-2xl p-4">
                <div className="text-2xl font-bold text-cyan-glow sm:text-3xl">
                  <Counter to={s.v} suffix={s.s} />
                </div>
                <div className="label-mono mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="absolute -inset-6 rounded-[2rem] bg-cyan-glow/[0.07] blur-3xl" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0b11]">
            {heroItem && (
              <img src={heroItem.thumbUrl} alt={heroItem.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#08090e] via-transparent to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6">
              <p className="label-mono !text-cyan-glow/80">From the estate</p>
              <p className="mt-1.5 line-clamp-2 text-base font-bold text-chalk">{heroItem?.title}</p>
            </div>
          </div>
        </motion.div>
      </div>

      <SectionHead
        eyebrow="Capabilities"
        title="Six disciplines, one stack."
        sub="The competencies every plate in this library draws on."
      />

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, delay: i * 0.06 }}
            whileHover={{ y: -6 }}
            className="glass group rounded-2xl p-6 transition-colors"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${c.color}55`)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
          >
            <div
              className="grid h-12 w-12 place-items-center rounded-xl text-xl"
              style={{ background: `${c.color}18`, color: c.color, boxShadow: `0 0 24px -10px ${c.color}` }}
            >
              {c.icon}
            </div>
            <h3 className="mt-5 text-lg font-bold text-chalk">{c.title}</h3>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">{c.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
