import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The FFmpeg video engine, run for real (no mocks): subtitles, the slide timeline, slide drawing,
// rendering an MP4 from real MP3 narration, scene-level reuse and the render usage log.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-video-'));
Object.assign(process.env, { DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error', AI_ENABLED: 'false', VIDEO_WIDTH: '640', VIDEO_HEIGHT: '360', VIDEO_FPS: '10' });

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { objectKey, putObject, getObject } = await import('../src/files/objectStore.js');
const { toSrt, toVtt, readableCues, wrapLines } = await import('../src/media/video/subtitleGenerator.js');
const { renderSlideSvg, wrap, itemCount } = await import('../src/media/video/slides.js');
const { renderVideo, sceneTimeline, renderingAvailable, validateManifest } = await import('../src/media/video/renderer.js');
const { runFfmpeg, mediaDuration } = await import('../src/media/video/ffmpeg.js');

async function tone(seconds, freq) {
  const file = path.join(dir, `tone-${freq}-${seconds}.mp3`);
  await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-ar', '44100', '-ac', '1', '-b:a', '64k', file]);
  const key = objectKey('test-audio', freq, seconds);
  await putObject(key, fs.readFileSync(file), { source: 'media', content_type: 'audio/mpeg' });
  return key;
}

before(async () => { await migrate(await getDb()); });
after(async () => {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('subtitles: SRT and VTT, wrapped to two lines of ≤ 42 characters, long cues split in time', () => {
  const long = 'Every engineer reviews the pull request checklist before asking for a review, then fixes what it finds, then asks again.';
  const cues = readableCues([{ start: 0, end: 6, text: long }]);
  assert.ok(cues.length >= 2);
  assert.ok(cues.every((c) => c.lines.length <= 2 && c.lines.every((l) => l.length <= 42)));
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1).end, 6);
  assert.equal(cues.flatMap((c) => c.lines).join(' '), long, 'no words lost');
  const srt = toSrt([{ start: 1.5, end: 3.25, text: 'Welcome to the lesson.' }]);
  assert.equal(srt, '1\n00:00:01,500 --> 00:00:03,250\nWelcome to the lesson.\n');
  assert.match(toVtt([{ start: 61, end: 62, text: 'One minute in.' }]), /^WEBVTT\n\n00:01:01\.000 --> 00:01:02\.000\nOne minute in\.\n$/);
  assert.deepEqual(wrapLines('a b c', 3), ['a b', 'c']);
});

test('timeline: items appear over the first 70% of the scene, captions change the picture, silence closes the mouth', () => {
  const scene = { layout: 'points', points: ['One', 'Two', 'Three'], captions: [{ start: 0, end: 2, text: 'First' }, { start: 2, end: 4, text: 'Second' }] };
  const segs = sceneTimeline(scene, 5);
  assert.equal(segs[0].from, 0);
  assert.equal(segs.at(-1).to, 5);
  assert.equal(segs.at(-1).shown, 3, 'every item is up before the scene ends');
  assert.equal(segs[0].shown, 1);
  assert.equal(segs.at(-1).speaking, false, 'no caption at the end: mouth closed');
  assert.ok(segs.some((s) => s.caption === 'Second' && s.speaking));
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].from, segs[i - 1].to, 'contiguous');
});

test('slides: every layout draws valid SVG with escaped text', async () => {
  const base = { title: 'Rules & <limits>', playbook: 'Ops Playbook', source: '3.2 Reviews' };
  const layouts = [
    { layout: 'points', points: ['A', 'B'] },
    { layout: 'steps', points: ['Plan', 'Build', 'Ship'] },
    { layout: 'checklist', points: ['Tests pass', 'Docs updated'] },
    { layout: 'table', table: { headers: ['Task', 'Owner', 'Due'], rows: [['Update RBAC', 'Vishnu', 'Oct 20']] }, points: ['x'] },
    { layout: 'rule', quote: 'Never deploy on Friday.', points: ['x'] },
    { layout: 'definition', term: 'SLO', definition: 'A target for reliability.', points: ['x'] },
    { layout: 'compare', columns: [{ label: 'Do', tone: 'do', items: ['Review'] }, { label: "Don't", tone: 'dont', items: ['Skip'] }], points: ['x'] },
    { layout: 'timeline', events: [{ label: 'Day 1', text: 'Plan' }, { label: 'Day 2', text: 'Build' }], points: ['x'] },
    { layout: 'decision', question: 'Is it urgent?', branches: [{ when: 'Yes', then: 'Page on-call' }, { when: 'No', then: 'Ticket' }], points: ['x'] },
    { layout: 'code', code: 'npm test\nnpm run build', points: ['x'] },
  ];
  const { Resvg } = (await import('node:module')).createRequire(import.meta.url)('@resvg/resvg-js');
  for (const l of layouts) {
    const svg = renderSlideSvg({ ...base, ...l }, 2, 5, { eyebrow: 'Course · Module', shown: itemCount({ ...base, ...l }), caption: 'Hello <there>', mouthOpen: true });
    assert.ok(svg.includes('Rules &amp; &lt;limits&gt;') && svg.includes('Hello &lt;there&gt;'), `${l.layout}: escaped`);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 320 } }).render().asPng();
    assert.ok(png.length > 1000, `${l.layout}: rasterises`);
  }
  assert.deepEqual(wrap('one two three four five six', 120, 20, 2).length, 2);
});

test('rendering: a real MP4 with narration, subtitles and a thumbnail; unchanged scenes are reused', { timeout: 300_000 }, async () => {
  assert.equal(renderingAvailable(), true, 'ffmpeg-static and resvg are installed');
  const a = await tone(2, 440);
  const b = await tone(3, 660);
  const scenes = [
    { title: 'Why we met', layout: 'rule', quote: 'Review the RBAC schema.', points: ['x'], text: 'We met to review.', captions: [{ start: 0, end: 1.8, text: 'We met to review.' }], audio: { key: a } },
    { title: 'Action items', layout: 'table', table: { headers: ['Task', 'Owner'], rows: [['Update RBAC', 'Vishnu'], ['Document APIs', 'Bhuvaneshwari']] }, points: ['x'], text: 'Vishnu updates RBAC.', captions: [{ start: 0, end: 2.5, text: 'Vishnu updates RBAC.' }], audio: { key: b } },
  ];
  const progress = [];
  const out = await renderVideo({ eyebrow: 'Meeting briefing', scenes }, { ref: { type: 'meeting', id: 'm1' }, onProgress: (p, m) => progress.push([p, m]) });
  assert.equal(out.scenes, 2);
  assert.equal(out.scenesRendered, 2);
  assert.ok(Math.abs(out.seconds - 5) < 0.4, `≈5 s of video, got ${out.seconds}`);
  for (const k of ['video', 'thumbnail', 'srt', 'vtt']) assert.match(out[k], /^\/api\/media\/[a-f0-9]{64}$/);
  const video = await getObject(out.video.slice('/api/media/'.length));
  const file = path.join(dir, 'check.mp4');
  fs.writeFileSync(file, video);
  assert.ok(Math.abs((await mediaDuration(file)) - out.seconds) < 0.05);
  const probe = await runFfmpeg(['-v', 'info', '-i', file, '-f', 'null', '-'], {}).catch((e) => e.message);
  assert.ok(typeof probe === 'string', 'the MP4 decodes end to end');
  const srt = (await getObject(out.srt.slice('/api/media/'.length))).toString();
  assert.match(srt, /00:00:02,\d{3} --> 00:00:04,\d{3}\nVishnu updates RBAC\./, 'scene 2 subtitles are offset by scene 1');
  assert.equal(progress.at(-1)[0], 100);

  // Change scene 2 only: scene 1 comes from the scene cache.
  scenes[1] = { ...scenes[1], title: 'Your action items' };
  const again = await renderVideo({ eyebrow: 'Meeting briefing', scenes }, { ref: { type: 'meeting', id: 'm1' } });
  assert.deepEqual([again.scenesReused, again.scenesRendered], [1, 1]);

  const rows = await db().query("SELECT status, seconds, provider FROM generation_log WHERE kind = 'render'");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'ok' && r.provider === 'ffmpeg' && r.seconds > 4));
});

test('invalid manifests are refused before any work', async () => {
  assert.deepEqual(validateManifest({ scenes: [] }), ['the video has no scenes']);
  assert.deepEqual(validateManifest({ scenes: [{ title: 'x' }] }), ['scene 1 has no narration audio']);
  await assert.rejects(renderVideo({ scenes: [{ title: 'x', audio: { key: 'f'.repeat(64) } }] }), /narration audio for this video is missing/);
});
