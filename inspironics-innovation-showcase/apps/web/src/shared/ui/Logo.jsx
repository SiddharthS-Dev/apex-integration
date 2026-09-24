export default function Logo({ size = 34, className = '', animated = true }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Inspironics"
    >
      <defs>
        <linearGradient id="insp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00F0FF" />
          <stop offset="100%" stopColor="#00FFB2" />
        </linearGradient>
      </defs>
      <path
        d="M32 6 56 20v24L32 58 8 44V20z"
        stroke="url(#insp-g)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="rgba(0,240,255,0.05)"
      />
      <path d="M32 6v20M32 38v20M8 20l24 12M56 20 32 32M8 44l24-12M56 44 32 32" stroke="#00F0FF" strokeWidth="0.9" opacity="0.35" />
      <circle cx="32" cy="32" r="6.4" fill="url(#insp-g)">
        {animated && <animate attributeName="r" values="6;7.2;6" dur="3s" repeatCount="indefinite" />}
      </circle>
      <circle cx="32" cy="6" r="2.2" fill="#00FFB2" />
      <circle cx="56" cy="20" r="2.2" fill="#00F0FF" />
      <circle cx="56" cy="44" r="2.2" fill="#00F0FF" />
      <circle cx="32" cy="58" r="2.2" fill="#00FFB2" />
      <circle cx="8" cy="44" r="2.2" fill="#00F0FF" />
      <circle cx="8" cy="20" r="2.2" fill="#00F0FF" />
    </svg>
  )
}
