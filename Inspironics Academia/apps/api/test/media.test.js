import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_ENABLED = 'false';
process.env.BASE44_APP_ID = 'app-media-test';
process.env.BASE44_SERVER_URL = 'http://127.0.0.1:9';

const { buildVideoPrompt, narrationText } = await import('../src/pipeline/generateLessonMedia.js');
const base44Media = (await import('../src/media/providers/base44.js')).default;

const lesson = {
  title: 'Introduction to the Octagonal Engine',
  video_title: 'The Octagonal Engine at a Glance',
  source_section: '1.1 How Volume I fits the IEEE 15288 lifecycle',
  teaching_objective: 'Explain how the eight engine layers hand work to each other',
  key_points: '- Eight cognitive layers\n- Each layer publishes events to the next\n3. The serving plane sits on top',
};

test('fallback video prompt is built from the lesson itself', () => {
  const p = buildVideoPrompt(lesson);
  assert.match(p, /The Octagonal Engine at a Glance/);
  assert.match(p, /IEEE 15288 lifecycle/);
  assert.match(p, /Eight cognitive layers; Each layer publishes events to the next; The serving plane sits on top/);
  assert.match(p, /Absolutely no text of any kind/);
  assert.match(p, /nothing unrelated to the lesson topic/);
});

test('narration keeps the whole script when short and cuts at a sentence when long', () => {
  assert.equal(narrationText('  One.   Two.  '), 'One. Two.');
  const long = `${'This sentence teaches one idea. '.repeat(200)}`;
  const out = narrationText(long);
  assert.ok(out.length <= 5000);
  assert.ok(out.endsWith('.'));
});

test('base44 media provider is enabled by the app id and refuses non-Base44 media URLs', async () => {
  assert.equal(base44Media.enabled, true);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/integration-endpoints/Core/GenerateVideo')) {
      return new Response(JSON.stringify({ url: 'https://evil.example.com/clip.mp4' }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await assert.rejects(base44Media.generateVideo({ prompt: 'x', durationSeconds: 8, aspectRatio: '16:9' }), /no media URL/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('base44 media provider downloads the returned file into bytes', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/integration-endpoints/Core/GenerateSpeech')) {
      return new Response(JSON.stringify({ url: 'https://media.base44.com/files/public/app/speech.mp3' }), { status: 200 });
    }
    if (String(url) === 'https://media.base44.com/files/public/app/speech.mp3') {
      return new Response(Buffer.from('ID3fake-mp3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const out = await base44Media.generateNarration({ text: 'Hello', voice: 'storm' });
    assert.equal(out.contentType, 'audio/mpeg');
    assert.equal(out.bytes.toString(), 'ID3fake-mp3');
  } finally {
    globalThis.fetch = realFetch;
  }
});

const { splitNarration, sceneCount, fallbackTitle } = await import('../src/pipeline/generateLessonMedia.js');
const { mp3Frames, concatMp3 } = await import('../src/media/mp3.js');

test('narration splits into similar-sized parts only at sentence ends', () => {
  const script = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} explains one idea clearly.`).join(' ');
  const parts = splitNarration(script, 4);
  assert.equal(parts.length, 4);
  assert.equal(parts.join(' '), script); // nothing lost or reordered
  for (const p of parts) assert.match(p, /\.$/);
  const sizes = parts.map((p) => p.length);
  assert.ok(Math.max(...sizes) < Math.min(...sizes) * 2);
  assert.deepEqual(splitNarration('Only one sentence here.', 5), ['Only one sentence here.']);
});

test('scene count follows script length within the configured maximum', () => {
  assert.equal(sceneCount('x'.repeat(100), 8), 1);
  assert.equal(sceneCount('x'.repeat(3000), 8), 5);
  assert.equal(sceneCount('x'.repeat(5000), 8), 8);
  assert.equal(sceneCount('x'.repeat(5000), 4), 4);
  assert.equal(fallbackTitle('The requirements cascade flows from MRS to PRS.', 0), 'The requirements cascade flows from MRS');
});

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo: 417-byte frames of 1152 samples.
function fakeMp3(frames, { id3 = true, xing = false } = {}) {
  const frame = () => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00; return f; };
  const list = Array.from({ length: frames }, frame);
  if (xing) {
    const info = frame();
    info.write('Xing', 4 + 32, 'latin1'); // after the header and stereo side info
    list.unshift(info);
  }
  const tag = id3 ? Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)]) : Buffer.alloc(0);
  return Buffer.concat([tag, ...list]);
}

test('mp3 frames: exact duration, tags and Xing header dropped', () => {
  const one = mp3Frames(fakeMp3(100, { xing: true }));
  assert.equal(one.bytes.length, 100 * 417);
  assert.ok(Math.abs(one.seconds - (100 * 1152) / 44100) < 1e-9);
});

test('mp3 concat reports where each part starts and ends', () => {
  const { bytes, seconds, spans } = concatMp3([fakeMp3(10), fakeMp3(20, { xing: true }), fakeMp3(5)]);
  const f = 1152 / 44100;
  assert.equal(bytes.length, 35 * 417);
  assert.ok(Math.abs(seconds - 35 * f) < 1e-9);
  assert.ok(Math.abs(spans[1].start - 10 * f) < 1e-9 && Math.abs(spans[1].end - 30 * f) < 1e-9);
  assert.ok(Math.abs(spans[2].end - seconds) < 1e-9);
});

const { buildCaptions, fallbackPoints } = await import('../src/pipeline/generateLessonMedia.js');

test('captions cover the part exactly, in order, without losing a word', () => {
  const part = 'The playbook sets one standard for every team. It replaces personal shortcuts, local conventions and undocumented workarounds with a single, reviewed process that everyone follows. Changes go through a formal proposal.';
  const cues = buildCaptions(part, 12, 42);
  assert.equal(cues[0].start, 12);
  assert.equal(cues.at(-1).end, 42);
  for (let i = 1; i < cues.length; i++) assert.equal(cues[i].start, cues[i - 1].end);
  for (const c of cues) assert.ok(c.text.length <= 84 && c.end > c.start, c.text);
  assert.equal(cues.map((c) => c.text).join(' '), part);
  assert.deepEqual(buildCaptions('', 0, 10), []);
});

test('fallback slide points are the part\'s own sentences, trimmed', () => {
  const pts = fallbackPoints('One standard for all teams. No personal shortcuts! Changes need a proposal. A fourth idea.');
  assert.deepEqual(pts, ['One standard for all teams', 'No personal shortcuts', 'Changes need a proposal']);
  const long = fallbackPoints(`${'word '.repeat(60)}end.`)[0];
  assert.ok(long.length <= 111 && long.endsWith('…'));
});
