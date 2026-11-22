import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { clearLoginQuery, createAdminLogin } from '../public/assets/admin-login.js';

test('login handles errors, password visibility, recovery, Google, and password setup', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://rs.example/admin/?identifier=test-account&password=test-only&login=preview#email' });
  globalThis.document = dom.window.document;
  clearLoginQuery(dom.window.location, dom.window.history);
  assert.equal(dom.window.location.href, 'https://rs.example/admin/?login=preview#email');
  assert.equal(document.querySelector('#owner-login-form').method, 'post');
  assert.equal(document.querySelector('#owner-reset-form').method, 'post');
  assert.equal(document.querySelector('#owner-login-submit').disabled, true);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let fail = true, signedIn = 0, googleCalls = 0;
  const calls = [];
  const login = createAdminLogin({
    api: async (action, data) => { calls.push({ action, data }); if (fail && action === 'login') throw new Error('Check your email or username and password.'); },
    googleSignIn: async () => { googleCalls++; throw new Error('Google sign-in is not enabled yet.'); },
    completeAccess: async () => {}, onSignedIn: async () => { signedIn++; },
  });
  const $ = selector => document.querySelector(selector);
  assert.equal($('#owner-login-submit').disabled, false);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  $('#owner-email').value = 'dispatcher'; $('#owner-password').value = '  password!  ';
  $('#owner-password-toggle').click();
  assert.equal($('#owner-password').type, 'text');
  assert.equal($('#owner-password-toggle').getAttribute('aria-pressed'), 'true');
  $('#owner-login-form').requestSubmit(); await settle();
  assert.equal(signedIn, 0);
  assert.equal($('#login-status').getAttribute('role'), 'alert');
  assert.match($('#login-status').textContent, /Check your email/);
  assert.equal($('#owner-password').value, '  password!  ', 'retry preserves the password including spaces');
  assert.equal($('#owner-login-submit').disabled, false);
  $('#owner-recovery').click();
  assert.equal($('#owner-reset-dialog').open, true);
  assert.equal($('#owner-reset-identifier').value, 'dispatcher');
  $('#owner-reset-form').requestSubmit(); await settle();
  assert.equal(calls.at(-1).action, 'recovery');
  assert.match($('#owner-reset-status').textContent, /If this matches an invited account/);
  $('#owner-reset-close').click(); assert.equal($('#owner-reset-dialog').open, false);
  $('#owner-google').click(); await settle();
  assert.equal(googleCalls, 1);
  assert.match($('#login-status').textContent, /Google sign-in is not enabled/);
  assert.equal($('#owner-google').disabled, false);
  assert.ok($('#owner-google svg'), 'Google icon survives loading and errors');
  fail = false;
  $('#owner-login-form').requestSubmit(); await settle();
  assert.equal(signedIn, 1);
  assert.deepEqual(calls.at(-1), { action: 'login', data: { identifier: 'dispatcher', password: '  password!  ' } });
  assert.equal($('#owner-password').value, '');
  assert.equal($('#owner-password').type, 'password');
  login.setPasswordMode();
  assert.equal($('#owner-email').required, false);
  assert.equal($('#owner-password').minLength, 12);
  assert.equal($('#owner-google').hidden, true);
  assert.equal($('#login-recovery-row').hidden, true);
  dom.window.close();
});

test('homepage forwards Identity callback fragments without forwarding ordinary page anchors', async () => {
  const script = await readFile(new URL('../public/assets/admin-callback.js', import.meta.url), 'utf8');
  const vm = await import('node:vm');
  for (const [hash, expected] of [
    ['#access_token=fake&refresh_token=fake', '/admin/#access_token=fake&refresh_token=fake'],
    ['#recovery_token=fake', '/admin/#recovery_token=fake'],
    ['#invite_token=fake', '/admin/#invite_token=fake'],
    ['#error=access_denied', '/admin/#error=access_denied'],
    ['#contact', undefined], ['#reviews', undefined],
  ]) {
    let destination;
    vm.runInNewContext(script, { URLSearchParams, location: { hash, replace(value) { destination = value; } } });
    assert.equal(destination, expected);
  }
});
