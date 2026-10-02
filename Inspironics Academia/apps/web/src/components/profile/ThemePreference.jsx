import { useEffect, useState } from 'react';
import { Moon, Palette, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyTheme, currentTheme, onThemeChange } from '@/lib/theme';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export default function ThemePreference() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => onThemeChange(setTheme), []);
  const index = OPTIONS.findIndex((o) => o.value === theme);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold flex items-center gap-2"><Palette className="w-4 h-4 text-primary" /> Theme</h3>
      <p className="text-sm text-muted-foreground mt-1">Choose how Inspironics Learn looks on this device.</p>
      <div role="radiogroup" aria-label="Theme" className="relative mt-4 grid grid-cols-2 rounded-full border border-border bg-muted/60 p-1">
        {/* Sliding highlight: moves to the chosen option instead of snapping. */}
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-background shadow-md ring-1 ring-border transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:bg-primary/20 dark:ring-primary/40 dark:shadow-[0_0_18px_-4px_hsl(var(--primary))]"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => theme !== value && applyTheme(value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-colors duration-300',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              theme === value ? 'text-foreground dark:text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
