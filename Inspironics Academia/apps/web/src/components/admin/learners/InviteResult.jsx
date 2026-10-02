import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';

export default function InviteResult({ result, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.password || '');
      setCopied(true);
      toast.success('Temporary password copied');
    } catch {
      toast.error('Copy failed — select the password and copy it manually');
    }
  };
  return (
    <div className="space-y-4">
      <div className="text-sm">Email: <span className="font-medium">{result.email}</span></div>
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Temporary password</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm select-all break-all">{result.password || '—'}</code>
          <Button type="button" size="icon" variant="outline" onClick={copy} title="Copy password">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
      <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        <AlertTriangle className="w-4 h-4" />
        <AlertDescription>This password is shown only once. Copy it now — ask the user to change it after signing in.</AlertDescription>
      </Alert>
      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}
