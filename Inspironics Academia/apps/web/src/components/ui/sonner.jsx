import { Toaster as Sonner } from 'sonner';

function Toaster(props) {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  // Below the sticky 64px header rather than over it, so toasts never hide its buttons.
  return <Sonner theme={dark ? 'dark' : 'light'} richColors closeButton position="top-right" className="!top-[76px]" {...props} />;
}

export { Toaster };
