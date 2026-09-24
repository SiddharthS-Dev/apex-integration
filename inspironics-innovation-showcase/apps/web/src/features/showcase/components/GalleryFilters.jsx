export default function GalleryFilters({
  cats,
  techs,
  cat,
  setCat,
  tech,
  setTech,
  flags,
  setFlags,
  q,
  setQ,
  sort,
  setSort,
  shown,
  total,
  onClear,
  dirty,
}) {
  const toggleTech = (t) => setTech(tech.includes(t) ? tech.filter((x) => x !== t) : [...tech, t])
  const toggleFlag = (k) => setFlags({ ...flags, [k]: !flags[k] })

  return (
    <div className="sticky top-[68px] z-30 mt-8 rounded-2xl border border-white/10 bg-[#0a0b11]/92 p-4 shadow-lift backdrop-blur-2xl sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="field !w-auto min-w-[190px] !py-2.5">
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>

        <div className="relative min-w-[200px] flex-1">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles, components, products…"
            className="field !py-2.5 pl-9"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted/70">⌕</span>
        </div>

        <select value={sort} onChange={(e) => setSort(e.target.value)} className="field !w-auto min-w-[150px] !py-2.5">
          <option value="featured">Sort · Featured</option>
          <option value="title">Sort · Title A–Z</option>
          <option value="cat">Sort · Category</option>
        </select>

        <div className="ml-auto flex items-center gap-3">
          <span className="whitespace-nowrap font-mono text-xs text-muted">
            <span className="text-cyan-glow">{shown}</span> of {total}
          </span>
          {dirty && (
            <button onClick={onClear} className="text-xs text-muted underline underline-offset-4 transition hover:text-cyan-glow">
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {techs.map((t) => (
          <button key={t} onClick={() => toggleTech(t)} className={`chip ${tech.includes(t) ? 'chip-on' : 'hover:text-chalk'}`}>
            {t}
          </button>
        ))}

        <span className="mx-1 hidden h-4 w-px bg-white/12 sm:block" />

        {[
          ['esg', 'ESG'],
          ['ai', 'AI'],
          ['iot', 'IoT'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => toggleFlag(k)}
            className={`chip ${
              flags[k] ? '!border-emerald-glow/60 !bg-emerald-glow/12 !text-emerald-glow' : 'hover:text-chalk'
            }`}
          >
            {flags[k] ? '●' : '○'} {label}
          </button>
        ))}
      </div>
    </div>
  )
}
