import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioLines, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { apiUrl } from '@/lib/mount';
import { useRefreshStudio } from '@/lib/studio';
import { Choice, Field, Notice } from './StudioFields';

// Text to speech with the configured providers: choose provider, language, voice and speed, listen,
// download. The same text and settings are reused from the audio cache instead of being paid again.
export default function VoiceStudio({ config }) {
  const refresh = useRefreshStudio();
  const defaults = config?.voice?.defaults || {};
  const providers = config?.voice?.providers || [];
  const [form, setForm] = useState({ text: '', provider: defaults.provider || providers[0] || '', language: defaults.language || 'en-US', voice: defaults.voice || '', rate: defaults.rate || 1 });
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const voices = useQuery({
    queryKey: ['studio-ai', 'voices', form.provider, form.language],
    queryFn: () => api.studio.voices(form.provider, form.language),
    enabled: !!form.provider,
    staleTime: 10 * 60_000,
  });

  if (!config?.voice?.enabled && !providers.length) {
    return <Notice tone="warn">No voice provider is configured. Set MEDIA_PROVIDER=google with Google Cloud Text-to-Speech credentials (see GOOGLE_TTS_SETUP.md), then restart the API.</Notice>;
  }

  const speak = async () => {
    setBusy(true);
    try {
      setClip(await api.studio.voice({ text: form.text, provider: form.provider, language: form.language, voice: form.voice || undefined, rate: Number(form.rate) }));
    } catch (e) {
      toast.error(e?.message || 'Could not generate the audio');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <Field label="Narration" htmlFor="vs-text" hint={`${form.text.length.toLocaleString()} / 5,000 characters`}>
          <Textarea id="vs-text" rows={10} maxLength={5000} value={form.text} onChange={set('text')} placeholder="Type or paste what the voice should say…" />
        </Field>
        <Button onClick={speak} disabled={busy || !form.text.trim()}>{busy ? <Loader2 className="animate-spin" /> : <AudioLines />} {busy ? 'Generating…' : 'Generate audio'}</Button>
        {clip && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <audio controls src={apiUrl(clip.url)} className="w-full" />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{clip.seconds.toFixed(1)} s · {clip.characters.toLocaleString()} characters</span>
              <span>{clip.cached ? 'Reused from the cache (no cost)' : 'Newly generated'}</span>
              <Button asChild size="sm" variant="outline" className="ml-auto"><a href={apiUrl(clip.url)} download="narration.mp3"><Download /> MP3</a></Button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <Field label="Provider" htmlFor="vs-provider"><Choice id="vs-provider" value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v, voice: '' }))} options={providers.map((p) => ({ value: p, label: p }))} /></Field>
        <Field label="Language" htmlFor="vs-lang" hint="e.g. en-IN, en-US, en-GB, hi-IN"><Input id="vs-lang" value={form.language} onChange={set('language')} /></Field>
        <Field label="Voice" htmlFor="vs-voice">
          <Choice id="vs-voice" value={form.voice} onChange={set('voice')} disabled={voices.isLoading}
            options={[{ value: '', label: voices.isLoading ? 'Loading voices…' : 'Provider default' }, ...(voices.data || []).slice(0, 200).map((v) => ({ value: v.id, label: `${v.name}${v.gender ? ` · ${v.gender.toLowerCase()}` : ''}` }))]} />
        </Field>
        {voices.error && <p className="text-xs text-rose-600">{voices.error.message}</p>}
        <Field label={`Speaking rate · ${Number(form.rate).toFixed(2)}×`} htmlFor="vs-rate">
          <Slider id="vs-rate" min={0.7} max={1.3} step={0.05} value={[Number(form.rate)]} onValueChange={([v]) => setForm((f) => ({ ...f, rate: v }))} />
        </Field>
      </div>
    </div>
  );
}
