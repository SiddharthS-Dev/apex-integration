import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// - The course-batch auto-resumer is started with the other background jobs and stopped on shutdown
//   (it used to be imported by server.js but never called), and JOBS_ENABLED=false keeps it off.
// - EMAIL_PROVIDER=smtp can load nodemailer (now a real dependency); nothing here sends mail.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-bg-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
});
const silence = console.log;
console.log = () => {};

const { startBatchResumer, stopBatchResumer, batchResumerRunning } = await import('../src/pipeline/courseContent.js');
const { loadNodemailer, sendMail, emailProvider } = await import('../src/notify/mailer.js');

after(() => {
  console.log = silence;
  stopBatchResumer();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server.js starts the batch resumer and stops it on shutdown', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/server.js'), 'utf8');
  const startAt = src.search(/^startBatchResumer\(/m);
  assert.ok(startAt > 0, 'startBatchResumer() is called at top level');
  assert.ok(startAt > src.search(/^startJobs\(\)/m), 'it is started alongside the other background jobs');
  const shutdown = src.slice(src.indexOf('async function shutdown'));
  assert.match(shutdown.slice(0, shutdown.indexOf('process.exit')), /stopBatchResumer\(\)/);
});

test('the batch resumer runs until stopped, and stays off when jobs are disabled', () => {
  assert.equal(batchResumerRunning(), false);
  assert.equal(startBatchResumer(60_000, { enabled: false }), false);
  assert.equal(batchResumerRunning(), false);
  assert.equal(startBatchResumer(60_000, { enabled: true }), true);
  assert.equal(batchResumerRunning(), true);
  assert.equal(startBatchResumer(60_000, { enabled: true }), false, 'a second start is a no-op');
  stopBatchResumer();
  assert.equal(batchResumerRunning(), false);
});

test('nodemailer is installed for the smtp transport (no mail is sent)', async () => {
  const nodemailer = await loadNodemailer();
  assert.equal(typeof nodemailer.createTransport, 'function');
  const transport = nodemailer.createTransport('smtp://user:pass@127.0.0.1:2525');
  assert.equal(typeof transport.sendMail, 'function');
  transport.close();
});

test('the log transport is unaffected', async () => {
  assert.equal(emailProvider(), 'log');
  assert.deepEqual(await sendMail({ to: 'a@example.com', subject: 'Hi', text: 'Hello' }), { id: 'log' });
});
