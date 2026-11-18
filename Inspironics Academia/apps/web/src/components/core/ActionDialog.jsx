import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import FormError from '@/components/auth/FormError';
import { coreErrorText } from '@/lib/core';

// Controlled form dialog for Core actions. `onSubmit` returns a promise; on failure the dialog stays
// open and shows the server's reason (e.g. a 409 conflict or a refused self-grant), on success it closes.
// `validate` returns an error message (or '') before anything is sent.
export default function ActionDialog({
  open, onOpenChange, title, description, submitLabel = 'Confirm', destructive = false,
  onSubmit, validate, disabled = false, children,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = (next) => {
    if (busy) return;
    if (!next) setError('');
    onOpenChange(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate?.() || '';
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      await onSubmit();
      setBusy(false);
      onOpenChange(false);
    } catch (err) {
      setBusy(false);
      setError(coreErrorText(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div aria-live="assertive"><FormError message={error} /></div>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>
              {busy && <Loader2 className="animate-spin" />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
