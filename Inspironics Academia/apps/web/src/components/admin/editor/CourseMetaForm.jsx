import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SelectField from '@/components/admin/editor/SelectField';

const pick = (c) => ({
  title: c.title || '',
  description: c.description || '',
  difficulty: c.difficulty || 'beginner',
  access_level: c.access_level || 'free',
  status: c.status || 'draft',
});

export default function CourseMetaForm({ course, onSave, saving }) {
  const [form, setForm] = useState(() => pick(course));
  // Reset only when the stored record actually changes, not on every refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(pick(course)), [course.id, course.updated_date]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave({ ...form, title: form.title.trim(), published: form.status === 'published' });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="font-semibold">Course details</h2>
      <div className="space-y-1.5">
        <Label htmlFor="course-title">Title</Label>
        <Input id="course-title" value={form.title} onChange={(e) => set('title')(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="course-description">Description</Label>
        <Textarea id="course-description" rows={4} value={form.description} onChange={(e) => set('description')(e.target.value)} />
      </div>
      <SelectField id="course-difficulty" label="Difficulty" value={form.difficulty} onChange={set('difficulty')} options={['beginner', 'intermediate', 'advanced']} />
      <SelectField id="course-access" label="Access level" value={form.access_level} onChange={set('access_level')} options={['free', 'premium']} />
      <SelectField id="course-status" label="Status" value={form.status} onChange={set('status')} options={['draft', 'pending_review', 'published', 'archived']} />
      <Button type="submit" size="sm" disabled={saving} className="w-full">
        {saving ? <Loader2 className="animate-spin" /> : <Save />} Save details
      </Button>
    </form>
  );
}
