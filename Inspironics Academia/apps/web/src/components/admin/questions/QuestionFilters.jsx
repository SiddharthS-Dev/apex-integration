import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUS = [['all', 'All statuses'], ['pending_review', 'Pending review'], ['approved', 'Approved'], ['rejected', 'Rejected']];
const DIFFICULTY = [['all', 'All difficulties'], ['basic', 'Basic'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

function FilterSelect({ value, onChange, options, className }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function QuestionFilters({ filters, onChange, courses }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });
  const courseOptions = [['all', 'All courses'], ...courses.map((c) => [c.id, `${c.title} (v${c.version || '1'})`])];
  return (
    <div className="flex flex-col lg:flex-row gap-3 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={filters.search} onChange={(e) => set('search')(e.target.value)} placeholder="Search question text…" className="pl-9" />
      </div>
      <FilterSelect value={filters.status} onChange={set('status')} options={STATUS} className="lg:w-44" />
      <FilterSelect value={filters.difficulty} onChange={set('difficulty')} options={DIFFICULTY} className="lg:w-44" />
      <FilterSelect value={filters.course} onChange={set('course')} options={courseOptions} className="lg:w-64" />
    </div>
  );
}
