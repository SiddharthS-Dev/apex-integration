import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pkhub-theme';

function readTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode — the class is still applied for this session */
    }
  }, [theme]);

  const setTheme = useCallback((next) => setThemeState(next === 'light' ? 'light' : 'dark'), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
}

export default useTheme;
