import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

// Editable options list; the selected radio marks the correct answer (by index).
export default function OptionsEditor({ options, correct, onChange }) {
  const setOption = (i, value) => onChange(options.map((o, j) => (j === i ? value : o)), correct);
  const remove = (i) => onChange(options.filter((_, j) => j !== i), correct === i ? -1 : correct > i ? correct - 1 : correct);
  return (
    <div className="space-y-2">
      <Label>Options (select the correct answer)</Label>
      <RadioGroup value={String(correct)} onValueChange={(v) => onChange(options, Number(v))} className="gap-2">
        {options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <RadioGroupItem value={String(i)} id={`opt-${i}`} aria-label={`Mark option ${i + 1} correct`} />
            <span className="text-sm font-medium w-4">{String.fromCharCode(65 + i)}</span>
            <Input value={option} onChange={(e) => setOption(i, e.target.value)} className="h-8 text-sm" />
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} disabled={options.length <= 2} aria-label="Remove option">
              <Trash2 />
            </Button>
          </div>
        ))}
      </RadioGroup>
      {options.length < 6 && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...options, ''], correct)}>
          <Plus /> Add option
        </Button>
      )}
    </div>
  );
}
