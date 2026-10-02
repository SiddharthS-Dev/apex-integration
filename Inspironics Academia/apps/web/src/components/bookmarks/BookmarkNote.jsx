import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function BookmarkNote({ note, onSave, saving }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note || '');

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(note || ''); setEditing(true); }}
        className="group w-full text-left text-sm rounded-lg px-3 py-2 bg-muted/50 hover:bg-muted flex items-start gap-2"
      >
        <span className={note ? 'flex-1 whitespace-pre-wrap' : 'flex-1 text-muted-foreground italic'}>{note || 'Add a note…'}</span>
        <Pencil className="w-3.5 h-3.5 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  const save = async () => {
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      // error toast is shown by the caller; keep the editor open
    }
  };

  return (
    <div className="space-y-2">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus placeholder="Write a note for this lesson…" />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X /> Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving}><Check /> Save</Button>
      </div>
    </div>
  );
}
