import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { addCustomItem } from '../model/customItems.js'
import { useDialog } from '#shared/lib/useDialog.js'

const EMPTY = {
  title: '',
  cat: 'Systems & Architecture',
  imageUrl: '',
  objective: '',
  architecture: '',
  components: '',
  tech: [],
  esg: false,
  ai: false,
  iot: false,
}

/**
 * Adds a local-only gallery item. The image is stored as a data URL in
 * localStorage, so it stays on this browser — nothing is uploaded anywhere.
 */
export default function AddImageModal({ open, cats, techs, onClose, onAdded }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (open) {
      setForm(EMPTY)
      setError('')
    }
  }, [open])

  // Escape, focus containment and focus restore. The overlay scrolls itself,
  // so the body lock stays off here.
  const dialogRef = useDialog(open, onClose, { lockScroll: false })

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const pickFile = (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Choose an image file.')
    // base64 inflates by about a third, and the whole gallery shares one ~5 MB
    // localStorage quota, so the usable ceiling is far below what it looks like
    if (file.size > 1.5 * 1024 * 1024) return setError('Images must be under 1.5 MB to fit in local storage.')
    const reader = new FileReader()
    reader.onload = () => {
      set('imageUrl', reader.result)
      setError('')
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsDataURL(file)
  }

  const submit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) return setError('Give the plate a title.')
    if (!form.imageUrl) return setError('Add an image — upload a file or paste an image URL.')
    setBusy(true)
    try {
      const item = addCustomItem({
        ...form,
        components: form.components
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      onAdded?.(item)
    } catch (err) {
      setError(err.message || 'Could not save that item.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.form
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add a new architecture plate"
            onSubmit={submit}
            initial={{ opacity: 0, y: 26, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="glass-strong my-auto w-full max-w-2xl rounded-2xl p-6 shadow-lift sm:p-8"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Add to matrix</p>
                <h3 className="mt-2 text-2xl font-bold text-chalk">New architecture plate</h3>
              </div>
              <button type="button" onClick={onClose} className="text-xl text-muted hover:text-chalk" aria-label="Close">
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-muted">
              Saved to this browser only — it appears at the top of the gallery and is searchable like any other plate.
            </p>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                pickFile(e.dataTransfer.files?.[0])
              }}
              onClick={() => fileRef.current?.click()}
              className="mt-6 cursor-pointer overflow-hidden rounded-xl border border-dashed border-white/20 transition hover:border-cyan-glow/50"
            >
              {form.imageUrl ? (
                <img src={form.imageUrl} alt="Preview" className="max-h-56 w-full object-contain bg-black/40" />
              ) : (
                <div className="grid h-36 place-items-center text-center">
                  <div>
                    <p className="text-sm text-chalk">Drop an image, or click to browse</p>
                    <p className="label-mono mt-1">PNG · JPG · WEBP · under 4 MB</p>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Title">
                <input value={form.title} onChange={(e) => set('title', e.target.value)} className="field" placeholder="Edge Inference Mesh" />
              </Field>
              <Field label="Category">
                <select value={form.cat} onChange={(e) => set('cat', e.target.value)} className="field">
                  {cats.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Or paste an image URL" full>
                <input
                  value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl}
                  onChange={(e) => set('imageUrl', e.target.value)}
                  className="field"
                  placeholder="https://…"
                />
              </Field>
              <Field label="Objective" full>
                <textarea value={form.objective} onChange={(e) => set('objective', e.target.value)} rows={2} className="field resize-none" />
              </Field>
              <Field label="Architecture notes" full>
                <textarea value={form.architecture} onChange={(e) => set('architecture', e.target.value)} rows={2} className="field resize-none" />
              </Field>
              <Field label="Components (comma-separated)" full>
                <input value={form.components} onChange={(e) => set('components', e.target.value)} className="field" placeholder="Gateway, Broker, Twin" />
              </Field>
            </div>

            <div className="mt-4">
              <p className="label-mono">Tech domains</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {techs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('tech', form.tech.includes(t) ? form.tech.filter((x) => x !== t) : [...form.tech, t])}
                    className={`chip ${form.tech.includes(t) ? 'chip-on' : ''}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {['esg', 'ai', 'iot'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set(k, !form[k])}
                  className={`chip ${form[k] ? '!border-emerald-glow/60 !bg-emerald-glow/12 !text-emerald-glow' : ''}`}
                >
                  {form[k] ? '●' : '○'} {k.toUpperCase()}
                </button>
              ))}
            </div>

            {error && <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn-primary flex-1">
                {busy ? 'Saving…' : 'Add to gallery'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

const Field = ({ label, children, full = false }) => (
  <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
    <span className="label-mono">{label}</span>
    <div className="mt-1.5">{children}</div>
  </label>
)
