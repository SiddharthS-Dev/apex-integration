import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SKILL_LABEL, SKILL_LEVELS, SORTS } from '@/lib/categories';

// Search, department, technology, skill level and sort for a playbook list. `value` holds
// { q, department, tech, skill, sort }; 'all' means no filter. `options` from filterOptions().
export const DEFAULT_FILTERS = { q: '', department: 'all', tech: 'all', skill: 'all', sort: 'updated' };

function Pick({ id, label, value, onChange, items, allLabel, className = 'sm:w-44' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className={`w-full ${className}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value="all">{allLabel}</SelectItem>}
        {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function PlaybookFilters({ value, onChange, options, idPrefix = 'pb' }) {
  const set = (key) => (v) => onChange({ ...value, [key]: v });
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={`${idPrefix}-search`}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search playbooks, files, tags…"
          className="pl-9"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Pick id={`${idPrefix}-dept`} label="Department" value={value.department} onChange={set('department')} allLabel="All departments"
          items={options.departments.map((d) => ({ value: d, label: d }))} />
        <Pick id={`${idPrefix}-tech`} label="Technology" value={value.tech} onChange={set('tech')} allLabel="All technologies"
          items={options.tech.map((t) => ({ value: t, label: t }))} />
        <Pick id={`${idPrefix}-skill`} label="Skill level" value={value.skill} onChange={set('skill')} allLabel="All levels" className="sm:w-36"
          items={SKILL_LEVELS.map((s) => ({ value: s, label: SKILL_LABEL[s] }))} />
        <Pick id={`${idPrefix}-sort`} label="Sort" value={value.sort} onChange={set('sort')} className="sm:w-44"
          items={SORTS.map((s) => ({ value: s.key, label: s.label }))} />
      </div>
    </div>
  );
}
