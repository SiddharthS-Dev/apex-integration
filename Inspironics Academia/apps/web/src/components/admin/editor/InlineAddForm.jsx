import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Single-field "add item" form used for modules and lessons.
export default function InlineAddForm({ placeholder, buttonLabel = 'Add', onAdd, pending }) {
  const [value, setValue] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const title = value.trim();
    if (!title) return;
    onAdd(title);
    setValue('');
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !value.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} {buttonLabel}
      </Button>
    </form>
  );
}
