import { useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export default function BookmarkNotePopover({ note = '', onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(note);
  useEffect(() => { if (open) setValue(note || ''); }, [open, note]);

  const save = async () => {
    await onSave(value.trim());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label="Bookmark note" className={cn(note && 'text-primary')}>
          <StickyNote />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="space-y-3">
        <p className="text-sm font-medium">Bookmark note</p>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Why is this lesson worth revisiting?" rows={4} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>Save note</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
