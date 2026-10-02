import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function QuizQuestion({ question, value, onChange }) {
  const options = question.options || [];
  return (
    <div className="space-y-4">
      <p className="text-base font-medium leading-relaxed">{question.question_text}</p>
      <RadioGroup value={value ?? ''} onValueChange={onChange} className="gap-2.5">
        {options.map((opt, i) => {
          const id = `${question.id}-opt-${i}`;
          return (
            <Label
              key={id}
              htmlFor={id}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer font-normal leading-relaxed transition-colors',
                value === opt ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              )}
            >
              <RadioGroupItem value={opt} id={id} className="mt-0.5" />
              <span>{opt}</span>
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
