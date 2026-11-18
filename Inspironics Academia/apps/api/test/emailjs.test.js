import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { sendEmailjs, emailConfigured } from '../src/notify/mailer.js';

// The EmailJS transport posts once to the EmailJS REST API from the server, with the private key as
// accessToken, and maps the message onto the generic template's parameters. No network: fetch is stubbed.

function withEmailjs(values, fn) {
  const before = { provider: config.email.provider, from: config.email.from, emailjs: config.email.emailjs };
  config.email.provider = 'emailjs';
  config.email.from = 'Inspironics APEX <noreply@example.com>';
  config.email.emailjs = values;
  return Promise.resolve(fn()).finally(() => Object.assign(config.email, before));
}
const FULL = { serviceId: 'svc', templateId: 'tpl', publicKey: 'pub', privateKey: 'priv' };

test('emailjs: posts the message to the REST API with the private key', () =>
  withEmailjs(FULL, async () => {
    assert.equal(emailConfigured(), true);
    let call;
    const fetchStub = async (url, init) => { call = { url, init }; return new Response('OK', { status: 200 }); };
    const out = await sendEmailjs({ to: 'a@example.com', subject: 'Your code', text: 'Code 123456', html: '<p>Code 123456</p>', kind: 'onboarding_code' }, fetchStub);
    assert.equal(out.id, 'emailjs');
    assert.equal(call.url, 'https://api.emailjs.com/api/v1.0/email/send');
    const body = JSON.parse(call.init.body);
    assert.deepEqual([body.service_id, body.template_id, body.user_id, body.accessToken], ['svc', 'tpl', 'pub', 'priv']);
    assert.equal(body.template_params.to_email, 'a@example.com');
    assert.equal(body.template_params.subject, 'Your code');
    assert.equal(body.template_params.message, 'Code 123456');
    assert.equal(body.template_params.html_message, '<p>Code 123456</p>');
    assert.equal(body.template_params.from_name, 'Inspironics APEX');
  }));

test('emailjs: a verification code fills the OTP template variables and uses the OTP template', () =>
  withEmailjs({ ...FULL, otpTemplateId: 'otp-tpl' }, async () => {
    let body;
    const fetchStub = async (_u, init) => { body = JSON.parse(init.body); return new Response('OK', { status: 200 }); };
    const text = 'Enter this code to confirm your email address for your APEX access request: 482913\n\nIt expires in 10 minutes.';
    await sendEmailjs({ to: 'a@example.com', subject: 'Your APEX verification code', text, kind: 'onboarding_code' }, fetchStub);
    assert.equal(body.template_id, 'otp-tpl');
    for (const k of ['passcode', 'otp', 'code', 'verification_code']) assert.equal(body.template_params[k], '482913');
    assert.equal(body.template_params.expires_in, '10 minutes');
    assert.ok(body.template_params.time);
    // Any other email uses the general template and carries no code fields.
    await sendEmailjs({ to: 'a@example.com', subject: 'Invite', text: 'Set your password', kind: 'invite' }, fetchStub);
    assert.equal(body.template_id, 'tpl');
    assert.equal(body.template_params.passcode, undefined);
  }));

test('emailjs: a rejected send throws (so the outbox retries) without echoing the message', () =>
  withEmailjs(FULL, async () => {
    const fetchStub = async () => new Response('The Public Key is invalid', { status: 400 });
    await assert.rejects(sendEmailjs({ to: 'a@example.com', subject: 's', text: 'Code 123456' }, fetchStub), (err) => {
      assert.match(err.message, /^EmailJS 400/);
      assert.doesNotMatch(err.message, /123456/);
      return true;
    });
  }));

test('emailjs: missing keys mean not configured, and sending refuses', () =>
  withEmailjs({ ...FULL, privateKey: '' }, async () => {
    assert.equal(emailConfigured(), false);
    await assert.rejects(sendEmailjs({ to: 'a@example.com', subject: 's', text: 't' }, async () => new Response('OK')), /must all be set/);
  }));
