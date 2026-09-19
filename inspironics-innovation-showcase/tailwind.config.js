/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      opacity: {
        6: '0.06',
        8: '0.08',
        12: '0.12',
        15: '0.15',
        18: '0.18',
        22: '0.22',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
        88: '0.88',
        92: '0.92',
        94: '0.94',
        96: '0.96',
        97: '0.97',
      },
      colors: {
        ink: { DEFAULT: '#0A0A0C', deep: '#050816', panel: '#0E0E13' },
        cyan: { glow: '#00F0FF' },
        emerald: { glow: '#00FFB2' },
        chalk: '#F4F4F9',
        muted: '#A1A1AA',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 32px -6px rgba(0, 240, 255, 0.45)',
        'glow-em': '0 0 32px -6px rgba(0, 255, 178, 0.4)',
        lift: '0 24px 60px -24px rgba(0, 0, 0, 0.9)',
      },
      backgroundImage: {
        'radial-fade': 'radial-gradient(ellipse at center, rgba(255,255,255,0.9), transparent 70%)',
      },
      keyframes: {
        drift: { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '46px 46px' } },
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(0,240,255,0.55)' },
          '70%': { boxShadow: '0 0 0 18px rgba(0,240,255,0)' },
        },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        drift: 'drift 6s linear infinite',
        pulseGlow: 'pulseGlow 2.4s ease-out infinite',
        floaty: 'floaty 4s ease-in-out infinite',
        spinSlow: 'spinSlow 1.1s linear infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
    },
  },
  plugins: [],
}
