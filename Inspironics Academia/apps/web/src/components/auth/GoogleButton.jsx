import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AuthDivider from '@/components/auth/AuthDivider';
import useAppConfig from '@/lib/useAppConfig';
import { apiUrl } from '@/lib/mount';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

// Rendered only when the server advertises Google sign-in (config.google_enabled).
export default function GoogleButton({ label = 'Continue with Google' }) {
  const { google_enabled: enabled } = useAppConfig();
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  const onClick = () => {
    setBusy(true);
    window.location.href = apiUrl('/api/auth/google/start');
  };
  return (
    <>
      <AuthDivider />
      <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <GoogleMark />} {label}
      </Button>
    </>
  );
}
