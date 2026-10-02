import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// The OAuth redirect URI this server uses. Dropbox refuses Connect unless it is listed under
// "OAuth 2 → Redirect URIs" in the App Console exactly as shown — so show it, and make it easy to copy.
export default function DropboxRedirectUri({ uri }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy', { description: uri });
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-1.5">Redirect URI — register it in the Dropbox App Console, character for character</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{uri}</code>
        <Button size="sm" variant="outline" onClick={copy} aria-label="Copy redirect URI">
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
