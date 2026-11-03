import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AUDIENCES, COLORS, COLOR_KEYS, ICONS, ICON_KEYS, useCategories } from '@/lib/categories';

// Categories are records an admin manages: name, who it is for, description, colour and icon, and —
// the access rule — which audiences may see it. The API enforces that rule; built-in categories can be
// edited but not deleted, and deleting a custom one sends its playbooks back to Unclassified.

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const blank = (order) => ({ key: '', label: '', audience_label: '', description: '', audiences: ['employee', 'leadership'], color: 'sky', icon: 'book', order, built_in: false });

function Editor({ value, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const toggle = (a) => set('audiences')(value.audiences.includes(a) ? value.audiences.filter((x) => x !== a) : [...value.audiences, a]);
  const id = value.id || 'new';
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor={`c-label-${id}`}>Name</Label><Input id={`c-label-${id}`} value={value.label} onChange={(e) => set('label')(e.target.value)} placeholder="e.g. Sales Enablement" /></div>
        <div className="grid gap-1.5"><Label htmlFor={`c-aud-${id}`}>For</Label><Input id={`c-aud-${id}`} value={value.audience_label} onChange={(e) => set('audience_label')(e.target.value)} placeholder="e.g. Sales & Partners" /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor={`c-desc-${id}`}>Description</Label><Textarea id={`c-desc-${id}`} rows={2} value={value.description} onChange={(e) => set('description')(e.target.value)} /></div>
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Who can see it</legend>
        <div className="flex flex-wrap gap-4">
          {AUDIENCES.map((a) => (
            <label key={a.key} htmlFor={`c-${id}-${a.key}`} className="flex items-center gap-2 text-sm">
              <Checkbox id={`c-${id}-${a.key}`} checked={value.audiences.includes(a.key)} onCheckedChange={() => toggle(a.key)} />
              {a.label}
            </label>
          ))}
        </div>
        {value.audiences.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">No audience ticked: only administrators will see this category.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
          {COLOR_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={value.color === k} aria-label={k} onClick={() => set('color')(k)}
              className={cn('h-6 w-6 rounded-full bg-gradient-to-br', COLORS[k].gradient, value.color === k && 'ring-2 ring-offset-2 ring-foreground')} />
          ))}
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Icon">
          {ICON_KEYS.map((k) => {
            const Icon = ICONS[k];
            return (
              <button key={k} type="button" role="radio" aria-checked={value.icon === k} aria-label={k} onClick={() => set('icon')(k)}
                className={cn('grid h-8 w-8 place-items-center rounded-lg border', value.icon === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ManageCategoriesDialog({ open, onOpenChange, counts = {} }) {
  const queryClient = useQueryClient();
  const { categories, data } = useCategories();
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setRows(categories.map((c) => ({ ...c, audiences: c.audiences || [] }))); setAdding(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['playbook-categories'] });
    queryClient.invalidateQueries({ queryKey: ['playbooks'] });
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        if (!r.id) continue;
        await api.entities.PlaybookCategory.update(r.id, {
          label: r.label.trim() || r.key, audience_label: r.audience_label, description: r.description,
          audiences: r.audiences, color: r.color, icon: r.icon, order: r.order,
        });
      }
      if (adding?.label.trim()) {
        const key = slug(adding.key || adding.label);
        if (rows.some((r) => r.key === key)) throw new Error(`A category with the key “${key}” already exists`);
        await api.entities.PlaybookCategory.create({ ...adding, key, label: adding.label.trim() });
      }
      toast.success('Categories saved');
      refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message || 'Could not save categories');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    try {
      await api.entities.PlaybookCategory.delete(r.id);
      toast.success(`Deleted “${r.label}” — its playbooks moved to Unclassified`);
      refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not delete the category');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>Each playbook has one primary category. The audiences ticked here are the only learners who can open its playbooks and courses.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {rows.map((r, i) => (
            <section key={r.id || r.key} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{r.label || r.key} <span className="text-xs font-normal text-muted-foreground">· {counts[r.key] || 0} playbooks{r.built_in ? ' · standard' : ''}</span></h3>
                {!r.built_in && r.id && (
                  <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => remove(r)}><Trash2 /> Delete</Button>
                )}
              </div>
              <Editor value={r} onChange={(v) => setRows((list) => list.map((x, j) => (j === i ? v : x)))} />
            </section>
          ))}
          {adding ? (
            <section className="space-y-3 rounded-xl border border-dashed border-primary/40 p-4">
              <h3 className="font-semibold">New category</h3>
              <Editor value={adding} onChange={setAdding} />
            </section>
          ) : (
            <Button variant="outline" onClick={() => setAdding(blank(rows.length))}><Plus /> Add a category</Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={saveAll} disabled={saving}>Save categories</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
