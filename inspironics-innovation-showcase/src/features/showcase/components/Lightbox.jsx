import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { relatedTo } from '../model/showcaseData.js'
import { useDialog } from '#shared/lib/useDialog.js'

/** Download extension per image type — the corpus is webp, uploads are not. */
const EXT_BY_TYPE = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

export default function Lightbox({ items, index, onIndex, onClose }) {
  const item = index != null ? items[index] : null
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState('')
  const drag = useRef(null)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const step = useCallback(
    (d) => {
      if (!items.length) return
      onIndex((index + d + items.length) % items.length)
      reset()
    },
    [index, items.length, onIndex, reset]
  )

  // scroll lock, focus containment, focus restore and Escape
  const dialogRef = useDialog(item != null, onClose)

  useEffect(() => {
    if (item == null) return
    const onKey = (e) => {
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z * 1.3))
      else if (e.key === '-') setZoom((z) => Math.max(1, z / 1.3))
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, step, reset])

  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  const download = async () => {
    try {
      const res = await fetch(item.fullUrl)
      const blob = await res.blob()
      // The corpus is webp, but a locally added plate is whatever the visitor
      // uploaded, so take the extension from the bytes rather than assuming.
      const ext = EXT_BY_TYPE[blob.type] || item.fullUrl.match(/\.(\w{3,4})(?:[?#]|$)/)?.[1] || 'img'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${item.title.replace(/[^\w\d-]+/g, '-').toLowerCase()}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // revoking in the same tick can cancel the download before it starts
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      window.open(item.fullUrl, '_blank', 'noopener')
    }
  }

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${encodeURIComponent(item.f)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.objective, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied('Link copied')
    } catch {
      setCopied('Could not share')
    }
    setTimeout(() => setCopied(''), 2200)
  }

  const related = item ? relatedTo(items, item, 6) : []

  // Portalled to <body>: the gallery and spotlight sections create their own
  // stacking contexts, which would otherwise let the sticky navbar paint over this.
  return createPortal(
    <AnimatePresence>
      {item && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${item.title} — full blueprint`}
          className="fixed inset-0 z-[90] flex flex-col bg-[#040407]/97 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* toolbar */}
          <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="label-mono !text-cyan-glow/80">{item.cat}</p>
              <h3 className="truncate text-sm font-semibold text-chalk sm:text-base">{item.title}</h3>
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-2 hidden font-mono text-[11px] text-muted sm:inline">
                {index + 1} / {items.length}
              </span>
              <IconBtn onClick={() => setZoom((z) => Math.max(1, z / 1.3))} label="Zoom out">
                −
              </IconBtn>
              <span className="w-11 text-center font-mono text-[11px] text-muted">{Math.round(zoom * 100)}%</span>
              <IconBtn onClick={() => setZoom((z) => Math.min(5, z * 1.3))} label="Zoom in">
                +
              </IconBtn>
              <IconBtn onClick={reset} label="Reset zoom">
                ⟲
              </IconBtn>
              <IconBtn onClick={download} label="Download">
                ↓
              </IconBtn>
              <IconBtn onClick={share} label="Share">
                ↗
              </IconBtn>
              <IconBtn onClick={onClose} label="Close" danger>
                ✕
              </IconBtn>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* stage */}
            <div
              className="relative flex min-h-[42vh] flex-1 items-center justify-center overflow-hidden p-3 sm:p-6"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey) return
                e.preventDefault()
                setZoom((z) => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.12 : 0.89))))
              }}
              onPointerDown={(e) => {
                if (zoom <= 1) return
                drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!drag.current) return
                setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
              }}
              onPointerUp={() => (drag.current = null)}
              style={{ cursor: zoom > 1 ? (drag.current ? 'grabbing' : 'grab') : 'default' }}
            >
              <motion.img
                key={item.f}
                src={item.fullUrl}
                alt={item.title}
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28 }}
                className="h-full w-full select-none rounded-lg object-contain shadow-lift"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
                draggable={false}
              />

              <NavArrow side="left" onClick={() => step(-1)} />
              <NavArrow side="right" onClick={() => step(1)} />

              <AnimatePresence>
                {copied && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute bottom-5 rounded-full border border-cyan-glow/40 bg-[#0a0b12]/90 px-4 py-2 font-mono text-[11px] text-cyan-glow"
                  >
                    {copied}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* metadata sidebar */}
            <aside className="scroll-thin max-h-[46vh] w-full shrink-0 overflow-y-auto border-t border-white/8 p-5 sm:p-6 lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
              <Meta title="Objective">{item.objective}</Meta>
              {item.architecture && <Meta title="Architecture">{item.architecture}</Meta>}

              {item.flow?.length > 0 && (
                <Block title="Process flow">
                  <ol className="space-y-2">
                    {item.flow.map((s, i) => (
                      <li key={s} className="flex items-center gap-3 text-[13px] text-chalk/85">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-cyan-glow/30 bg-cyan-glow/10 font-mono text-[10px] text-cyan-glow">
                          {i + 1}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </Block>
              )}

              {item.components?.length > 0 && (
                <Block title="Components">
                  <div className="flex flex-wrap gap-1.5">
                    {item.components.map((c) => (
                      <span key={c} className="chip !normal-case !tracking-normal !text-[11px] !text-chalk/80">
                        {c}
                      </span>
                    ))}
                  </div>
                </Block>
              )}

              {(item.techben?.length > 0 || item.bizben?.length > 0) && (
                <Block title="Benefits">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    {item.techben?.length > 0 && (
                      <div>
                        <p className="label-mono !text-cyan-glow/70">Technical</p>
                        <ul className="mt-1.5 space-y-1">
                          {item.techben.map((b) => (
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
                        <p className="label-mono !text-emerald-glow/70">Business</p>
                        <ul className="mt-1.5 space-y-1">
                          {item.bizben.map((b) => (
                            <li key={b} className="flex gap-2 text-[12.5px] text-muted">
                              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-glow" />
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Block>
              )}

              {item.takeaway && (
                <div className="mt-6 rounded-xl border border-emerald-glow/25 bg-emerald-glow/[0.05] p-4">
                  <p className="label-mono !text-emerald-glow/80">Key takeaway</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-chalk/90">{item.takeaway}</p>
                </div>
              )}

              <Block title="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {item.tech.map((t) => (
                    <span key={t} className="chip chip-on !py-0.5">
                      {t}
                    </span>
                  ))}
                  {item.esg && <span className="chip">ESG</span>}
                  {item.ai && <span className="chip">AI</span>}
                  {item.iot && <span className="chip">IoT</span>}
                </div>
              </Block>

              {related.length > 0 && (
                <Block title="Related plates">
                  <div className="grid grid-cols-3 gap-2">
                    {related.map((r) => (
                      <button
                        key={r.f}
                        onClick={() => {
                          const i = items.findIndex((x) => x.f === r.f)
                          if (i >= 0) {
                            onIndex(i)
                            reset()
                          }
                        }}
                        className="group overflow-hidden rounded-lg border border-white/10 transition hover:border-cyan-glow/50"
                        title={r.title}
                      >
                        <img
                          src={r.thumbUrl}
                          alt={r.title}
                          loading="lazy"
                          className="aspect-square w-full object-cover transition group-hover:scale-105"
                        />
                      </button>
                    ))}
                  </div>
                </Block>
              )}
            </aside>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

const IconBtn = ({ children, onClick, label, danger = false }) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`grid h-9 w-9 place-items-center rounded-lg border border-white/12 bg-white/5 text-sm text-muted transition hover:text-chalk ${
      danger ? 'hover:border-rose-400/50 hover:text-rose-300' : 'hover:border-cyan-glow/50'
    }`}
  >
    {children}
  </button>
)

const NavArrow = ({ side, onClick }) => (
  <button
    onClick={onClick}
    aria-label={side === 'left' ? 'Previous' : 'Next'}
    className={`absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/12 bg-[#0a0b12]/80 text-lg text-muted backdrop-blur transition hover:border-cyan-glow/50 hover:text-cyan-glow ${
      side === 'left' ? 'left-3 sm:left-6' : 'right-3 sm:right-6'
    }`}
  >
    {side === 'left' ? '‹' : '›'}
  </button>
)

const Block = ({ title, children }) => (
  <div className="mt-6">
    <p className="label-mono">{title}</p>
    <div className="mt-2.5">{children}</div>
  </div>
)

const Meta = ({ title, children }) => (
  <div className="mt-6 first:mt-0">
    <p className="label-mono">{title}</p>
    <p className="mt-2 text-[13px] leading-relaxed text-muted">{children}</p>
  </div>
)
