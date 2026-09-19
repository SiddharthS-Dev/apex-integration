import { motion } from 'framer-motion'
import SectionHead from '#shared/ui/SectionHead'

export default function DailySpotlight({ item, items, onOpenPlate }) {
  if (!item) return null

  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <section id="spotlight" className="section-pad relative z-10">
      <SectionHead
        eyebrow={`Daily Spotlight · ${today}`}
        title="Today's featured architecture"
        sub="One plate a day, rotated by date — a closer read of the thinking behind it."
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-[#0a0b11]/70 backdrop-blur-xl"
      >
        <div className="grid lg:grid-cols-[1.15fr_1fr]">
          <button
            onClick={() => onOpenPlate?.(items, items.findIndex((x) => x.f === item.f))}
            className="group relative min-h-[300px] overflow-hidden bg-black/40 lg:min-h-[520px]"
          >
            <img
              src={item.thumbUrl}
              alt={item.title}
              className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#08090e] via-transparent to-transparent lg:bg-gradient-to-r" />
            <span className="absolute bottom-5 left-5 inline-flex items-center gap-2 rounded-full border border-cyan-glow/40 bg-[#0a0b12]/85 px-4 py-2 text-xs font-semibold text-cyan-glow backdrop-blur transition group-hover:bg-cyan-glow group-hover:text-[#04141a]">
              ⤢ View fullscreen
            </span>
          </button>

          <div className="p-7 sm:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-on">{item.cat}</span>
              {item.flagship && <span className="chip !border-emerald-glow/50 !text-emerald-glow">★ Flagship</span>}
            </div>

            <h3 className="mt-5 text-2xl font-bold leading-tight text-chalk sm:text-3xl">{item.title}</h3>
            <p className="mt-4 text-sm leading-relaxed text-muted">{item.objective}</p>

            {item.flow?.length > 0 && (
              <div className="mt-7">
                <p className="label-mono">Process flow</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2">
                  {item.flow.map((s, i) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-chalk/90">
                        {s}
                      </span>
                      {i < item.flow.length - 1 && <span className="text-cyan-glow/50">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-7 grid gap-6 sm:grid-cols-2">
              {item.techben?.length > 0 && (
                <div>
                  <p className="label-mono !text-cyan-glow/70">Technical benefits</p>
                  <ul className="mt-2 space-y-1.5">
                    {item.techben.slice(0, 4).map((b) => (
                      <li key={b} className="flex gap-2 text-[12.5px] text-muted">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-glow" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.bizben?.length > 0 && (
                <div>
                  <p className="label-mono !text-emerald-glow/70">Business benefits</p>
                  <ul className="mt-2 space-y-1.5">
                    {item.bizben.slice(0, 4).map((b) => (
                      <li key={b} className="flex gap-2 text-[12.5px] text-muted">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-glow" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {item.takeaway && (
              <div className="mt-7 rounded-xl border border-cyan-glow/25 bg-cyan-glow/[0.05] p-4">
                <p className="label-mono !text-cyan-glow/80">Key takeaway</p>
                <p className="mt-2 text-[13px] leading-relaxed text-chalk/90">{item.takeaway}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

    </section>
  )
}
