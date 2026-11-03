import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/categories/TagInput';
import { SKILL_LABEL, SKILL_LEVELS, UNCLASSIFIED, categoryKey, useCategories } from '@/lib/categories';

// Classifies playbooks. One playbook: category, department, technologies, skill level and secondary
// tags (Playbook.update — the API marks the category as set by an admin and copies it to the
// playbook's courses). Several (`bulk`): moves them all to a category, optionally setting department
// and skill level too (classifyPlaybooks). Nothing about the document itself changes.

const KEEP = '__keep__';

export default function ClassifyDialog({ target, onOpenChange, suggestions = { departments: [], tech: [] } }) {
  const queryClient = useQueryClient();
  const { categories } = useCategories();
  const bulk = target?.bulk || null;
  const one = bulk ? null : target;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm(bulk
      ? { category: categories[0]?.key || 'corporate', department: '', skill_level: KEEP }
      : {
        category: categoryKey(one),
        department: one.department || '',
        tech_tags: one.tech_tags || [],
        skill_level: one.skill_level || 'none',
        tags: one.tags || [],
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target || !form) return null;
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (bulk) {
        const payload = { playbook_ids: bulk.map((p) => p.id), category: form.category };
        if (form.department.trim()) payload.department = form.department.trim();
        if (form.skill_level !== KEEP) payload.skill_level = form.skill_level === 'none' ? '' : form.skill_level;
        const { data } = await api.functions.invoke('classifyPlaybooks', payload);
        toast.success(`Moved ${data?.updated ?? bulk.length} playbook${bulk.length === 1 ? '' : 's'}`);
      } else {
        await api.entities.Playbook.update(one.id, {
          category: form.category,
          department: form.department.trim(),
          tech_tags: form.tech_tags,
          skill_level: form.skill_level === 'none' ? '' : form.skill_level,
          tags: form.tags,
        });
        toast.success(`Classified “${one.title}”`);
      }
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      queryClient.invalidateQueries({ queryKey: ['hub-courses'] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message || 'Could not save the classification');
    } finally {
      setSaving(false);
    }
  };

  const options = [...categories.map((c) => ({ key: c.key, label: c.label, hint: c.audience_label })), { key: UNCLASSIFIED, label: 'Unclassified', hint: 'awaiting review' }];

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bulk ? `Move ${bulk.length} playbook${bulk.length === 1 ? '' : 's'}` : 'Classify playbook'}</DialogTitle>
          <DialogDescription className="break-words">
            {bulk ? `Every playbook in “${target.label}”.` : one.title} The document, its chapters, versions and Dropbox file are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cl-category">Primary category</Label>
            <Select value={form.category} onValueChange={set('category')}>
              <SelectTrigger id="cl-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}{o.hint ? ` — ${o.hint}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-dept">Department{bulk && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
              <Input id="cl-dept" list="cl-dept-list" value={form.department} onChange={(e) => set('department')(e.target.value)} placeholder="e.g. Engineering" />
              <datalist id="cl-dept-list">{suggestions.departments.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-skill">Skill level</Label>
              <Select value={form.skill_level} onValueChange={set('skill_level')}>
                <SelectTrigger id="cl-skill"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {bulk && <SelectItem value={KEEP}>Leave as is</SelectItem>}
                  <SelectItem value="none">Not set</SelectItem>
                  {SKILL_LEVELS.map((s) => <SelectItem key={s} value={s}>{SKILL_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!bulk && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-tech">Technologies</Label>
                <TagInput id="cl-tech" value={form.tech_tags} onChange={set('tech_tags')} placeholder="Type and press Enter, e.g. Python" suggestions={suggestions.tech} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-tags">Secondary tags</Label>
                <TagInput id="cl-tags" value={form.tags} onChange={set('tags')} placeholder="e.g. onboarding, compliance" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{bulk ? 'Move playbooks' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
