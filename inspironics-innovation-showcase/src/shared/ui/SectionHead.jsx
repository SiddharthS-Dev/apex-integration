import { motion } from 'framer-motion'

/**
 * The standard section heading: eyebrow, title, optional standfirst, and an
 * optional control on the right.
 *
 * This used to be a named export hanging off EcosystemExplorer, which meant the
 * gallery, the spotlight and the about section all reached into the ecosystem
 * feature to render a heading. It belongs to no feature, so it lives here.
 */
export default function SectionHead({ eyebrow, title, sub = null, right = null }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <motion.div
        className="max-w-3xl"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.4rem)] font-black leading-[1.05] tracking-[-0.025em] text-chalk">
          {title}
        </h2>
        {sub && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{sub}</p>}
      </motion.div>
      {right}
    </div>
  )
}
