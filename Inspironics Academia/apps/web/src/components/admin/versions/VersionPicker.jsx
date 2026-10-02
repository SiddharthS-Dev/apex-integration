import { format } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const describe = (v) => {
  let date = '';
  try { date = v.created_date ? format(new Date(v.created_date), 'MMM d, yyyy HH:mm') : ''; } catch { date = ''; }
  return `${v.version_label}${date ? ` · ${date}` : ''}`;
};

function VersionSelect({ id, label, value, onChange, versions }) {
  return (
    <div className="space-y-1.5 flex-1 min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue placeholder="Select version" /></SelectTrigger>
        <SelectContent>
          {versions.map((v) => <SelectItem key={v.id} value={v.id}>{describe(v)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function VersionPicker({ versions, oldId, newId, onOldChange, onNewChange }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-end gap-4">
      <VersionSelect id="old-version" label="Base version" value={oldId} onChange={onOldChange} versions={versions} />
      <ArrowRight className="hidden sm:block w-5 h-5 text-muted-foreground mb-2 shrink-0" />
      <VersionSelect id="new-version" label="Compare version" value={newId} onChange={onNewChange} versions={versions} />
    </div>
  );
}
