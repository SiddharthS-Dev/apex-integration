import { Info } from 'lucide-react';

const VARS = [
  ['DROPBOX_APP_KEY', 'App key from the Dropbox App Console'],
  ['DROPBOX_APP_SECRET', 'App secret from the Dropbox App Console'],
  ['TOKEN_ENCRYPTION_KEY', '32 random bytes, base64 or hex (openssl rand -base64 32)'],
  ['DROPBOX_REDIRECT_URI', 'e.g. https://your-host/api/dropbox/oauth/callback — must match the App Console exactly'],
];

export default function DropboxNotConfigured({ message }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>{message || 'Dropbox is not configured on the API server.'} Set these environment variables and restart the API:</p>
      </div>
      <ul className="space-y-1.5">
        {VARS.map(([name, hint]) => (
          <li key={name} className="text-sm">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{name}</code>
            <span className="text-muted-foreground"> — {hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
