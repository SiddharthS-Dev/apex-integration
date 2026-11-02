import { ArrowRight, Check, GitBranch, Quote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONES, lit, once, reveal, size } from '@/components/lesson/slideKit';

// Slide layouts for what playbooks are made of: rules, definitions, checklists, right-vs-wrong
// practice, decisions, tables, timelines and config. Each one reveals its items as the narration
// reaches them (`shown` items are on screen; the last one is the one being spoken about) and draws
// the playbook's own words as real text. See scenes.js for the data each one receives.

/** A rule quoted word for word from the playbook, with the section it comes from. */
export function RuleSlide({ scene, accent }) {
  const [a, b] = accent;
  return (
    <figure
      className="sa-once relative mt-[0.5cqw] rounded-[1.4cqw] border border-white/10 bg-white/[.05]"
      style={{ padding: '2.4cqw 3cqw 2.4cqw 6.5cqw', ...lit(accent), ...once('sa-in', 0.8, 0.3) }}
    >
      <span
        aria-hidden="true"
        className="absolute left-[1.8cqw] top-[2.2cqw] grid place-items-center rounded-[1cqw] w-[3.4cqw] h-[3.4cqw] min-w-5 min-h-5"
        style={{ background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 0 2cqw ${a}` }}
      >
        <Quote className="w-[55%] h-[55%]" />
      </span>
      <figcaption className="font-semibold uppercase tracking-[0.18em]" style={{ ...size(1.15, 8), color: b }}>
        The playbook says
      </figcaption>
      <blockquote className="mt-[1cqw] font-semibold leading-snug text-white" style={size(scene.quote.length > 160 ? 2.1 : 2.5, 11)}>
        {scene.quote}
      </blockquote>
    </figure>
  );
}

/** One term and what it means. */
export function DefinitionSlide({ scene, accent }) {
  const [a, b] = accent;
  return (
    <div className="mt-[0.5cqw] grid gap-[1.4cqw]">
      <div className="sa-once font-semibold uppercase tracking-[0.18em]" style={{ ...size(1.15, 8), color: b, ...once('sa-slide', 0.5, 0.3) }}>Definition</div>
      <div
        className="sa-once font-extrabold leading-none tracking-tight bg-clip-text text-transparent"
        style={{ ...size(4.6, 20), backgroundImage: `linear-gradient(120deg, #fff 30%, ${a})`, ...once('sa-in', 0.8, 0.4) }}
      >
        {scene.term}
      </div>
      <span className="sa-once block h-[0.25cqw] min-h-px w-[10cqw] origin-left rounded-full" style={{ background: `linear-gradient(90deg, ${a}, ${b})`, ...once('sa-grow-x', 0.7, 0.7) }} />
      <p className="sa-once max-w-[52cqw] leading-snug text-white/85" style={{ ...size(2.1, 11), ...once('sa-in', 0.8, 0.9) }}>
        {scene.definition}
      </p>
    </div>
  );
}

/** Things to check or have in place, ticked off as they are covered. */
export function ChecklistSlide({ scene, shown, accent }) {
  const [a, b] = accent;
  const dense = scene.points.length > 4;
  return (
    <ul className="grid" style={{ rowGap: dense ? '0.6cqw' : '1cqw' }}>
      {scene.points.map((p, i) => {
        const visible = i < shown;
        const active = i === shown - 1;
        const done = i < shown - 1;
        return (
          <li key={p} style={reveal(visible, 'translateX(-20px)')}>
            <div
              className={cn('flex items-center gap-[1.4cqw] rounded-[1cqw] border transition-all duration-700', active ? 'bg-white/[.09]' : 'bg-white/[.035] border-white/[.07]')}
              style={{ padding: dense ? '0.55cqw 1.2cqw' : '0.9cqw 1.3cqw', ...(active ? lit(accent) : {}) }}
            >
              <span
                className="grid shrink-0 place-items-center rounded-[0.6cqw] w-[2.6cqw] h-[2.6cqw] min-w-4 min-h-4 border-2 transition-all duration-500"
                style={done || active ? { borderColor: a, background: done ? `linear-gradient(135deg, ${a}, ${b})` : 'transparent' } : { borderColor: 'rgba(255,255,255,.25)' }}
              >
                {done && <Check className="w-[70%] h-[70%] text-white" strokeWidth={3.2} />}
              </span>
              <span className={cn('leading-snug transition-colors duration-500', active ? 'text-white' : done ? 'text-white/60' : 'text-white/75')} style={size(dense ? 1.5 : 1.75, 10)}>
                {p}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Two sides set against each other: do vs don't, before vs after, option A vs B. */
export function CompareSlide({ scene, shown, accent }) {
  const [a] = accent;
  let n = 0;
  return (
    <div className="grid grid-cols-2 gap-[2cqw]">
      {scene.columns.map((col, ci) => {
        const tone = TONES[col.tone] || { color: a, soft: `${a}1f` };
        const Mark = col.tone === 'dont' ? X : Check;
        return (
          <section key={ci} className="sa-once rounded-[1.3cqw] border border-white/10 bg-white/[.04] p-[1.6cqw]" style={once('sa-in', 0.7, 0.3 + ci * 0.15)}>
            <header className="flex items-center gap-[0.9cqw] font-bold uppercase tracking-[0.14em]" style={{ ...size(1.35, 9), color: tone.color }}>
              <span className="grid place-items-center rounded-full w-[2.4cqw] h-[2.4cqw] min-w-4 min-h-4" style={{ background: tone.soft, boxShadow: `inset 0 0 0 1px ${tone.color}66` }}>
                <Mark className="w-[60%] h-[60%]" strokeWidth={3} />
              </span>
              {col.label}
            </header>
            <ul className="mt-[1.2cqw] grid gap-[0.8cqw]">
              {col.items.map((item) => {
                const i = n++;
                const active = i === shown - 1;
                return (
                  <li
                    key={item}
                    className={cn('rounded-[0.8cqw] border leading-snug transition-all duration-500', active ? 'text-white' : 'border-transparent text-white/75')}
                    style={{ ...size(1.6, 10), padding: '0.7cqw 1cqw', ...reveal(i < shown), ...(active ? { borderColor: `${tone.color}80`, background: tone.soft } : {}) }}
                  >
                    {item}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Conditions and what to do in each, drawn as branches off one question. */
export function DecisionSlide({ scene, shown, accent }) {
  const [a, b] = accent;
  return (
    <div className="grid gap-[1.2cqw]">
      {scene.question && (
        <div className="sa-once inline-flex w-fit items-center gap-[1cqw] rounded-full border border-white/15 bg-white/[.06] font-semibold text-white" style={{ ...size(1.6, 10), padding: '0.7cqw 1.6cqw', ...once('sa-in', 0.6, 0.3) }}>
          <GitBranch className="w-[2cqw] h-[2cqw] min-w-3 min-h-3" style={{ color: b }} />
          {scene.question}
        </div>
      )}
      <ol className="grid gap-[0.9cqw]" style={{ paddingLeft: scene.question ? '2.4cqw' : 0, borderLeft: scene.question ? `0.2cqw solid ${a}55` : 'none' }}>
        {scene.branches.map((br, i) => {
          const active = i === shown - 1;
          return (
            <li key={`${br.when}-${i}`} className="grid items-center gap-[1.2cqw]" style={{ gridTemplateColumns: 'minmax(0, 0.9fr) auto minmax(0, 1.3fr)', ...reveal(i < shown, 'translateX(-18px)') }}>
              <span
                className={cn('rounded-[0.8cqw] border font-semibold leading-snug transition-all duration-500', active ? 'text-white' : 'border-white/10 text-white/75')}
                style={{ ...size(1.5, 9), padding: '0.8cqw 1.1cqw', ...(active ? { borderColor: `${a}90`, background: `${a}26` } : { background: 'rgba(255,255,255,.04)' }) }}
              >
                {br.when}
              </span>
              <ArrowRight className="w-[2.2cqw] h-[2.2cqw] min-w-3 min-h-3 transition-colors duration-500" style={{ color: active ? b : 'rgba(255,255,255,.35)' }} />
              <span
                className={cn('rounded-[0.8cqw] border leading-snug transition-all duration-500', active ? 'bg-white/[.09] text-white' : 'border-white/[.07] bg-white/[.035] text-white/75')}
                style={{ ...size(1.55, 9), padding: '0.8cqw 1.1cqw', ...(active ? lit(accent) : {}) }}
              >
                {br.then}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Values the playbook gives as a table: rows appear as they are discussed, the current one lit. */
export function TableSlide({ scene, shown, accent }) {
  const [a] = accent;
  const { headers, rows } = scene.table;
  const text = size(rows.length > 4 || headers.length > 3 ? 1.4 : 1.6, 9);
  return (
    <div className="sa-once overflow-hidden rounded-[1.2cqw] border border-white/10 bg-white/[.03]" style={once('sa-in', 0.7, 0.3)}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr style={{ background: `${a}2a` }}>
            {headers.map((h) => (
              <th key={h} className="font-semibold uppercase tracking-[0.1em] text-white/90" style={{ ...size(1.15, 8), padding: '1cqw 1.4cqw' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const active = i === shown - 1;
            return (
              <tr
                key={i}
                className="border-t border-white/[.07] transition-colors duration-500"
                style={{ opacity: i < shown ? 1 : 0, transition: 'opacity .6s ease, background-color .5s', background: active ? `${a}1f` : 'transparent', boxShadow: active ? `inset 0.3cqw 0 0 ${a}` : 'none' }}
              >
                {row.map((cell, ci) => (
                  <td key={ci} className={cn('leading-snug', ci === 0 ? 'font-semibold text-white' : active ? 'text-white' : 'text-white/75')} style={{ ...text, padding: '0.9cqw 1.4cqw' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Events in time order along a line that fills as the story moves on. */
export function TimelineSlide({ scene, shown, accent }) {
  const [a, b] = accent;
  const n = scene.events.length;
  const progress = n > 1 ? Math.max(0, shown - 1) / (n - 1) : 1;
  return (
    <div className="relative pt-[1cqw]">
      <div aria-hidden="true" className="absolute top-[3.6cqw] h-[0.25cqw] min-h-px rounded-full bg-white/10" style={{ left: `${50 / n}%`, right: `${50 / n}%` }}>
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-in-out" style={{ width: `${progress * 100}%`, background: `linear-gradient(90deg, ${a}, ${b})` }} />
      </div>
      <ol className="relative grid gap-[1.2cqw]" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {scene.events.map((e, i) => {
          const visible = i < shown;
          const active = i === shown - 1;
          return (
            <li key={`${e.label}-${i}`} className="flex flex-col items-center text-center" style={reveal(visible)}>
              <span className="font-bold tabular-nums uppercase tracking-[0.08em]" style={{ ...size(1.25, 8), color: active ? '#fff' : b }}>{e.label}</span>
              <span
                className="relative mt-[0.8cqw] grid place-items-center rounded-full w-[2.2cqw] h-[2.2cqw] min-w-3 min-h-3 transition-all duration-500"
                style={active ? { background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 0 2.4cqw ${a}` } : { background: '#0b0d24', boxShadow: `inset 0 0 0 0.25cqw ${visible ? a : 'rgba(255,255,255,.2)'}` }}
              >
                {active && <span className="absolute inset-0 rounded-full" style={{ background: a, animation: 'sa-pulse 2.4s ease-in-out infinite' }} />}
              </span>
              <p
                className={cn('mt-[1.2cqw] rounded-[1cqw] border leading-snug transition-all duration-500', active ? 'bg-white/[.09] text-white' : 'border-white/[.07] bg-white/[.035] text-white/75')}
                style={{ ...size(n > 4 ? 1.35 : 1.55, 9), padding: '1cqw 1.1cqw', ...(active ? lit(accent) : {}) }}
              >
                {e.text}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A command or config block copied from the playbook, revealed line by line. */
export function CodeSlide({ scene, shown, accent }) {
  const [a] = accent;
  const lines = scene.code.split('\n');
  return (
    <div className="sa-once overflow-hidden rounded-[1.2cqw] border border-white/10 bg-[#04050f]/80" style={{ ...once('sa-in', 0.7, 0.3), boxShadow: `0 2cqw 5cqw -2cqw ${a}55` }}>
      <div className="flex items-center gap-[0.7cqw] border-b border-white/10 px-[1.4cqw] py-[0.9cqw]">
        {['#fb7185', '#fbbf24', '#34d399'].map((c) => <span key={c} className="rounded-full w-[0.9cqw] h-[0.9cqw] min-w-2 min-h-2" style={{ background: c }} />)}
        <span className="ml-auto font-mono uppercase tracking-[0.12em] text-white/50" style={size(1.05, 8)}>{scene.language || 'from the playbook'}</span>
      </div>
      <pre className="m-0 overflow-hidden font-mono leading-[1.55]" style={{ ...size(lines.length > 9 ? 1.3 : 1.55, 9), padding: '1.2cqw 1.4cqw' }}>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-[1.4cqw] transition-opacity duration-500" style={{ opacity: i < shown ? 1 : 0.12 }}>
            <span className="w-[2.4cqw] shrink-0 select-none text-right tabular-nums text-white/30">{i + 1}</span>
            <code className="whitespace-pre text-white/90" style={i === shown - 1 ? { color: '#fff', textShadow: `0 0 1.2cqw ${a}` } : undefined}>{line || ' '}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

export const LAYOUT_COMPONENTS = {
  checklist: ChecklistSlide,
  rule: RuleSlide,
  definition: DefinitionSlide,
  compare: CompareSlide,
  decision: DecisionSlide,
  table: TableSlide,
  timeline: TimelineSlide,
  code: CodeSlide,
};

