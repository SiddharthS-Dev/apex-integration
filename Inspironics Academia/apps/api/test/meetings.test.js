import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';

// Meeting transcripts → meeting notes. Unit tests for the parser and the analysis shape, then the
// whole flow through the HTTP API on a throwaway SQLite database with AI off (keyword analysis).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-meetings-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
});
const silence = console.log;
console.log = () => {};

const {
  actionItemReminders, heuristicAnalysis, matchOwner, matchesQuery, meetingFromFileName, normalizeAnalysis, parseTranscript,
  resolveDue, samePerson, speakerStats, suggestRoster, teamFromPath, teamPeople,
} = await import('@academy/shared');
const { inFolder, planSync } = await import('../src/sync/pipeline.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');

// ---- parsing ---------------------------------------------------------------------------------

const TEAMS_DOCX_TEXT = `Release Readiness Review-20261101_100000-Meeting Recording
November 1, 2026, 4:30AM
32m 10s

Priya Raman started transcription

Priya Raman\t0:03
Morning everyone. Let's go through the release plan.

Lee Learner\t0:15
The payment service must support retries before we launch. I'll update the retry config by Friday.

Priya Raman\t2:40
We decided to delay the launch by one week. Lee, can you share the test report tomorrow?

Arjun Mehta\t3:05
I'm not sure the vendor can meet the new deadline, that is a risk for us.`;

test('Teams Word export: header, speakers, timestamps, system lines dropped', () => {
  const p = parseTranscript(TEAMS_DOCX_TEXT);
  assert.equal(p.title, 'Release Readiness Review');
  assert.equal(p.date, '2026-11-01');
  assert.equal(p.duration_seconds, 1930);
  assert.deepEqual(p.participants, ['Priya Raman', 'Lee Learner', 'Arjun Mehta']);
  assert.deepEqual(p.segments.map((s) => s.start), [3, 15, 160, 185]);
  assert.ok(!p.segments.some((s) => /transcription/.test(s.text)));
});

test('WebVTT, VTT pasted into Word, and plain "Name: text" notes', () => {
  const vtt = parseTranscript('WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Priya Raman>Hello team.</v>\n\n00:00:05.000 --> 00:00:09.000\n<v Arjun Mehta>I will draft the runbook.</v>\n\n00:00:10.000 --> 00:00:12.000\n<v Arjun Mehta>And share it.</v>');
  assert.deepEqual(vtt.segments.map((s) => [s.speaker, s.start, s.text]), [['Priya Raman', 1, 'Hello team.'], ['Arjun Mehta', 5, 'I will draft the runbook. And share it.']]);

  const pasted = parseTranscript('0:0:0.0 --> 0:0:3.120\nPriya Raman\nOkay, let\'s start.\n\n0:0:3.120 --> 0:0:8.0\nArjun Mehta\nSure.');
  assert.deepEqual(pasted.segments.map((s) => s.speaker), ['Priya Raman', 'Arjun Mehta']);

  const notes = parseTranscript('Date: 3 November 2026\nAttendees: Priya, Arjun\n\nPriya: Can we ship Friday?\nArjun: Yes, I will confirm with QA.');
  assert.equal(notes.date, '2026-11-03');
  assert.deepEqual(notes.participants, ['Priya', 'Arjun'], '"Date:" and "Attendees:" are header, not speakers');
});

test('file names, dates and due phrases', () => {
  assert.deepEqual(meetingFromFileName('Weekly Sync-20261101_100000-Meeting Transcript.docx'), { title: 'Weekly Sync', date: '2026-11-01' });
  assert.equal(resolveDue('Friday', '2026-11-01'), '2026-11-06'); // a Sunday → the coming Friday
  assert.equal(resolveDue('tomorrow', '2026-11-01'), '2026-11-02');
  assert.equal(resolveDue('next week', '2026-11-01'), '2026-11-08');
  assert.equal(resolveDue('15 November', '2026-11-01'), '2026-11-15');
  assert.equal(resolveDue('someday', '2026-11-01'), '');
});

test('the team is the sub-folder a transcript is filed in', () => {
  const root = '/Inspironics Meeting Transcripts';
  assert.equal(teamFromPath(`${root}/HMS Meeting Transcripts/HMS - Review.docx`, root), 'HMS');
  assert.equal(teamFromPath(`${root}/Data Integration Meeting Transcripts/2026/x.docx`, root), 'Data Integration');
  assert.equal(teamFromPath(`${root}/IVEOS/review.docx`, root), 'IVEOS');
  assert.equal(teamFromPath(`${root}/loose.docx`, root), '', 'directly in the meetings folder: no team');
  assert.equal(teamFromPath('/Sales_Meetings/x.vtt', '/'), 'Sales', 'a meetings app of its own, synced from its top level');
});

test('a team roster counts its members and SMEs; everyone else who spoke is a guest', () => {
  assert.ok(samePerson('Siva Subramanian N', 'Sivasubramanian Narayanan'));
  assert.ok(samePerson('Kumar Aravamudhan', 'kumar  aravamudhan'));
  assert.ok(!samePerson('Siddharth S', 'Sanjay S'));
  const roster = { members: [
    { name: 'Vishnu RD', role: 'member' }, { name: 'Ramana G', role: 'member' }, { name: 'Bhuvaneshwari S', role: 'member' },
    { name: 'Siddharth S', role: 'member' }, { name: 'Siva Subramanian N', role: 'member' },
    { name: 'Senthil Arumugam', role: 'sme' }, { name: 'Kumar Aravamudhan', role: 'sme', aliases: ['Kumar A'] },
  ] };
  const meetings = [
    { participants: ['Kumar Aravamudhan', 'Siddharth S', 'Vishnu RD', 'Admin Inspironics', 'Sanjay S'] },
    { participants: ['Ramana G', 'Sivasubramanian Narayanan', 'Nanda', 'Kumar A'] },
  ];
  const r = teamPeople(meetings, roster);
  assert.deepEqual([r.people.length, r.members.length, r.smes.length], [7, 5, 2], 'the roster, whether or not everyone spoke');
  assert.deepEqual(r.guests, ['Admin Inspironics', 'Sanjay S', 'Nanda']);
  const noRoster = teamPeople(meetings, null);
  assert.equal(noRoster.people.length, 7, 'without a saved roster: the one built from the meetings — shared logins out, "Kumar A" merged into Kumar Aravamudhan');
});

test('a roster is built from who regularly joins the team meetings', () => {
  const meetings = [
    { participants: ['Dharani JC', 'Naveen S', 'Kumar Aravamudhan', 'Admin Inspironics'] },
    { participants: ['Dharani JC', 'Naveen S', 'Siva Subramanian N', 'Bhuvaneshwari S'] },
    { participants: ['Dharani JC', 'Sivasubramanian Narayanan', 'Kumar Aravamudhan', 'Senthil Arumugam', 'Admin Inspironics'] },
  ];
  const r = suggestRoster(meetings, { smes: ['Senthil Arumugam', 'Kumar Aravamudhan'] });
  assert.deepEqual(r.map((e) => [e.name, e.role, e.meetings]), [
    ['Dharani JC', 'member', 3], ['Naveen S', 'member', 2], ['Siva Subramanian N', 'member', 2],
    ['Kumar Aravamudhan', 'sme', 2], ['Senthil Arumugam', 'sme', 1],
  ], 'one-off attendees and shared logins are left out; known SMEs join on any appearance');
  assert.deepEqual(r.find((e) => e.name === 'Siva Subramanian N').aliases, ['Sivasubramanian Narayanan']);
  assert.deepEqual(suggestRoster([{ participants: ['Sudalai Muthu A', 'Admin Inspironics'] }]).map((e) => e.name), ['Sudalai Muthu A'], 'a one-meeting team: everyone but shared logins');
  const people = teamPeople(meetings, null, { smes: ['Senthil Arumugam', 'Kumar Aravamudhan'] });
  assert.deepEqual([people.people.length, people.roster, people.guests], [5, false, ['Admin Inspironics', 'Bhuvaneshwari S']]);
});

test('keyword analysis finds commitments with owners and due dates, decisions, requirements, risks', () => {
  const p = parseTranscript(TEAMS_DOCX_TEXT);
  const a = normalizeAnalysis(heuristicAnalysis(p, { date: p.date }), { participants: p.participants });
  assert.deepEqual(a.action_items.map((x) => [x.owner, x.due_date]), [['Lee Learner', '2026-11-06'], ['Lee Learner', '2026-11-02']], 'the person asked owns it');
  assert.equal(a.action_items[0].time, 15);
  assert.deepEqual(a.decisions.map((d) => d.decision), ['We decided to delay the launch by one week.']);
  assert.deepEqual(a.requirements.map((r) => r.raised_by), ['Lee Learner']);
  assert.equal(a.risks.length, 1);
  assert.match(a.summary, /3 participants over 32 minutes/);
});

test('normalizeAnalysis keeps only well-formed entries and resolves owners to participants', () => {
  const a = normalizeAnalysis({
    action_items: [{ task: 'Ship it', owner: 'priya', due_date: 'Friday', priority: 'urgent' }, { task: '' }],
    decisions: [{ decision: 'Go', owner: 'Arjun' }],
    requirements: [{ text: 'Retries', type: 'weird' }],
  }, { participants: ['Priya Raman', 'Arjun Mehta'] });
  assert.deepEqual(a.action_items, [{ task: 'Ship it', detail: '', owner: 'Priya Raman', due_date: '', due_text: '', priority: 'medium', quote: '', time: null }]);
  assert.equal(a.decisions[0].owner, 'Arjun Mehta');
  assert.equal(a.requirements[0].type, 'other');
  assert.deepEqual(a.themes, []);
});

test('speaker stats and owner matching', () => {
  const stats = speakerStats(parseTranscript(TEAMS_DOCX_TEXT).segments, 1930);
  assert.equal(stats.reduce((n, s) => n + s.share, 0) >= 99, true);
  assert.equal(stats.find((s) => s.name === 'Arjun Mehta').seconds, 1930 - 185, 'the last speaker runs to the end');
  const users = [{ id: 'u1', full_name: 'Lee Learner', email: 'lee@x.com' }, { id: 'u2', full_name: 'Priya Raman', email: 'priya.raman@x.com' }, { id: 'u3', full_name: 'Lee Other', disabled: true }];
  assert.equal(matchOwner('Lee Learner', users).id, 'u1');
  assert.equal(matchOwner('lee', users).id, 'u1', 'the disabled Lee is not a candidate');
  assert.equal(matchOwner('priya raman', users).id, 'u2');
  assert.equal(matchOwner('Arjun', users), null);
});

test('sync: meetings folder is matched case-insensitively and planned with the meeting filter', () => {
  assert.ok(inFolder('/team/meetings/2026/a.docx', '/Team/Meetings/'));
  assert.ok(!inFolder('/team/meetings-old/a.docx', '/team/meetings'));
  const files = [{ id: 'f1', name: 'a.docx', rev: '1' }, { id: 'f2', name: 'b.vtt', rev: '1' }, { id: 'f3', name: 'c.pdf', rev: '1' }];
  const plan = planSync(files, [{ id: 'm1', external_id: 'f1', revision: '1', status: 'published', source: 'dropbox' }], { accept: (n) => /\.(docx|vtt|txt)$/.test(n) });
  assert.deepEqual([plan.unchanged.length, plan.add.map((a) => a.file.id), plan.skipped], [1, ['f2'], 1]);
});

test('action item reminders: due tomorrow and overdue, once each', async () => {
  const items = [
    { id: 'a', published: true, status: 'open', owner_user_id: 'u1', due_date: '2026-11-03', task: 'Report' },
    { id: 'b', published: true, status: 'in_progress', owner_user_id: 'u1', due_date: '2026-10-30', task: 'Config' },
    { id: 'c', published: true, status: 'done', owner_user_id: 'u1', due_date: '2026-10-30', task: 'Done' },
    { id: 'd', published: false, status: 'open', owner_user_id: 'u1', due_date: '2026-10-30', task: 'Draft' },
    { id: 'e', published: true, status: 'open', owner_user_id: 'u1', due_date: '2026-12-30', task: 'Later' },
  ];
  const store = { filter: (_n, q) => items.filter((r) => matchesQuery(r, q)) };
  const sent = [];
  const r = await actionItemReminders(store, { today: '2026-11-02', notify: (u, kind, d, key) => sent.push(key) });
  assert.deepEqual(r, { due_soon: 1, overdue: 1 });
  assert.deepEqual(sent, ['action_item_due:a', 'action_item_overdue:b']);
});

// ---- end to end through the API ------------------------------------------------------------------

let server;
let base;

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  const ok = async (...args) => {
    const r = await call(...args);
    assert.ok(r.status < 300, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return {
    call,
    ok,
    fn: (name, payload = {}) => ok('POST', `/functions/${name}`, payload),
    list: (entity, q = {}) => ok('GET', `/entities/${entity}?q=${encodeURIComponent(JSON.stringify(q))}`),
  };
}

// A Word document the way Teams lays out its transcript: the speaker and time on one line, separated by a tab.
async function teamsDocx(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const paras = text.split('\n').map((line) => {
    const [a, b] = line.split('\t');
    const runs = b ? `<w:r><w:t>${esc(a)}</w:t></w:r><w:r><w:tab/><w:t>${esc(b)}</w:t></w:r>` : `<w:r><w:t xml:space="preserve">${esc(a)}</w:t></w:r>`;
    return `<w:p>${runs}</w:p>`;
  }).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const admin = client();
const lee = client();
const other = client();
let leeId;

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await admin.ok('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
  leeId = (await lee.ok('POST', '/auth/register', { email: 'lee@example.com', password: 'Learner-pass-123', full_name: 'Lee Learner' })).user.id;
  await other.ok('POST', '/auth/register', { email: 'sam@example.com', password: 'Learner-pass-123', full_name: 'Sam Someone' });
});

after(async () => {
  server?.close();
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upload → process → review → publish → owners work their items', async () => {
  const name = 'Release Readiness Review-20261101_100000-Meeting Recording.docx';
  const bytes = await teamsDocx(TEAMS_DOCX_TEXT);
  assert.equal((await lee.call('POST', '/meetings/upload', bytes, { 'X-File-Name': encodeURIComponent(name) })).status, 403, 'admins upload');
  assert.equal((await admin.call('POST', '/meetings/upload', Buffer.from('x'), { 'X-File-Name': 'notes.pdf' })).status, 400);
  const meeting = await admin.ok('POST', '/meetings/upload', bytes, { 'X-File-Name': encodeURIComponent(name) });
  assert.deepEqual([meeting.title, meeting.meeting_date, meeting.status, meeting.file_type], ['Release Readiness Review', '2026-11-01', 'uploaded', 'docx']);

  const done = await admin.fn('processMeeting', { meeting_id: meeting.id });
  assert.deepEqual([done.status, done.analysis_method, done.action_item_count, done.participants], ['needs_review', 'heuristic', 2, 3]);
  const [m] = await admin.list('Meeting', { id: meeting.id });
  assert.equal(m.duration_minutes, 32);
  assert.equal(m.speaker_stats.length, 3);
  assert.equal(m.decisions.length, 1);

  // Not published yet: learners see nothing.
  assert.equal((await lee.list('Meeting')).length, 0);
  assert.equal((await lee.list('ActionItem')).length, 0);
  assert.equal((await lee.list('MeetingTranscript')).length, 0);

  const pub = await admin.fn('publishMeeting', { meeting_id: meeting.id });
  assert.equal(pub.status, 'published');
  assert.equal((await lee.list('Meeting')).length, 1);
  assert.equal((await lee.list('MeetingTranscript'))[0].segments.length, 4);
  const items = await lee.list('ActionItem', { meeting_id: meeting.id });
  assert.ok(items.every((a) => a.owner_user_id === leeId), 'matched to Lee\'s account');
  const kinds = (await lee.list('Notification')).map((n) => n.kind).sort();
  assert.deepEqual(kinds, ['action_item_assigned', 'action_item_assigned', 'meeting_published']);

  // The owner moves status (completion is dated); nothing else, and nobody else.
  const updated = await lee.ok('PATCH', `/entities/ActionItem/${items[0].id}`, { status: 'done' });
  assert.equal(updated.completed_date, new Date().toISOString().slice(0, 10));
  assert.equal((await lee.call('PATCH', `/entities/ActionItem/${items[0].id}`, { task: 'Something else' })).status, 403);
  assert.equal((await other.call('PATCH', `/entities/ActionItem/${items[1].id}`, { status: 'done' })).status, 403);

  // An admin edit is kept when the meeting is reprocessed; the done status carries over.
  await admin.ok('PATCH', `/entities/ActionItem/${items[1].id}`, { task: 'Share the signed-off test report', priority: 'high' });
  await admin.fn('processMeeting', { meeting_id: meeting.id });
  const after = await admin.list('ActionItem', { meeting_id: meeting.id });
  assert.equal(after.length, 2);
  assert.ok(after.some((a) => a.task === 'Share the signed-off test report' && a.edited));
  assert.ok(after.some((a) => a.status === 'done' && !a.edited));
  assert.equal((await lee.list('Meeting')).length, 0, 'reprocessing sends the notes back to review');

  // Deleting a meeting takes its transcript and action items with it.
  await admin.ok('DELETE', `/entities/Meeting/${meeting.id}`);
  assert.equal((await admin.list('ActionItem')).length, 0);
  assert.equal((await admin.list('MeetingTranscript')).length, 0);
});

test('a file with no speaker turns fails with a clear message', async () => {
  const meeting = await admin.ok('POST', '/meetings/upload', Buffer.from('Just some notes without any speakers at all, nothing to parse here.'), { 'X-File-Name': 'notes.txt' });
  const r = await admin.call('POST', '/functions/processMeeting', { meeting_id: meeting.id });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /No speaker turns/);
  assert.equal((await admin.list('Meeting', { id: meeting.id }))[0].status, 'failed');
  assert.equal((await admin.call('POST', '/functions/publishMeeting', { meeting_id: meeting.id })).status, 400);
});

test('the AI analysis schema is valid for structured outputs and matches what normalizeAnalysis reads', async () => {
  const { ANALYSIS_SCHEMA } = await import('../src/pipeline/processMeeting.js');
  const { strictSchema } = await import('../src/ai/claude.js');
  const strict = strictSchema(ANALYSIS_SCHEMA);
  assert.equal(strict.additionalProperties, false);
  const item = strict.properties.action_items.items;
  assert.equal(item.additionalProperties, false);
  assert.ok(!item.required.includes('time'), 'a transcript without timestamps has no time to give');
  const shape = normalizeAnalysis({});
  assert.deepEqual(Object.keys(strict.properties).sort(), Object.keys(shape).sort());
});
