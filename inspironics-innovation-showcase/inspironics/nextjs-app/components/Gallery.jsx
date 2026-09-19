"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import Lightbox from "./Lightbox";

function FlipCard({ it, onOpen }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div
      className={"flip-scene aspect-[4/3] " + (flipped ? "flipped" : "")}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "120px" }}
      transition={{ duration: 0.5 }}
      onClick={() => setFlipped((f) => !f)}
    >
      <div className="flip-inner relative w-full h-full rounded-[18px]">
        {/* front */}
        <div className="flip-face absolute inset-0 rounded-[18px] overflow-hidden border border-[var(--line)] bg-bg2">
          <span className="absolute top-3 left-3 z-[4] text-[9.5px] tracking-[1.4px] uppercase font-extrabold px-2.5 py-1 rounded-full text-[#021018] bg-gradient-to-r from-cyan to-emer">{it.cat}</span>
          {it.flagship && <span className="absolute top-2.5 right-11 z-[3] text-[13px] text-[#ffd76a]">★</span>}
          <button
            className="absolute top-2.5 right-2.5 z-[3] w-[30px] h-[30px] rounded-[9px] flex items-center justify-center bg-[rgba(5,8,22,.6)] border border-[var(--line)] text-cyan"
            onClick={(e) => { e.stopPropagation(); onOpen(it.f); }} aria-label="Open fullscreen"
          >⛶</button>
          <img src={it.t} alt={it.title} loading="lazy" className="w-full h-full object-cover" />
          <div className="absolute left-0 right-0 bottom-0 p-[26px_14px_12px] bg-gradient-to-t from-[rgba(5,8,22,.94)] to-transparent">
            <h3 className="text-[14px] font-bold leading-snug">{it.title}</h3>
            <div className="text-[10.5px] text-cyan mt-1.5 font-semibold">↻ Tap to flip · ⛶ fullscreen</div>
          </div>
        </div>
        {/* back */}
        <div className="flip-face flip-back absolute inset-0 rounded-[18px] overflow-hidden border border-[var(--line)] glass flex flex-col">
          <div className="p-[13px_15px_9px] border-b border-[var(--line)]">
            <h3 className="text-[14.5px] font-extrabold leading-tight bg-gradient-to-r from-cyan to-emer bg-clip-text text-transparent">{it.title}</h3>
            <div className="text-[9.5px] tracking-[1.4px] uppercase text-dim font-bold mt-1">{it.cat}</div>
          </div>
          <div className="p-[11px_15px_14px] overflow-y-auto flex-1 text-[11.7px] leading-snug scroll-thin">
            <Sec k="Business Objective"><p className="text-mut">{it.objective}</p></Sec>
            <Sec k="Process Flow">
              <div className="flex flex-wrap gap-1 items-center">
                {it.flow.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i ? <span className="text-cyan">→</span> : null}
                    <span className="bg-[rgba(0,229,255,.1)] border border-[var(--line)] rounded-md px-1.5 py-0.5 text-[10.5px]">{s}</span>
                  </span>
                ))}
              </div>
            </Sec>
            <Sec k="Key Components">
              <div className="flex flex-wrap gap-1">
                {it.components.map((c, i) => <span key={i} className="text-[10px] bg-[rgba(0,255,178,.1)] border border-[rgba(0,255,178,.25)] text-emer rounded-md px-1.5 py-0.5">{c}</span>)}
              </div>
            </Sec>
            <Sec k="Architecture"><p className="text-mut">{it.architecture}</p></Sec>
            <Sec k="Business Benefits"><ul className="list-disc pl-4 text-mut">{it.bizben.map((b, i) => <li key={i}>{b}</li>)}</ul></Sec>
            <Sec k="Technical Benefits"><ul className="list-disc pl-4 text-mut">{it.techben.map((b, i) => <li key={i}>{b}</li>)}</ul></Sec>
            <Sec k="Key Takeaway"><div className="bg-[rgba(0,229,255,.08)] border border-[var(--line)] rounded-lg px-2 py-1.5 italic">{it.takeaway}</div></Sec>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
const Sec = ({ k, children }) => (
  <div className="mb-2.5">
    <div className="text-[9.5px] tracking-[1.2px] uppercase font-extrabold text-emer mb-1">{k}</div>
    {children}
  </div>
);

export default function Gallery({ data }) {
  const ALL = data.items;
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [tech, setTech] = useState(new Set());
  const [esg, setEsg] = useState(false);
  const [ai, setAi] = useState(false);
  const [iot, setIot] = useState(false);
  const [sort, setSort] = useState("featured");
  const [open, setOpen] = useState(null); // filename or null

  const view = useMemo(() => {
    let v = ALL.filter((it) => {
      if (cat !== "All" && it.cat !== cat) return false;
      if (esg && !it.esg) return false;
      if (ai && !it.ai) return false;
      if (iot && !it.iot) return false;
      if (tech.size && ![...tech].some((t) => it.tech.includes(t))) return false;
      if (q) {
        const hay = (it.title + " " + it.cat + " " + it.tech.join(" ") + " " + it.components.join(" ") + " " + it.objective).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    if (sort === "title") v = [...v].sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "cat") v = [...v].sort((a, b) => a.cat.localeCompare(b.cat) || a.title.localeCompare(b.title));
    else v = [...v].sort((a, b) => (b.flagship ? 1 : 0) - (a.flagship ? 1 : 0));
    return v;
  }, [ALL, cat, q, tech, esg, ai, iot, sort]);

  const toggleTech = (t) => setTech((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const openIndex = open == null ? -1 : view.findIndex((x) => x.f === open);

  return (
    <section className="max-w-[1560px] mx-auto px-6">
      {/* controls */}
      <div className="sticky top-0 z-[60] py-3 flex flex-col gap-3 bg-[rgba(5,8,22,.85)] backdrop-blur-lg border-y border-[var(--line)]">
        <div className="flex gap-3 items-center flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, components, technologies…"
            className="flex-1 min-w-[220px] max-w-[420px] glass border border-[var(--line)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="glass border border-[var(--line)] rounded-lg px-3 py-2 text-[12.5px] font-semibold">
            <option value="featured">★ Featured first</option>
            <option value="title">Title A–Z</option>
            <option value="cat">By category</option>
          </select>
          <Toggle on={esg} set={setEsg}>🌱 ESG</Toggle>
          <Toggle on={ai} set={setAi}>✦ AI</Toggle>
          <Toggle on={iot} set={setIot}>📡 IoT</Toggle>
          <span className="ml-auto text-[13px] text-dim">{view.length} of {ALL.length}</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Chip active={cat === "All"} onClick={() => setCat("All")}>All <em className="opacity-60 not-italic">{ALL.length}</em></Chip>
          {data.cats.map((c) => <Chip key={c.name} active={cat === c.name} onClick={() => setCat(c.name)}>{c.name} <em className="opacity-60 not-italic">{c.count}</em></Chip>)}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[10.5px] tracking-[1.5px] uppercase text-dim font-bold">Technology</span>
          {data.techs.map((t) => <Chip key={t} active={tech.has(t)} onClick={() => toggleTech(t)} emer>{t}</Chip>)}
        </div>
      </div>

      {/* grid */}
      <div className="grid gap-6 py-6 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {view.map((it) => <FlipCard key={it.f} it={it} onOpen={setOpen} />)}
      </div>
      {view.length === 0 && <div className="text-center text-mut py-20 text-base">No architectures match your filters.</div>}

      {openIndex >= 0 && (
        <Lightbox
          list={view} index={openIndex}
          onClose={() => setOpen(null)}
          onNav={(d) => setOpen(view[(openIndex + d + view.length) % view.length].f)}
          onOpen={(f) => setOpen(f)}
        />
      )}
    </section>
  );
}

const Chip = ({ active, onClick, children, emer }) => (
  <button onClick={onClick}
    className={"px-3 py-1.5 rounded-full border text-[12.5px] font-semibold transition " +
      (active
        ? `text-[#021018] border-transparent ${emer ? "bg-gradient-to-r from-emer to-cyan" : "bg-gradient-to-r from-cyan to-emer"}`
        : "glass border-[var(--line)] text-mut hover:text-white hover:border-cyan")}
  >{children}</button>
);
const Toggle = ({ on, set, children }) => (
  <button onClick={() => set((v) => !v)}
    className={"flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-2 border transition " +
      (on ? "text-[#021018] bg-gradient-to-r from-cyan to-emer border-transparent" : "glass border-[var(--line)] text-mut hover:text-white hover:border-cyan")}
  >{children}</button>
);
