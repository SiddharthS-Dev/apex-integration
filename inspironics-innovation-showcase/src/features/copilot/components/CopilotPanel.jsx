import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Markdown from '#shared/ui/Markdown'
import Logo from '#shared/ui/Logo'
import { CopilotNote, SUGGESTIONS, answerQuestion, getShowcaseKnowledge, renderCards } from '../model/copilotKnowledge.js'
import { useAuth } from '#features/auth'
import { useDialog } from '#shared/lib/useDialog.js'

const sessionId = `s_${Date.now().toString(36)}`

export default function CopilotPanel({ onOpenItem }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  // Non-modal popover: Escape closes it and focus moves in and back out, but
  // focus is not trapped — the page behind stays usable while it is open.
  const panelRef = useDialog(open, () => setOpen(false), { lockScroll: false, trapFocus: false })
  const [knowledge, setKnowledge] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scroller = useRef(null)

  const greeting = useMemo(
    () => ({
      role: 'assistant',
      text:
        'I am the **Showcase Copilot**. I have every plate in the estate indexed — including the product names printed inside the artwork.\n\nAsk me what you are looking for.',
    }),
    []
  )

  useEffect(() => {
    if (!open || knowledge) return
    getShowcaseKnowledge()
      .then(setKnowledge)
      .catch(() => setMessages((m) => [...m, { role: 'assistant', text: 'I could not load the corpus. Reload the page and try again.' }]))
  }, [open, knowledge])

  // restore this session's persisted transcript
  useEffect(() => {
    if (!open || messages.length || !user) return
    const prior = CopilotNote.list(user, sessionId)
    setMessages(prior.length ? prior.map((n) => ({ role: n.role, text: n.text })) : [greeting])
  }, [open, user, messages.length, greeting])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const send = useCallback(
    async (raw) => {
      const q = (raw ?? input).trim()
      if (!q || thinking) return
      setInput('')
      setMessages((m) => [...m, { role: 'user', text: q }])
      if (user) CopilotNote.create(user, { sessionId, role: 'user', text: q })
      setThinking(true)

      const k = knowledge || (await getShowcaseKnowledge().then((v) => (setKnowledge(v), v)))
      await new Promise((r) => setTimeout(r, 340))

      const { text, items } = answerQuestion(k, q)
      const body = items.length ? `${text}\n\n${renderCards(items)}` : text
      setMessages((m) => [...m, { role: 'assistant', text: body, itemIds: items.map((i) => i.f) }])
      if (user) CopilotNote.create(user, { sessionId, role: 'assistant', text: body, itemIds: items.map((i) => i.f) })
      setThinking(false)
    },
    [input, thinking, knowledge, user]
  )

  const openImage = (idOrTitle) => {
    const it = knowledge?.items.find((x) => x.f === idOrTitle || x.title === idOrTitle)
    if (it) onOpenItem?.(it)
  }

  return (
    <>
      {/* launcher */}
      <motion.button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[70] grid h-14 w-14 place-items-center rounded-full bg-cyan-glow text-[#04141a] shadow-glow"
        style={{ animation: open ? 'none' : undefined }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        aria-label={open ? 'Close copilot' : 'Open copilot'}
      >
        <span className={open ? '' : 'animate-pulseGlow absolute inset-0 rounded-full'} aria-hidden="true" />
        <span className="relative text-xl">{open ? '✕' : '✦'}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            ref={panelRef}
            role="dialog"
            aria-label="Showcase copilot"
            className="glass-strong fixed bottom-24 right-4 z-[70] flex h-[min(620px,calc(100dvh-140px))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl shadow-lift"
          >
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
              <Logo size={24} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-chalk">Showcase Copilot</p>
                <p className="label-mono">
                  {knowledge ? `${knowledge.totalCount} plates indexed` : 'Loading corpus…'}
                </p>
              </div>
              <button
                onClick={() => {
                  if (user) CopilotNote.clearSession(user, sessionId)
                  setMessages([greeting])
                }}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition hover:border-cyan-glow/40 hover:text-cyan-glow"
              >
                Clear
              </button>
            </header>

            <div ref={scroller} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
                      m.role === 'user'
                        ? 'rounded-br-sm bg-cyan-glow/15 text-[13px] text-chalk'
                        : 'rounded-bl-sm border border-white/10 bg-white/[0.035]'
                    }`}
                  >
                    {m.role === 'user' ? m.text : <Markdown text={m.text} onOpenImage={openImage} />}
                  </div>
                </div>
              ))}

              {thinking && (
                <div className="flex justify-start">
                  <div className="flex gap-1.5 rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.035] px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-cyan-glow"
                        animate={{ opacity: [0.25, 1, 0.25] }}
                        transition={{ duration: 1, delay: i * 0.16, repeat: Infinity }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {messages.length <= 1 && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] text-muted transition hover:border-cyan-glow/40 hover:text-cyan-glow"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
              className="flex gap-2 border-t border-white/10 p-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the estate…"
                className="field !py-2.5 text-[13px]"
              />
              <button type="submit" disabled={!input.trim() || thinking} className="btn-primary !px-4 !py-2.5">
                ↑
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
