import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, currentTheme, onThemeChange } from '@/lib/theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => onThemeChange(setTheme), []);
  const dark = theme === 'dark';

  return (
    <Button variant="ghost" size="icon" onClick={() => applyTheme(dark ? 'light' : 'dark')} aria-label="Toggle dark mode">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
