/**
 * Minimal markdown renderer for copilot messages.
 *
 * Supports exactly what the copilot emits: h3, bold, italic, inline code,
 * blockquotes, bullet lists, horizontal rules, links and image cards. Anything
 * else renders as plain text, and no HTML from the string is ever interpreted.
 */
const INLINE = /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g

/** Link schemes Markdown will render as an anchor. */
const SAFE_HREF = /^(https?:\/\/|#|\/)/i

function Inline({ text, onOpenImage }) {
  const parts = String(text).split(INLINE).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        let m
        if ((m = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(p))) {
          const [, alt, src, id] = m
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpenImage?.(id || alt)}
              className="my-2 block w-full overflow-hidden rounded-lg border border-white/12 transition hover:border-cyan-glow/50"
            >
              <img src={src} alt={alt} loading="lazy" className="h-32 w-full object-cover" />
            </button>
          )
        }
        if ((m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p))) {
          // Only http(s) and in-page anchors. Today this renders authored
          // copilot answers, but a javascript: or data: href would be live the
          // moment it is pointed at anything a visitor can type.
          if (!SAFE_HREF.test(m[2].trim())) return <span key={i}>{m[1]}</span>
          return (
            <a
              key={i}
              href={m[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-glow underline underline-offset-2"
            >
              {m[1]}
            </a>
          )
        }
        if ((m = /^\*\*([^*]+)\*\*$/.exec(p))) return <strong key={i} className="font-semibold text-chalk">{m[1]}</strong>
        if ((m = /^\*([^*]+)\*$/.exec(p))) return <em key={i} className="text-muted">{m[1]}</em>
        if ((m = /^`([^`]+)`$/.exec(p)))
          return (
            <code key={i} className="rounded bg-cyan-glow/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan-glow">
              {m[1]}
            </code>
          )
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

export default function Markdown({ text, onOpenImage }) {
  const lines = String(text || '').split('\n')
  const blocks = []
  let bullets = null

  const flush = () => {
    if (bullets) {
      blocks.push(
        <ul key={`ul${blocks.length}`} className="my-2 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-glow" />
              <span>
                <Inline text={b} onOpenImage={onOpenImage} />
              </span>
            </li>
          ))}
        </ul>
      )
      bullets = null
    }
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    if (/^-\s+/.test(line)) {
      bullets = bullets || []
      bullets.push(line.replace(/^-\s+/, ''))
      return
    }
    flush()
    if (!line.trim()) return
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={i} className="my-3 border-white/10" />)
    } else if (/^###\s+/.test(line)) {
      blocks.push(
        <h4 key={i} className="mb-1 mt-3 text-sm font-bold text-chalk first:mt-0">
          <Inline text={line.replace(/^###\s+/, '')} onOpenImage={onOpenImage} />
        </h4>
      )
    } else if (/^>\s?/.test(line)) {
      blocks.push(
        <blockquote key={i} className="my-2 border-l-2 border-cyan-glow/50 pl-3 text-[12.5px] italic text-muted">
          <Inline text={line.replace(/^>\s?/, '')} onOpenImage={onOpenImage} />
        </blockquote>
      )
    } else {
      blocks.push(
        <p key={i} className="my-1.5 leading-relaxed">
          <Inline text={line} onOpenImage={onOpenImage} />
        </p>
      )
    }
  })
  flush()

  return <div className="text-[13px] text-muted">{blocks}</div>
}
