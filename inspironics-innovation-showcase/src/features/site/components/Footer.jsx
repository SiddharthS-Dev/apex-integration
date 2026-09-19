import { Link } from 'react-router-dom'
import Logo from '#shared/ui/Logo'

export default function Footer({ cats, techs, onRoute }) {
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <footer className="relative z-10 border-t border-white/8 bg-[#06060a]/80 backdrop-blur-xl">
      <div className="mx-auto max-w-[1600px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-3">
              <Logo size={30} animated={false} />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-chalk">Inspironics</span>
            </div>
            <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-muted">
              Intelligent infrastructure for buildings, plants, campuses and cities — sensing, connectivity, digital twins
              and agentic decisioning, designed as one stack.
            </p>
          </div>

          <FooterCol title="Explore">
            {/** @type {[string, () => void][]} */ ([
              ['Ecosystem', () => go('ecosystem')],
              ['Gallery', () => go('gallery')],
              ['Spotlight', () => go('spotlight')],
              ['About', () => go('about')],
              ['Contact', () => go('contact')],
            ]).map(([label, fn]) => (
              <button
                key={label}
                onClick={fn}
                className="block text-left text-[13px] text-muted transition hover:text-cyan-glow"
              >
                {label}
              </button>
            ))}
            <Link to="/report" className="block text-[13px] text-muted transition hover:text-cyan-glow">
              Monthly Report
            </Link>
          </FooterCol>

          <FooterCol title="Categories">
            {cats.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  onRoute?.({ type: 'cat', value: c.name }, { name: c.name })
                  go('gallery')
                }}
                className="block text-left text-[13px] text-muted transition hover:text-cyan-glow"
              >
                {c.name} <span className="font-mono text-[11px] text-muted/50">{c.count}</span>
              </button>
            ))}
          </FooterCol>

          <FooterCol title="Tech domains">
            {techs.map((t) => (
              <button
                key={t}
                onClick={() => {
                  onRoute?.({ type: 'tech', value: t }, { name: t })
                  go('gallery')
                }}
                className="block text-left text-[13px] text-muted transition hover:text-cyan-glow"
              >
                {t}
              </button>
            ))}
          </FooterCol>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/8 pt-7">
          <p className="font-mono text-[11px] text-muted/70">
            © {new Date().getFullYear()} Inspironics. All rights reserved.
          </p>
          <a href="mailto:hello@inspironics.net" className="font-mono text-[11px] text-muted/70 transition hover:text-cyan-glow">
            hello@inspironics.net
          </a>
          <div className="ml-auto flex gap-6">
            <span className="font-mono text-[11px] text-muted/50">Privacy</span>
            <span className="font-mono text-[11px] text-muted/50">Legal</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

const FooterCol = ({ title, children }) => (
  <div>
    <p className="label-mono">{title}</p>
    <div className="mt-4 space-y-2.5">{children}</div>
  </div>
)
