import { Toaster as Sonner } from 'sonner';

function Toaster(props) {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return <Sonner theme={dark ? 'dark' : 'light'} richColors closeButton position="top-right" {...props} />;
}

export { Toaster };
