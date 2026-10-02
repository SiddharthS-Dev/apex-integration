import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// Borderless text field that saves on blur (and Enter for single-line).
export default function EditableText({ value = '', onSave, placeholder, multiline, className }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value || ''), [value]);

  const commit = () => {
    const next = draft.trim();
    if (!multiline && !next) return setDraft(value || '');
    if (next !== (value || '')) onSave(next);
  };
  const shared = {
    value: draft,
    placeholder,
    onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    className: cn('border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-input px-2', className),
  };
  if (multiline) return <Textarea rows={2} {...shared} />;
  return (
    <Input
      {...shared}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value || '');
      }}
    />
  );
}
