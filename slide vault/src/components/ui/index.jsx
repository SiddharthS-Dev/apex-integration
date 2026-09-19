import { forwardRef, createContext, useContext, useState, useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Small shadcn/ui-compatible primitive set.
 * Same API shape as the generated shadcn components, hand-rolled so the app has
 * no Radix runtime dependency.
 */

/* ----------------------------------------------------------------- Button */

const BUTTON_VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
  gradient:
    'bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white hover:opacity-90 shadow-lg shadow-violet-600/25',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-transparent hover:bg-secondary/60 text-foreground',
  ghost: 'hover:bg-secondary/60 text-foreground',
  glass: 'glass hover:bg-card/80 text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  link: 'text-primary underline-offset-4 hover:underline',
};

const BUTTON_SIZES = {
  default: 'h-10 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-12 px-6 text-base',
  icon: 'h-10 w-10',
  'icon-sm': 'h-8 w-8',
};

export const Button = forwardRef(function Button(
  { className, variant = 'default', size = 'default', asChild = false, type = 'button', ...props },
  ref
) {
  const Comp = asChild ? 'span' : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.default,
        BUTTON_SIZES[size] || BUTTON_SIZES.default,
        className
      )}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------- Card */

export const Card = forwardRef(function Card({ className, glass = true, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('rounded-2xl', glass ? 'glass' : 'bg-card border border-border', className)}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-lg font-semibold leading-tight tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center p-5 pt-0', className)} {...props} />;
}

/* ------------------------------------------------------------------ Input */

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 transition-shadow',
        className
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
        className
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-foreground/90', className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Badge */

const BADGE_VARIANTS = {
  default: 'bg-primary/15 text-primary ring-primary/25',
  secondary: 'bg-secondary text-secondary-foreground ring-border',
  outline: 'bg-transparent text-foreground ring-border',
  success: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
  danger: 'bg-red-500/15 text-red-400 ring-red-500/25',
};

export function Badge({ className, variant = 'default', ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        BADGE_VARIANTS[variant] || BADGE_VARIANTS.default,
        className
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- Tabs */

const TabsContext = createContext(null);

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }) {
  const [internal, setInternal] = useState(defaultValue);
  const active = value !== undefined ? value : internal;
  const setActive = (next) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ active, setActive, id: useId() }}>
      <div className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-1 rounded-xl glass p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ value, className, ...props }) {
  const ctx = useContext(TabsContext);
  const active = ctx?.active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx?.setActive(value)}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
        active
          ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow'
          : 'text-muted-foreground hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ value, className, ...props }) {
  const ctx = useContext(TabsContext);
  if (ctx?.active !== value) return null;
  return <div role="tabpanel" className={cn('mt-4', className)} {...props} />;
}

/* --------------------------------------------------------------- Progress */

export function Progress({ value = 0, className, barClassName }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className={cn('h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all', barClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------- Separator */

export function Separator({ className, orientation = 'horizontal' }) {
  return (
    <div
      role="separator"
      className={cn('bg-border', orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full', className)}
    />
  );
}

/* ------------------------------------------------------------------ Alert */

export function Alert({ className, variant = 'default', children }) {
  const variants = {
    default: 'border-border bg-card/60 text-foreground',
    danger: 'border-red-500/30 bg-red-500/10 text-red-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', variants[variant], className)}>{children}</div>
  );
}

/* ------------------------------------------------------------------ Switch */

export function Switch({ checked, onCheckedChange, className, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-secondary',
        className
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
