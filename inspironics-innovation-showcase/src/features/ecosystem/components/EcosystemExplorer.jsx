import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CHOICES, TIERS, loadChoice, resolveTier, saveChoice } from '../render/explorerQuality.js'
import { PRODUCT_NODES, STACK_LAYERS, ZONES, countMatches, routeLabel } from '../model/ecosystemData.js'
import SectionHead from '#shared/ui/SectionHead'
import ErrorBoundary from '#shared/ui/ErrorBoundary'

/*
 * three.js is ~133 KB gzipped and the canvas is the only thing that needs it,
 * so it is loaded lazily and only once the section is near the viewport. That
 * way the "3D off" tier costs nothing, and /login and /report never pay for it.
 */
const EcosystemCanvas = lazy(() => import('./EcosystemCanvas.jsx'))

/** Holds the canvas box's shape while three.js is still on its way. */
function CanvasPlaceholder({ label }) {
  return (
    <div className="grid h-full place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spinSlow rounded-full border-2 border-white/10 border-t-cyan-glow" />
        <p className="label-mono">{label}</p>
      </div>
    </div>
  )
}

export default function EcosystemExplorer({ items, onRoute }) {
  const [hover, setHover] = useState(null)
  const [selected, setSelected] = useState(null)
  // The picker lives out here rather than inside the canvas, so it is still
  // reachable when the canvas is switched off.
  const [quality, setQuality] = useState(loadChoice)
  const tier = resolveTier(quality)

  const chooseQuality = (value) => {
    saveChoice(value)
    setQuality(value)
    setHover(null)
  }

  const counts = useMemo(() => {
    const of = (n) => [n.id, countMatches(items, n.route)]
    return Object.fromEntries([...ZONES, ...PRODUCT_NODES, ...STACK_LAYERS].map(of))
  }, [items])

  const open = useCallback((node) => setSelected(node), [])

  // Gate the lazy import on proximity rather than on mount, so scrolling
  // decides when three.js is fetched.
  const sectionRef = useRef(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = sectionRef.current
    if (!el || near) return
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNear(true),
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const send = (node) => {
    onRoute?.(node.route, node)
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section id="ecosystem" ref={sectionRef} className="section-pad relative z-10">
      <SectionHead
        eyebrow="Ecosystem Explorer"
        title="One city. Every system."
        sub="A live model of the Inspironics estate — zones, products and the intelligence stack that binds them. Click any node to filter the gallery to the work behind it."
        right={
          <label className="flex shrink-0 items-center gap-2.5 rounded-lg border border-white/12 bg-[#0b0b10]/80 px-3 py-2">
            <span className="label-mono">Render</span>
            <select
              value={quality}
              onChange={(e) => chooseQuality(e.target.value)}
              className="bg-transparent font-mono text-[11px] uppercase tracking-[0.14em] text-chalk outline-none"
              aria-label="Explorer render quality"
            >
              {CHOICES.map((c) => (
                <option key={c.value} value={c.value} className="bg-[#0b0b10]">
                  {c.label}
                  {c.value === 'auto' && tier !== 'off' ? ` · ${TIERS[tier]?.label ?? tier}` : ''}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="relative mt-12 overflow-hidden rounded-3xl border border-white/10 bg-[#070810] shadow-lift">
        <div className="relative h-[520px] sm:h-[640px] lg:h-[860px]">
          {tier === 'off' ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-xl text-muted">
                ◍
              </div>
              <p className="text-lg font-semibold text-chalk">The 3D city is switched off.</p>
              <p className="max-w-md text-sm leading-relaxed text-muted">
                Every zone and product below still filters the gallery — the model is a way in, not the only one. Set
                render quality back to Auto to bring the city back.
              </p>
              <button onClick={() => chooseQuality('auto')} className="btn-ghost mt-1">
                Turn the city back on
              </button>
            </div>
          ) : (
            <ErrorBoundary
              label="3D city"
              fallback={({ error }) => (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                  <p className="text-lg font-semibold text-chalk">The 3D city could not be rendered here.</p>
                  <p className="max-w-md text-sm leading-relaxed text-muted">
                    {error.message}. Every zone and product below still filters the gallery.
                  </p>
                  <button onClick={() => chooseQuality('off')} className="btn-ghost mt-1">
                    Switch the city off
                  </button>
                </div>
              )}
            >
              <Suspense fallback={<CanvasPlaceholder label="Loading the city" />}>
                {near ? (
                  <EcosystemCanvas onHover={setHover} onSelect={open} focusId={selected?.id} tier={tier} />
                ) : (
                  <CanvasPlaceholder label="Scroll to build the city" />
                )}
              </Suspense>
            </ErrorBoundary>
          )}

          {/* hover tooltip */}
          <AnimatePresence>
            {hover && !selected && tier !== 'off' && (
              <motion.div
                key="tip"
                className="pointer-events-none fixed z-20 -translate-x-1/2 -translate-y-[calc(100%+16px)]"
                style={{ left: hover.screen?.x ?? 0, top: hover.screen?.y ?? 0 }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.14 }}
              >
                <div
                  className="rounded-xl border bg-[#08090e]/95 px-3.5 py-2.5 backdrop-blur-xl"
                  style={{ borderColor: `${hover.color}66` }}
                >
                  <p className="text-sm font-semibold text-chalk">{hover.name}</p>
                  <p className="label-mono mt-0.5" style={{ color: hover.color }}>
                    {hover.category} · {counts[hover.id] ?? items.length} plates
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* side info panel */}
          <AnimatePresence>
            {selected && (
              <motion.aside
                key={selected.id}
                className="absolute inset-y-0 right-0 z-20 w-full max-w-[380px] border-l border-white/10 bg-[#08090e]/94 p-6 backdrop-blur-2xl sm:p-7"
                initial={{ x: '100%', opacity: 0.4 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="label-mono" style={{ color: selected.color }}>
                      {selected.category}
                    </p>
                    <h3 className="mt-2 text-2xl font-bold leading-tight text-chalk">{selected.name}</h3>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition hover:border-white/25 hover:text-chalk"
                    aria-label="Close panel"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-5 h-px w-full" style={{ background: `linear-gradient(90deg, ${selected.color}, transparent)` }} />

                <p className="mt-5 text-sm leading-relaxed text-muted">{selected.blurb}</p>

                <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="label-mono">Gallery matches</p>
                  <p className="mt-2 font-mono text-4xl font-bold" style={{ color: selected.color }}>
                    {counts[selected.id] ?? items.length}
                  </p>
                  <p className="mt-2 text-xs text-muted">{routeLabel(selected.route)}</p>
                </div>

                <button
                  onClick={() => send(selected)}
                  className="btn-primary mt-6 w-full"
                  style={{ backgroundColor: selected.color, boxShadow: `0 0 32px -6px ${selected.color}` }}
                >
                  Open in Gallery →
                </button>

                <p className="mt-4 text-[11px] leading-relaxed text-muted/70">
                  Filters the gallery below and scrolls you to it. Clear filters there to return to all {items.length} plates.
                </p>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* hint bar */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4"
            hidden={tier === 'off'}
          >
            <div className="rounded-full border border-white/10 bg-[#08090e]/85 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted backdrop-blur">
              Drag to orbit · Scroll to zoom · Right-drag to pan · Click any node
            </div>
          </div>
        </div>
      </div>

      {/* zone quick-filter pills — the keyboard-equivalent path into the model */}
      <p id="ecosystem-alt" className="mt-6 text-sm text-muted">
        The city is a visual index. Every zone and product in it is listed below as a button, so the whole model is
        reachable without it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {[...ZONES, ...PRODUCT_NODES].map((n) => (
          <button
            key={n.id}
            onClick={() => {
              setSelected(n)
              send(n)
            }}
            className="group flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-2 pl-3 pr-3.5 text-xs text-muted transition hover:bg-white/[0.07] hover:text-chalk"
            style={{ borderColor: `${n.color}2e` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: n.color, boxShadow: `0 0 10px ${n.color}` }} />
            {n.name}
            <span className="font-mono text-[10px] text-muted/60 group-hover:text-muted">{counts[n.id]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
