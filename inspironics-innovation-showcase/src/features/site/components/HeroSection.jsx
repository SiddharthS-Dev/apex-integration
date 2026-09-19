import { motion } from 'framer-motion'

const rise = {
  hidden: { opacity: 0, y: 26 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.75, ease: [0.16, 1, 0.3, 1] },
  }),
}

export default function HeroSection({ stats }) {
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <section id="hero" className="relative flex min-h-[100svh] items-center overflow-hidden pt-[68px]">
      {/* ambient glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 top-1/4 h-[560px] w-[560px] rounded-full bg-cyan-glow/[0.09] blur-[140px]" />
        <div className="absolute -right-32 bottom-0 h-[520px] w-[520px] rounded-full bg-emerald-glow/[0.07] blur-[140px]" />
        <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-ink to-transparent" />
      </div>

      {/* decorative data-stream ticks */}
      <div className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-2 xl:flex" aria-hidden="true">
        {Array.from({ length: 22 }).map((_, i) => (
          <motion.div
            key={i}
            className="h-px bg-cyan-glow/40"
            style={{ width: 12 + ((i * 37) % 46) }}
            animate={{ opacity: [0.15, 0.75, 0.15] }}
            transition={{ duration: 2.4, delay: i * 0.09, repeat: Infinity }}
          />
        ))}
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-5 py-20 sm:px-8 lg:px-12">
        <div className="max-w-4xl">
          <motion.p variants={rise} initial="hidden" animate="show" custom={0} className="eyebrow">
            ◆ Inspironics · Intelligent Infrastructure
          </motion.p>

          <motion.h1
            variants={rise}
            initial="hidden"
            animate="show"
            custom={1}
            className="mt-6 text-[clamp(2.6rem,7.2vw,5.6rem)] font-black leading-[0.98] tracking-[-0.03em]"
          >
            <span className="text-gradient">The blueprint library</span>
            <br />
            for connected worlds.
          </motion.h1>

          <motion.p
            variants={rise}
            initial="hidden"
            animate="show"
            custom={2}
            className="mt-7 max-w-2xl text-base leading-relaxed text-muted sm:text-lg"
          >
            {stats.totalCount} architecture plates, command decks and value frameworks from the Inspironics estate — every
            sensor, twin, model and decision surface that turns physical infrastructure into an operating system.
          </motion.p>

          <motion.div
            variants={rise}
            initial="hidden"
            animate="show"
            custom={3}
            className="mt-10 flex flex-wrap items-stretch gap-3 sm:gap-4"
          >
            <Stat value={`${stats.totalCount}+`} label="Innovations" accent />
            <Stat value={stats.techs.length} label="Tech Domains" />
            <Stat value={stats.cats.length} label="Categories" />
            <Stat value={stats.iotN} label="IoT-Enabled" />
          </motion.div>

          <motion.div
            variants={rise}
            initial="hidden"
            animate="show"
            custom={4}
            className="mt-10 flex flex-wrap gap-3"
          >
            <button onClick={() => go('gallery')} className="btn-primary">
              Explore Gallery →
            </button>
            <button onClick={() => go('ecosystem')} className="btn-ghost">
              View Ecosystem
            </button>
          </motion.div>
        </div>
      </div>

      <motion.button
        onClick={() => go('ecosystem')}
        className="absolute inset-x-0 bottom-7 z-10 mx-auto flex w-fit flex-col items-center gap-2 text-muted transition hover:text-cyan-glow"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        aria-label="Scroll to ecosystem"
      >
        <span className="label-mono">Scroll</span>
        <motion.span
          className="block h-9 w-[1px] bg-gradient-to-b from-cyan-glow to-transparent"
          animate={{ scaleY: [0.35, 1, 0.35], originY: 0 }}
          transition={{ duration: 1.8, repeat: Infinity }}
        />
      </motion.button>
    </section>
  )
}

function Stat({ value, label, accent = false }) {
  return (
    <div
      className={`glass rounded-2xl px-5 py-4 ${accent ? 'border-cyan-glow/30 shadow-glow' : ''}`}
    >
      <div className={`font-mono text-2xl font-bold sm:text-3xl ${accent ? 'text-cyan-glow' : 'text-chalk'}`}>{value}</div>
      <div className="label-mono mt-1">{label}</div>
    </div>
  )
}
