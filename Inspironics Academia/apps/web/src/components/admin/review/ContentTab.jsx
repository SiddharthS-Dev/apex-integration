import { useState } from 'react';
import { AlertCircle, Loader2, Save } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

const LABELS = { video_title: 'video title', teaching_script: 'teaching script', summary: 'summary', key_points: 'key points', examples: 'examples' };

// Says why fields are empty instead of showing blank boxes: never generated, generating, or failed.
function GenerationNotice({ lesson }) {
  const missing = Object.keys(LABELS).filter((k) => !String(lesson[k] || '').trim());
  if (!missing.length) return null;
  const none = !String(lesson.teaching_script || '').trim();
  const text = lesson.status === 'generating'
    ? 'Content is being generated for this lesson — the fields fill in when it finishes.'
    : lesson.content_error
      ? `The last generation failed: ${lesson.content_error}`
      : none
        ? 'This lesson has not been generated yet. Use Generate content above, or Generate Learning Package to fill every lesson of the course.'
        : `Incomplete content — empty: ${missing.map((k) => LABELS[k]).join(', ')}. Regenerate content above, or Generate Learning Package, fills it.`;
  return (
    <Alert variant={lesson.content_error ? 'destructive' : 'default'}>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

const pick = (lesson) => Object.fromEntries(['video_title', ...FIELDS.map((f) => f.key)].map((k) => [k, lesson[k] || '']));

// Mount with key={lesson.id} so the form resets when the selected lesson changes.
export default function ContentTab({ lesson }) {
  const [form, setForm] = useState(() => pick(lesson));
  const update = useEntityUpdate('Lesson', 'Lesson content saved');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <GenerationNotice lesson={lesson} />
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
