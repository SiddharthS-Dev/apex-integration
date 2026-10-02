// generateLessonMedia — generate an explainer video clip and narration audio for a lesson.
//
// Payload: { lesson_id }   (admin only)
// Returns: { ok: true, lesson_id, video_url, audio_url, video_error?, audio_error? }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

const MAX_NARRATION_CHARS = 5000;
const ATTEMPTS = 2;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Integrations may expose the generated file under different keys. */
function pickUrl(res: any): string | null {
  if (!res) return null;
  if (typeof res === 'string') return /^https?:\/\//.test(res) ? res : null;
  const direct = res.url || res.video_url || res.audio_url || res.file_url;
  if (typeof direct === 'string' && direct) return direct;
  if (res.data && typeof res.data === 'object') return pickUrl(res.data);
  return null;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = ATTEMPTS): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.error(`${label} attempt ${i}/${attempts} failed:`, errMsg(e));
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Trim narration to the limit at a sentence boundary where possible. */
function narrationText(text: string): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_NARRATION_CHARS) return clean;
  const cut = clean.slice(0, MAX_NARRATION_CHARS);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return lastStop > MAX_NARRATION_CHARS * 0.6 ? cut.slice(0, lastStop + 1) : cut;
}

function buildVideoPrompt(lesson: any): string {
  const points = String(lesson.key_points || '')
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  return [
    `Educational explainer video for an engineering training lesson titled "${lesson.video_title || lesson.title}".`,
    lesson.teaching_objective ? `Learning goal: ${lesson.teaching_objective}.` : '',
    lesson.summary ? `Topic: ${String(lesson.summary).slice(0, 400)}` : '',
    points.length ? `Visualize these ideas: ${points.join('; ')}.` : '',
    `Style: clean modern motion graphics with animated diagrams, flowcharts, icons and system/architecture schematics that build up step by step.`,
    `Colour palette: deep indigo and violet gradients with white and soft lavender accents, dark indigo background, professional corporate-tech look.`,
    `Smooth camera moves and transitions, crisp vector shapes, subtle glow. No people talking, no on-screen paragraphs of text, no logos or watermarks.`,
    `Silent video — no audio, no music, no voice. 8 seconds, 16:9 landscape.`,
  ].filter(Boolean).join(' ');
}

Deno.serve(async (req) => {
  let base44: any;
  let lessonId: string | undefined;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    lessonId = body?.lesson_id;
    if (!lessonId) return Response.json({ error: 'lesson_id is required' }, { status: 400 });

    const sr = base44.asServiceRole.entities;
    const lesson = await sr.Lesson.get(lessonId);
    if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });

    await sr.Lesson.update(lessonId, { status: 'generating' });

    const core = base44.asServiceRole.integrations.Core;
    const videoPrompt = buildVideoPrompt(lesson);
    const narration = narrationText(lesson.teaching_script || lesson.summary || `${lesson.title}. ${lesson.teaching_objective || ''}`);

    const [videoRes, audioRes] = await Promise.allSettled([
      withRetry('GenerateVideo', async () => {
        const res = await core.GenerateVideo({ prompt: videoPrompt, duration: 8, aspect_ratio: '16:9' });
        const url = pickUrl(res);
        if (!url) throw new Error('GenerateVideo returned no URL');
        return url;
      }),
      withRetry('GenerateSpeech', async () => {
        if (!narration) throw new Error('Lesson has no script or summary to narrate');
        const res = await core.GenerateSpeech({ text: narration, voice: 'storm' });
        const url = pickUrl(res);
        if (!url) throw new Error('GenerateSpeech returned no URL');
        return url;
      }),
    ]);

    const videoUrl = videoRes.status === 'fulfilled' ? videoRes.value : null;
    const audioUrl = audioRes.status === 'fulfilled' ? audioRes.value : null;
    const videoError = videoRes.status === 'rejected' ? errMsg(videoRes.reason) : undefined;
    const audioError = audioRes.status === 'rejected' ? errMsg(audioRes.reason) : undefined;

    if (!videoUrl && !audioUrl) {
      await sr.Lesson.update(lessonId, { status: 'pending_review' });
      return Response.json(
        { error: `Media generation failed — video: ${videoError}; audio: ${audioError}`, video_error: videoError, audio_error: audioError },
        { status: 500 },
      );
    }

    const update: Record<string, unknown> = { status: 'pending_review' };
    if (videoUrl) update.video_url = videoUrl;
    if (audioUrl) update.audio_url = audioUrl;
    await sr.Lesson.update(lessonId, update);

    return Response.json({
      ok: true,
      lesson_id: lessonId,
      video_url: videoUrl || lesson.video_url || null,
      audio_url: audioUrl || lesson.audio_url || null,
      ...(videoError ? { video_error: videoError } : {}),
      ...(audioError ? { audio_error: audioError } : {}),
    });
  } catch (e) {
    const message = errMsg(e);
    console.error('generateLessonMedia failed:', message);
    if (base44 && lessonId) {
      try {
        await base44.asServiceRole.entities.Lesson.update(lessonId, { status: 'pending_review' });
      } catch (_) { /* ignore */ }
    }
    return Response.json({ error: message }, { status: 500 });
  }
});
