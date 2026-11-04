import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The meeting video briefing: the AI writes a teacher-style deck from the meeting notes, every open
// action item is guaranteed to be in it, each scene is voiced (Base44 GenerateSpeech) and the parts
// are joined into one narration track with slides and subtitles timed to it. Base44 is a local fake.

const fakeMp3 = (frames) => Buffer.concat(Array.from({ length: frames }, () => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; return f; }));

const behaviour = { deck: 'full', speechFails: false };
const prompts = [];
const spoken = [];

function deck() {
  if (behaviour.deck === 'junk') return { scenes: [{ title: 'x', narration: 'too short' }] };
  const scenes = [
    { title: 'Welcome', layout: 'points', points: ['HMS team', 'October 15, 2026'], source: 'Briefing', narration: 'Hello HMS team. This is your briefing on the review meeting held on October 15, 2026.' },
    { title: 'Why we met', layout: 'rule', quote: 'Review the HMS backend and RBAC schema.', points: ['Review progress'], source: 'Purpose', narration: 'We met to review the HMS backend progress and agree on the role-based access control schema.' },
    { title: 'Action items', layout: 'table', table: { headers: ['Task', 'Owner', 'Due'], rows: [['Update the RBAC schema', 'Vishnu RD', 'Oct 20'], ['bad row']] }, points: ['Vishnu: RBAC schema'], source: 'Action items', narration: 'Vishnu, you will update the user roles and the RBAC schema by October 20.' },
    { title: 'Wrap-up', layout: 'not-a-layout', points: [], source: 'Wrap-up', narration: 'Thanks everyone. Check your action items and keep their status up to date.' },
  ];
  return { scenes };
}

const base44 = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url.endsWith('/InvokeLLM')) { prompts.push(body.prompt); return send(200, deck()); }
    if (req.url.endsWith('/GenerateSpeech')) {
      if (behaviour.speechFails) return send(500, { message: 'speech engine down' });
      spoken.push(body.text);
      return send(200, { url: `https://media.base44.com/speech-${spoken.length}.mp3` });
    }
    return send(404, {});
  });
});
await new Promise((r) => base44.listen(0, '127.0.0.1', r));

// Base44 answers with a public media URL; the provider downloads it.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url).startsWith('https://media.base44.com/')
  ? new Response(fakeMp3(40), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  : realFetch(url, init));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-meeting-video-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  AI_ENABLED: 'true', AI_PROVIDER: 'base44', MEDIA_PROVIDER: 'base44', BASE44_APP_ID: 'app-test', BASE44_EMAIL: '', BASE44_PASSWORD: '',
  BASE44_SERVER_URL: `http://127.0.0.1:${base44.address().port}/`,
});

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { entities } = await import('../src/repo/entities.js');
const { createApp } = await import('../src/app.js');
const mv = await import('../src/pipeline/generateMeetingVideo.js');
const generateMeetingVideo = mv.default;

let server;
let base;
let cookie = '';
const call = async (method, url, body) => {
  const res = await realFetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf.toString();
  try { data = JSON.parse(data); } catch { /* binary */ }
  return { status: res.status, data, buf };
};

const NOTES = {
  title: 'HMS - Review update',
  team: 'HMS',
  meeting_date: '2026-10-15',
  duration_minutes: 73,
  status: 'needs_review',
  participants: ['Kumar Aravamudhan', 'Vishnu RD', 'Siva Subramanian N', 'Siddharth S', 'Bhuvaneshwari S'],
  purpose: 'To review the HMS backend and front-end progress and align on the RBAC schema.',
  summary: 'Kumar facilitated a review of the HMS project. The team agreed BSS services use OSS REST endpoints. RBAC is a priority. The calendar feature is on hold.',
  themes: [{ title: 'Empowered leadership', detail: 'Teams review work internally first.' }, { title: 'Architectural isolation', detail: 'No direct database access across services.' }],
  decisions: [{ decision: 'BSS services call OSS only through REST endpoints', rationale: 'it keeps the systems isolated' }],
  requirements: [{ text: 'All services follow a secure standard protocol', priority: 'high' }],
  risks: [{ risk: 'Over-reliance on AI for documentation', mitigation: 'review documents by hand' }],
  open_questions: [{ question: 'When does calendar work resume?', owner: 'Kumar' }],
};

let meeting;
before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123' });
  meeting = await entities.Meeting.create(NOTES);
  await entities.ActionItem.bulkCreate([
    { meeting_id: meeting.id, task: 'Update the RBAC schema and user roles', owner_name: 'Vishnu RD', due_date: '2026-10-20', priority: 'high', status: 'open' },
    { meeting_id: meeting.id, task: 'Document the OSS REST endpoints for BSS', owner_name: 'Bhuvaneshwari S', due_text: 'next sprint', priority: 'medium', status: 'in_progress' },
    { meeting_id: meeting.id, task: 'Close the old calendar tickets', owner_name: 'Siddharth S', priority: 'low', status: 'done' },
  ]);
});

after(async () => {
  globalThis.fetch = realFetch;
  base44.close();
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('notes-based briefing: welcome, purpose, discussion, decisions, requirements, every open action item, risks, wrap-up', async () => {
  const items = await entities.ActionItem.filter({ meeting_id: meeting.id });
  const scenes = mv.briefingFromNotes(NOTES, mv.orderItems(items));
  assert.deepEqual(scenes.map((s) => s.title), ['HMS - Review update', 'Why we met', 'What we discussed', 'What we decided', 'What is required', 'Action items', 'Watch out for', 'Your next steps']);
  const actions = scenes.find((s) => s.title === 'Action items');
  assert.deepEqual(actions.table.rows.map((r) => r[1]), ['Vishnu RD', 'Bhuvaneshwari S'], 'open items only, most urgent first');
  assert.match(actions.narration, /Vishnu RD, you need to update the RBAC schema and user roles, by October 20, 2026\. This one is high priority\./);
  assert.match(actions.narration, /Bhuvaneshwari S, you need to document the OSS REST endpoints for BSS, next sprint\./);
  assert.ok(!scenes.some((s) => s.narration.includes('calendar tickets')), 'done items are left out');
  assert.match(scenes[0].narration, /Kumar Aravamudhan, Vishnu RD, Siva Subramanian N, Siddharth S and Bhuvaneshwari S took part/);
  assert.equal(scenes.find((s) => s.title === 'Watch out for').layout, 'compare');
  for (const s of scenes) assert.ok(s.narration.length > 30 && s.points.length, `${s.title} has speech and a slide`);
});

test('many action items are split across scenes of five', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ task: `Task number ${i + 1}`, owner_name: `Person ${i}`, status: 'open' }));
  const scenes = mv.briefingFromNotes({ ...NOTES, purpose: '', summary: '', themes: [], decisions: [], requirements: [], risks: [], open_questions: [] }, many);
  assert.deepEqual(scenes.filter((s) => s.source === 'Action items').map((s) => s.table.rows.length), [5, 5, 2]);
  assert.match(scenes[1].title, /Action items \(1 of 3\)/);
});

test('long speech is trimmed at a sentence end', () => {
  const text = `${'This is a sentence. '.repeat(80)}`;
  const out = mv.sceneSpeech(text, 300);
  assert.ok(out.length <= 300 && out.endsWith('.'));
});

test('generating: the AI deck is voiced, timed and saved; a missing action item gets its own scene', async () => {
  const out = await generateMeetingVideo({ meeting_id: meeting.id });
  assert.equal(out.method, 'ai');
  assert.ok(prompts.at(-1).includes('Update the RBAC schema and user roles — owner: Vishnu RD, due October 20, 2026, high priority'));
  assert.ok(!prompts.at(-1).includes('Close the old calendar tickets'), 'done items are not briefed');

  const saved = await entities.Meeting.get(meeting.id);
  assert.equal(saved.briefing_status, 'ready');
  assert.equal(saved.briefing_method, 'ai');
  assert.match(saved.briefing_audio_url, /^\/api\/media\/[a-f0-9]{64}$/);
  const scenes = JSON.parse(saved.briefing_scenes);
  assert.equal(scenes.length, 5, 'four AI scenes plus one for the item the AI left out');
  assert.equal(scenes.at(-1).title, 'Wrap-up', 'the wrap-up stays last');
  assert.equal(scenes[3].title, 'More action items');
  assert.match(scenes[3].text, /^One more action item to remember. Bhuvaneshwari S, you need to document the OSS REST endpoints/);
  assert.equal(scenes[2].table.rows.length, 1, 'malformed table rows are dropped');
  assert.equal(scenes.at(-1).layout, 'points', 'unknown layouts fall back to points');
  for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i].start, scenes[i - 1].end, 'scenes follow each other on one track');
  assert.ok(scenes.every((s) => s.captions.length && s.captions[0].start === s.start && s.playbook === 'HMS - Review update · October 15, 2026'));
  assert.equal(spoken.length, 5, 'each scene is voiced once');
  assert.equal(spoken[0], scenes[0].text);

  const audio = await call('GET', saved.briefing_audio_url.replace('/api', ''));
  assert.equal(audio.status, 200);
  assert.equal(audio.buf.length, 5 * 40 * 417, 'one joined MP3 track');
});

test('an unusable AI answer falls back to the notes-based briefing', async () => {
  behaviour.deck = 'junk';
  try {
    const out = await generateMeetingVideo({ meeting_id: meeting.id });
    assert.equal(out.method, 'notes');
    assert.equal(JSON.parse((await entities.Meeting.get(meeting.id)).briefing_scenes)[0].title, 'HMS - Review update');
  } finally {
    behaviour.deck = 'full';
  }
});

test('without a recorded voice (e.g. no Base44 credits) the briefing is still made, for the browser to read aloud', async () => {
  behaviour.speechFails = true;
  try {
    const out = await generateMeetingVideo({ meeting_id: meeting.id });
    assert.equal(out.voice, 'browser');
    assert.match(out.voice_error, /GenerateSpeech/);
    assert.equal(out.audio_url, null);
    const m = await entities.Meeting.get(meeting.id);
    assert.equal(m.briefing_status, 'ready');
    assert.equal(m.briefing_voice, 'browser');
    assert.equal(m.briefing_audio_url, '');
    assert.match(m.briefing_error, /GenerateSpeech/, 'the reason is kept as a note');
    const scenes = JSON.parse(m.briefing_scenes);
    assert.equal(scenes[0].start, 0);
    for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i].start, scenes[i - 1].end, 'estimated timings follow each other');
    assert.ok(scenes.every((s) => s.end - s.start >= 3 && s.text && s.captions.length), 'each scene keeps its words for the browser voice');
  } finally {
    behaviour.speechFails = false;
  }
});

test('requests: admins only, a processed meeting, a known id', async () => {
  assert.equal((await call('POST', '/functions/generateMeetingVideo', {})).status, 400);
  assert.equal((await call('POST', '/functions/generateMeetingVideo', { meeting_id: 'missing' })).status, 404);
  const raw = await entities.Meeting.create({ title: 'Not analysed', status: 'uploaded' });
  const notReady = await call('POST', '/functions/generateMeetingVideo', { meeting_id: raw.id });
  assert.equal(notReady.status, 400);
  assert.match(notReady.data.error, /Process the transcript first/);

  const ok = await call('POST', '/functions/generateMeetingVideo', { meeting_id: meeting.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.scenes, 5);

  cookie = '';
  await call('POST', '/auth/register', { email: 'learner@example.com', password: 'Learner-pass-123' });
  assert.equal((await call('POST', '/functions/generateMeetingVideo', { meeting_id: meeting.id })).status, 403);
});

test('spoken sentences read naturally: reasons, purposes and capitalised notes', () => {
  assert.equal(mv.reasonClause('To maintain operational independence.'), ', to maintain operational independence');
  assert.equal(mv.reasonClause('Because the systems must stay isolated'), ', because the systems must stay isolated');
  assert.equal(mv.reasonClause(''), '');
  assert.equal(mv.lowerFirst('Enforce strict REST interactions'), 'enforce strict REST interactions');
  assert.equal(mv.lowerFirst('RBAC first'), 'RBAC first');
  assert.equal(mv.asClause('To Update the schema.'), 'update the schema');
});

test('due dates are spoken naturally, whether a date or the words used in the meeting', () => {
  assert.equal(mv.duePhrase({ due_date: '2026-10-20' }), ', by October 20, 2026');
  assert.equal(mv.duePhrase({ due_text: 'Within three days' }), ', within three days');
  assert.equal(mv.duePhrase({ due_text: 'Friday' }), ', by Friday');
  assert.equal(mv.duePhrase({}), '');
});
