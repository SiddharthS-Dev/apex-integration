import { useState } from 'react'
import { motion } from 'framer-motion'

export default function FlipCard({ item, index = 0, onOpen }) {
  const [flipped, setFlipped] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay: Math.min(index, 8) * 0.035, ease: [0.16, 1, 0.3, 1] }}
      className="flip-scene aspect-[4/5]"
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      onFocus={() => setFlipped(true)}
      onBlur={() => setFlipped(false)}
    >
      <div className={`flip-inner ${flipped ? 'is-flipped' : ''}`}>
        {/* ---------------------------------------------------------- front */}
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className="flip-face group w-full border border-white/10 bg-[#0c0d13] text-left transition-colors hover:border-cyan-glow/40"
          aria-label={`Open ${item.title}`}
        >
          <div className="relative h-full w-full">
            {!loaded && !broken && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
            {broken ? (
              <div className="grid h-full place-items-center bg-gradient-to-br from-[#0d1020] to-[#0a0a0f] p-6 text-center">
                <span className="label-mono">Image unavailable</span>
              </div>
            ) : (
              <>
                {/* blurred fill so letterboxed plates never sit on flat black */}
                <img
                  src={item.thumbUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className={`absolute inset-0 h-full w-full scale-125 object-cover blur-2xl transition-opacity duration-700 ${
                    loaded ? 'opacity-30' : 'opacity-0'
                  }`}
                />
                <img
                  src={item.thumbUrl}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  width={item.w || 480}
                  height={item.h || 480}
                  onLoad={() => setLoaded(true)}
                  onError={() => setBroken(true)}
                  className={`relative h-full w-full object-contain transition-all duration-700 ${
                    loaded ? 'opacity-100' : 'opacity-0'
                  } group-hover:scale-[1.04]`}
                />
              </>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-[#07080d] via-[#07080d]/55 to-[#07080d]/15" />

            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3.5">
              <span className="chip !border-white/15 !bg-black/55 backdrop-blur">{item.cat}</span>
              {item.flagship && (
                <span className="chip !border-emerald-glow/50 !bg-emerald-glow/12 !text-emerald-glow backdrop-blur">
                  ★ Flagship
                </span>
              )}
            </div>

            <div className="absolute inset-x-0 bottom-0 p-4">
              <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-chalk">{item.title}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.tech.slice(0, 2).map((t) => (
                  <span key={t} className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-glow/75">
                    {t}
                  </span>
                ))}
                {item.tech.length > 2 && (
                  <span className="font-mono text-[9px] text-muted/60">+{item.tech.length - 2}</span>
                )}
              </div>
            </div>
          </div>
        </button>

        {/* ----------------------------------------------------------- back */}
        <div className="flip-face flip-face-back border border-cyan-glow/30 bg-gradient-to-br from-[#0b1420] to-[#080a12]">
          <div className="flex h-full flex-col p-5">
            <p className="label-mono !text-cyan-glow/80">{item.cat}</p>
            <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-chalk">{item.title}</h3>

            <p className="mt-3 line-clamp-4 text-[12.5px] leading-relaxed text-muted">{item.objective}</p>

            {item.components?.length > 0 && (
              <div className="mt-4">
                <p className="label-mono">Components</p>
                <ul className="mt-1.5 space-y-1">
                  {item.components.slice(0, 4).map((c) => (
                    <li key={c} className="flex items-start gap-2 text-[12px] text-chalk/85">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-emerald-glow" />
                      <span className="line-clamp-1">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {item.techben?.length > 0 && (
              <div className="mt-3">
                <p className="label-mono">Benefits</p>
                <p className="mt-1 line-clamp-2 text-[12px] text-chalk/75">{item.techben.slice(0, 3).join(' · ')}</p>
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
              {item.tech.slice(0, 3).map((t) => (
                <span key={t} className="chip !py-0.5 !text-[9px]">
                  {t}
                </span>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onOpen?.(item)}
              className="mt-3 flex w-full items-center justify-between rounded-lg border border-cyan-glow/30 bg-cyan-glow/[0.07] px-3 py-2.5 text-[12px] font-semibold text-cyan-glow transition hover:bg-cyan-glow/15"
            >
              View blueprint <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
