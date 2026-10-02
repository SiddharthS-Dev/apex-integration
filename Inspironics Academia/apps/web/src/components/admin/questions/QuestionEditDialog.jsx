import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SelectField from '@/components/admin/editor/SelectField';
import OptionsEditor from '@/components/admin/questions/OptionsEditor';
import { correctIndex } from '@/components/admin/questions/questionData';

const toForm = (q) => ({
  question_text: q?.question_text || '',
  options: q?.options?.length ? [...q.options] : ['', '', '', ''],
  correct: q ? correctIndex(q) : -1,
  explanation: q?.explanation || '',
  difficulty: q?.difficulty || 'basic',
  cognitive_level: q?.cognitive_level || 'recall',
});

export default function QuestionEditDialog({ question, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => toForm(question));
  useEffect(() => setForm(toForm(question)), [question]);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const options = form.options.map((o) => o.trim());
  const valid = form.question_text.trim() && options.every(Boolean) && form.correct >= 0 && form.correct < options.length;
  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onSave(question, {
      question_text: form.question_text.trim(),
      options,
      correct_answer: options[form.correct],
      explanation: form.explanation.trim(),
      difficulty: form.difficulty,
      cognitive_level: form.cognitive_level,
    });
  };

  return (
    <Dialog open={!!question} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit question</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="q-text">Question</Label>
            <Textarea id="q-text" rows={3} value={form.question_text} onChange={(e) => set('question_text')(e.target.value)} />
          </div>
          <OptionsEditor options={form.options} correct={form.correct} onChange={(opts, correct) => setForm((f) => ({ ...f, options: opts, correct }))} />
          <div className="space-y-1.5">
            <Label htmlFor="q-explanation">Explanation</Label>
            <Textarea id="q-explanation" rows={3} value={form.explanation} onChange={(e) => set('explanation')(e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <SelectField id="q-difficulty" label="Difficulty" value={form.difficulty} onChange={set('difficulty')} options={['basic', 'intermediate', 'advanced']} />
            <SelectField id="q-cognitive" label="Cognitive level" value={form.cognitive_level} onChange={set('cognitive_level')} options={['recall', 'understanding', 'application', 'analysis']} />
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!valid || saving}>
              {saving && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
