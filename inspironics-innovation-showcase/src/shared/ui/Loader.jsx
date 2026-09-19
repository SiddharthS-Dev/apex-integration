import Logo from './Logo'

/** Full-screen dark loader with a spinning cyan ring. */
export default function Loader({ label = 'Loading' }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-ink">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 animate-spinSlow rounded-full border-2 border-white/8 border-t-cyan-glow" />
        <div
          className="absolute inset-3 animate-spinSlow rounded-full border-2 border-white/5 border-b-emerald-glow"
          style={{ animationDirection: 'reverse', animationDuration: '1.7s' }}
        />
        <Logo size={38} />
      </div>
      <p className="eyebrow animate-pulse">{label}</p>
    </div>
  )
}
