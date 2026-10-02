import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Field({ id, label, hint, aside, ...inputProps }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      <Input id={id} {...inputProps} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
