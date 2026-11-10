import { useState } from 'react';
import { Copy, Download, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { downloadText } from '@/lib/meetings';
import { useRefreshStudio } from '@/lib/studio';
import DropboxPicker from './DropboxPicker';
import { Choice, Field, Notice } from './StudioFields';

const LENGTHS = [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }];
const TONES = [
  { value: 'professional', label: 'Professional' }, { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' }, { value: 'conversational', label: 'Conversational (instructor)' },
];
const SOURCES = [{ value: 'text', label: 'Paste text' }, { value: 'lesson', label: 'A lesson (its playbook chapter)' }, { value: 'meeting', label: 'A meeting' }, { value: 'playbook', label: 'A playbook' }, { value: 'dropbox', label: 'A Dropbox file' }, { value: 'none', label: 'No source' }];

function QuestionList({ questions = [] }) {
  return (
    <ol className="space-y-3">
      {questions.map((q, i) => (
        <li key={`${q.question_text}-${i}`} className="rounded-xl border border-border bg-card p-3">
          <p className="font-medium">{i + 1}. {q.question_text}</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {(q.options || []).map((o) => <li key={o} className={`rounded-lg px-2 py-1 text-sm ${o === q.correct_answer ? 'bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-muted/50'}`}>{o}</li>)}
          </ul>
          {q.explanation && <p className="mt-2 text-xs text-muted-foreground">{q.explanation}</p>}
        </li>
      ))}
    </ol>
  );
}

// Generates lesson content, descriptions, objectives, summaries, assessments, question banks,
// meeting summaries and playbook extraction/structure — from pasted text or an existing record.
export default function ContentGenerator({ config }) {
  const refresh = useRefreshStudio();
  const types = config?.content_types || [];
  const providers = config?.ai?.providers || [];
  const [form, setForm] = useState({ content_type: 'lesson_summary', provider: '', language: 'English', length: 'medium', tone: 'professional', instructions: '', source: 'text', source_text: '', source_id: '', fresh: false });
  const [dbxFile, setDbxFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const generate = async () => {
    setBusy(true);
    try {
      const body = {
        content_type: form.content_type, provider: form.provider || undefined, language: form.language, length: form.length, tone: form.tone,
        instructions: form.instructions, fresh: form.fresh,
        ...(form.source === 'text' ? { source_text: form.source_text } : form.source === 'dropbox' ? { source: { type: 'dropbox', account: dbxFile?.account, id: dbxFile?.id } } : form.source !== 'none' ? { source: { type: form.source, id: form.source_id.trim() } } : {}),
      };
      setResult(await api.studio.generate(body));
    } catch (e) {
      toast.error(e?.message || 'Generation failed');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!config?.ai?.enabled) {
    return <Notice tone="warn">AI text generation is not configured on the server. Set AI_PROVIDER and its API key (see AI_PROVIDER_SETUP.md), then restart the API.</Notice>;
  }
  const text = result ? (result.format === 'json' ? JSON.stringify(result.output, null, 2) : String(result.output)) : '';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <Field label="Content type" htmlFor="cg-type"><Choice id="cg-type" value={form.content_type} onChange={set('content_type')} options={types.map((t) => ({ value: t.key, label: t.label }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="AI provider" htmlFor="cg-provider"><Choice id="cg-provider" value={form.provider} onChange={set('provider')} options={[{ value: '', label: `Server default (${config.ai.provider})` }, ...providers.map((p) => ({ value: p.name, label: `${p.name} · ${p.model}` }))]} /></Field>
          <Field label="Language" htmlFor="cg-lang"><Input id="cg-lang" value={form.language} onChange={set('language')} /></Field>
          <Field label="Length" htmlFor="cg-length"><Choice id="cg-length" value={form.length} onChange={set('length')} options={LENGTHS} /></Field>
          <Field label="Tone" htmlFor="cg-tone"><Choice id="cg-tone" value={form.tone} onChange={set('tone')} options={TONES} /></Field>
        </div>
        <Field label="Source" htmlFor="cg-source"><Choice id="cg-source" value={form.source} onChange={set('source')} options={SOURCES} /></Field>
        {form.source === 'text' && <Field label="Source text" htmlFor="cg-text" hint="The AI uses only the facts in this text."><Textarea id="cg-text" rows={7} value={form.source_text} onChange={set('source_text')} placeholder="Paste a playbook section, lesson notes or meeting notes…" /></Field>}
        {['lesson', 'meeting', 'playbook'].includes(form.source) && <Field label={`${form.source[0].toUpperCase()}${form.source.slice(1)} id`} htmlFor="cg-id" hint="Copy the id from the address bar of its page."><Input id="cg-id" value={form.source_id} onChange={set('source_id')} /></Field>}
        {form.source === 'dropbox' && <DropboxPicker value={dbxFile} onChange={setDbxFile} />}
        <Field label="Instructions" htmlFor="cg-instr"><Textarea id="cg-instr" rows={3} value={form.instructions} onChange={set('instructions')} placeholder="Anything to emphasise, the audience, what to leave out…" /></Field>
        <label className="flex items-center justify-between gap-3 text-sm"><span>Ask again even if the same request was answered before</span><Switch checked={form.fresh} onCheckedChange={set('fresh')} /></label>
        <Button onClick={generate} disabled={busy || (form.source === 'dropbox' && !dbxFile)} className="w-full">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'Generating…' : 'Generate'}</Button>
        <p className="text-xs text-muted-foreground">Each generation is one AI request. Identical requests are answered from the cache at no cost.</p>
      </div>

      <div className="min-w-0 space-y-3">
        {!result ? (
          <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">The generated content appears here.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{types.find((t) => t.key === result.content_type)?.label} · {result.provider} · {(result.ms / 1000).toFixed(1)} s</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(text); toast.success('Copied'); }}><Copy /> Copy</Button>
                <Button size="sm" variant="outline" onClick={() => downloadText(`${result.content_type}.${result.format === 'json' ? 'json' : 'md'}`, text, result.format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8')}><Download /> Download</Button>
              </span>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              {result.format === 'json' && result.output?.questions ? <QuestionList questions={result.output.questions} />
                : result.format === 'json' ? <pre className="overflow-x-auto whitespace-pre-wrap text-sm">{text}</pre>
                  : <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{text}</ReactMarkdown></div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
