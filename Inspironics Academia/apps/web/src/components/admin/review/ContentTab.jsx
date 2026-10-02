import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import useEntityUpdate from '@/components/admin/review/useEntityUpdate';

const FIELDS = [
  { key: 'teaching_objective', label: 'Teaching objective', rows: 2 },
  { key: 'teaching_script', label: 'Teaching script', rows: 12 },
  { key: 'summary', label: 'Summary', rows: 4 },
  { key: 'key_points', label: 'Key points (one per line)', rows: 5 },
  { key: 'examples', label: 'Examples', rows: 5 },
];

const pick = (lesson) => Object.fromEntries(['video_title', ...FIELDS.map((f) => f.key)].map((k) => [k, lesson[k] || '']));

// Mount with key={lesson.id} so the form resets when the selected lesson changes.
export default function ContentTab({ lesson }) {
  const [form, setForm] = useState(() => pick(lesson));
  const update = useEntityUpdate('Lesson', 'Lesson content saved');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="video_title">Video title</Label>
        <Input id="video_title" value={form.video_title} onChange={set('video_title')} />
      </div>
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={f.key}>{f.label}</Label>
          <Textarea id={f.key} rows={f.rows} value={form[f.key]} onChange={set(f.key)} />
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: lesson.id, data: form })}>
          {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </div>
  );
}
