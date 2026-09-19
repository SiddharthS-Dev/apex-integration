"use client";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const Row = ({ k, children }) => (
  <div>
    <div className="text-[10px] tracking-[1.3px] uppercase font-extrabold text-emer mb-1">{k}</div>
    <div className="text-[13.5px] text-mut leading-relaxed">{children}</div>
  </div>
);

export default function Lightbox({ list, index, onClose, onNav, onOpen }) {
  const it = list[index];
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNav(-1);
      if (e.key === "ArrowRight") onNav(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onNav]);

  if (!it) return null;
  const related = list.filter((x) => x.cat === it.cat && x.f !== it.f).slice(0, 6);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[200] flex bg-[rgba(3,5,14,.96)] backdrop-blur-md max-[900px]:flex-col max-[900px]:overflow-y-auto"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={(e) => { if (e.currentTarget === e.target) onClose(); }}
      >
        <div className="fixed top-6 left-6 text-mut text-[13px] z-[3]">{index + 1} / {list.length}</div>
        <button onClick={onClose} className="fixed top-4 right-5 w-11 h-11 rounded-full glass border border-[var(--line)] text-xl z-[3]">✕</button>
        <button onClick={() => onNav(-1)} className="fixed top-1/2 -translate-y-1/2 left-5 w-12 h-12 rounded-full glass border border-[var(--line)] text-2xl z-[2]">‹</button>
        <button onClick={() => onNav(1)} className="fixed top-1/2 -translate-y-1/2 right-[424px] max-[900px]:right-5 w-12 h-12 rounded-full glass border border-[var(--line)] text-2xl z-[2]">›</button>

        <div className="flex-1 flex items-center justify-center p-[54px_70px_40px] max-[900px]:p-4 min-w-0" onClick={onClose}>
          <img src={it.full} alt={it.title} onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[84vh] max-[900px]:max-h-[50vh] rounded-xl border border-[var(--line)]" />
        </div>

        <aside className="w-[404px] max-[900px]:w-full flex-none glass border-l border-[var(--line)] p-7 overflow-y-auto flex flex-col gap-3.5 scroll-thin"
          onClick={(e) => e.stopPropagation()}>
          <span className="self-start text-[9.5px] tracking-[2px] uppercase font-extrabold text-[#021018] px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan to-emer">
            {it.cat}{it.flagship ? " ★ Flagship" : ""}
          </span>
          <h2 className="text-[22px] font-extrabold leading-tight">{it.title}</h2>
          <Row k="Business Objective"><p>{it.objective}</p></Row>
          <Row k="Process Flow">
            <div className="flex flex-wrap gap-1 items-center">
              {it.flow.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i ? <span className="text-cyan">→</span> : null}
                  <span className="bg-[rgba(0,229,255,.1)] border border-[var(--line)] rounded-md px-2 py-0.5 text-[10.5px] text-white">{s}</span>
                </span>
              ))}
            </div>
          </Row>
          <Row k="Key Components">
            <div className="flex flex-wrap gap-1">
              {it.components.map((c, i) => (
                <span key={i} className="text-[10px] bg-[rgba(0,255,178,.1)] border border-[rgba(0,255,178,.25)] text-emer rounded-md px-2 py-0.5">{c}</span>
              ))}
            </div>
          </Row>
          <Row k="Architecture"><p>{it.architecture}</p></Row>
          <Row k="Business Benefits"><ul className="list-disc pl-4">{it.bizben.map((b, i) => <li key={i}>{b}</li>)}</ul></Row>
          <Row k="Technical Benefits"><ul className="list-disc pl-4">{it.techben.map((b, i) => <li key={i}>{b}</li>)}</ul></Row>
          <Row k="Key Takeaway"><div className="bg-[rgba(0,229,255,.08)] border border-[var(--line)] rounded-lg px-2.5 py-2 italic text-white">{it.takeaway}</div></Row>

          <div className="flex gap-2 flex-wrap">
            <a className="flex-1 text-center text-[12.5px] font-bold p-2.5 rounded-lg bg-gradient-to-r from-cyan to-emer text-[#021018]" href={it.f} target="_blank" rel="noreferrer">Original ↗</a>
            <a className="flex-1 text-center text-[12.5px] font-bold p-2.5 rounded-lg border border-[var(--line)]" href={it.f} download>Download</a>
          </div>

          {related.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[1.3px] uppercase font-extrabold text-dim mb-2">Related infographics</div>
              <div className="grid grid-cols-3 gap-2">
                {related.map((r) => (
                  <img key={r.f} src={r.t} alt={r.title} title={r.title} onClick={() => onOpen(r.f)}
                    className="w-full aspect-square object-cover rounded-lg border border-[var(--line)] opacity-80 hover:opacity-100 cursor-pointer transition" />
                ))}
              </div>
            </div>
          )}
          <div className="text-[11.5px] text-dim border-t border-[var(--line)] pt-3 flex justify-between gap-2 flex-wrap">
            <span>{it.w} × {it.h} px</span><span>{it.f}</span>
          </div>
        </aside>
      </motion.div>
    </AnimatePresence>
  );
}
