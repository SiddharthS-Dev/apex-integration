// Theme state shared by the header toggle and the profile preference. Uses the same `theme`
// localStorage key main.jsx reads on boot.
const EVENT = 'themechange';

export const currentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function applyTheme(value) {
  const root = document.documentElement;
  // Fade the whole palette for a moment instead of snapping (skipped for reduced motion).
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 350);
  }
  root.classList.toggle('dark', value === 'dark');
  try {
    localStorage.setItem('theme', value);
  } catch {
    // storage unavailable — theme applies for this session only
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

export function onThemeChange(fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
