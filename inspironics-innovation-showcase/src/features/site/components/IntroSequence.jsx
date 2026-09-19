import { useEffect, useReducer } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Logo from '#shared/ui/Logo'

const SEEN_KEY = 'inspironics.intro.seen.v1'

/** Cinematic cold-open: logo reveal → tagline → fade out. Shown once per session. */
export default function IntroSequence({ onDone }) {
  const reduce = useReducedMotion()
  const [stage, next] = useReducer((s) => s + 1, 0)

  useEffect(() => {
    let seen = false
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === '1'
    } catch {
      /* private mode — just play it */
    }
    if (seen || reduce) {
      onDone?.()
      return
    }
    const timers = [setTimeout(next, 900), setTimeout(next, 2100), setTimeout(next, 3200)]
    const finish = setTimeout(() => {
      try {
        sessionStorage.setItem(SEEN_KEY, '1')
      } catch {
        /* ignore */
      }
      onDone?.()
      // 3200ms is when stage hits 3 and the 650ms exit starts; unmounting before
      // ~3850 would cut the fade off mid-way.
    }, 3900)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(finish)
    }
  }, [onDone, reduce])

  if (reduce) return null

  return (
    <AnimatePresence>
      {stage < 3 && (
        <motion.div
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-7 bg-ink"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 0.65, ease: 'easeInOut' }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-glow/10 blur-[120px]" />
          </div>

          <motion.div
            initial={{ scale: 0.7, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <Logo size={96} />
          </motion.div>

          <AnimatePresence>
            {stage >= 1 && (
              <motion.div
                className="text-center"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <h1 className="font-mono text-sm uppercase tracking-[0.5em] text-chalk sm:text-base">Inspironics</h1>
                <p className="mt-3 text-xs uppercase tracking-[0.28em] text-cyan-glow/70 sm:text-sm">
                  Intelligent Infrastructure
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className="h-px w-40 origin-left bg-gradient-to-r from-transparent via-cyan-glow to-transparent"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 3.2, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
