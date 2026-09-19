import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import FlipCard from './FlipCard'
import GalleryFilters from './GalleryFilters'
import AddImageModal from './AddImageModal'
import SectionHead from '#shared/ui/SectionHead'

const PAGE = 48

export default function Gallery({ data, activeFilter, onClearActive, onAdded, onOpenPlate }) {
  const [cat, setCat] = useState('')
  const [tech, setTech] = useState([])
  const [flags, setFlags] = useState({ esg: false, ai: false, iot: false })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('featured')
  const [limit, setLimit] = useState(PAGE)
  const [adding, setAdding] = useState(false)

  const { items, cats, techs } = data

  // A node click in the 3D explorer overrides whatever is set locally.
  useEffect(() => {
    if (!activeFilter) return
    const { type, value } = activeFilter
    setCat(type === 'cat' ? value : '')
    setTech(type === 'tech' ? [value] : [])
    setQ(type === 'q' ? value : '')
    setFlags({ esg: false, ai: false, iot: false })
    setLimit(PAGE)
  }, [activeFilter])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const tokens = needle ? needle.split(/\s+/) : []
    let out = items.filter((it) => {
      if (cat && it.cat !== cat) return false
      if (tech.length && !tech.every((t) => it.tech.includes(t))) return false
      if (flags.esg && !it.esg) return false
      if (flags.ai && !it.ai) return false
      if (flags.iot && !it.iot) return false
      if (tokens.length && !tokens.every((t) => it._hay.includes(t))) return false
      return true
    })

    if (sort === 'title') out = [...out].sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'cat') out = [...out].sort((a, b) => a.cat.localeCompare(b.cat) || a.title.localeCompare(b.title))
    else
      out = [...out].sort(
        (a, b) => (b.custom ? 2 : 0) - (a.custom ? 2 : 0) || (b.flagship ? 1 : 0) - (a.flagship ? 1 : 0)
      )
    return out
  }, [items, cat, tech, flags, q, sort])

  useEffect(() => setLimit(PAGE), [cat, tech, flags, q, sort])

  // Any hand-edit of the filters supersedes the ecosystem route, so the banner
  // must not keep claiming the gallery is showing that node's slice.
  const manual = (fn) => (value) => {
    onClearActive?.()
    fn(value)
  }

  const dirty = !!(cat || tech.length || q || flags.esg || flags.ai || flags.iot)

  const clearAll = () => {
    setCat('')
    setTech([])
    setFlags({ esg: false, ai: false, iot: false })
    setQ('')
    onClearActive?.()
  }

  const visible = filtered.slice(0, limit)

  return (
    <section id="gallery" className="section-pad relative z-10 !pt-8">
      <SectionHead
        eyebrow="Invention Matrix"
        title="Innovation Gallery"
        sub={`Every plate in the estate — hover a card for the technical breakdown, open it for the full blueprint, architecture notes and related work.`}
        right={
          <motion.button
            onClick={() => setAdding(true)}
            className="btn-primary shrink-0"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            ＋ Add Image
          </motion.button>
        }
      />

      {activeFilter && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-glow/25 bg-cyan-glow/[0.06] px-4 py-3"
        >
          <span className="label-mono !text-cyan-glow">Ecosystem filter</span>
          <span className="text-sm text-chalk">{activeFilter.sourceName}</span>
          <button onClick={clearAll} className="ml-auto text-xs text-muted underline underline-offset-4 hover:text-cyan-glow">
            Release filter
          </button>
        </motion.div>
      )}

      <GalleryFilters
        cats={cats}
        techs={techs}
        cat={cat}
        setCat={manual(setCat)}
        tech={tech}
        setTech={manual(setTech)}
        flags={flags}
        setFlags={manual(setFlags)}
        q={q}
        setQ={manual(setQ)}
        sort={sort}
        setSort={setSort}
        shown={filtered.length}
        total={items.length}
        onClear={clearAll}
        dirty={dirty}
      />

      {filtered.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-4 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-2xl text-muted">
            ⌕
          </div>
          <p className="text-lg font-semibold text-chalk">No architectures match your filters.</p>
          <button onClick={clearAll} className="text-sm text-cyan-glow underline underline-offset-4">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((item, i) => (
              <FlipCard
                key={item.f}
                item={item}
                index={i % PAGE}
                // the viewer lives in Home; hand it the filtered list so
                // prev/next still steps through what is on screen
                onOpen={(it) => onOpenPlate?.(filtered, filtered.findIndex((x) => x.f === it.f))}
              />
            ))}
          </div>

          {limit < filtered.length && (
            <div className="mt-12 flex justify-center">
              <button onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost">
                Load {Math.min(PAGE, filtered.length - limit)} more · {filtered.length - limit} remaining
              </button>
            </div>
          )}
        </>
      )}

      <AddImageModal
        open={adding}
        cats={cats.map((c) => c.name)}
        techs={techs}
        onClose={() => setAdding(false)}
        onAdded={(it) => {
          setAdding(false)
          onAdded?.(it)
        }}
      />
    </section>
  )
}
