import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createWorkspaceEmail } from '../netlify/functions/workspace-email.mjs';
import { digest, gmailConfig, verifyGoogleEmail } from '../netlify/lib/gmail-account.mjs';
import { WorkspaceEmail } from '../src/admin/email.ts';

const origin = 'https://rs.example';
const path = '/.netlify/functions/workspace-email';
const settings = { clientId: 'client', clientSecret: 'secret', redirectUri: origin + path };
const owner = { id: 'owner-1', roles: ['owner'] };
const inbox = { subject: 'google-user', email: 'dispatch@example.gmail.com' };
const expired = { status: 401 };

function call(search, { method = 'GET', source = origin, cookie = '' } = {}) {
  return new Request(origin + path + '?' + search, { method, headers: { Origin: source, Cookie: cookie } });
}

function fixture() {
  const records = new Map();
  let sequence = 0;
  let user = owner;
  let now = 2_000;
  let exchanges = 0;
  let resolveVerification;
  const handler = createWorkspaceEmail({
    authenticate: async () => { if (!user) throw expired; return user; },
    settingsFor: () => settings,
    now: () => now,
    read: async key => records.get(key) || { data: null, revision: null },
    write: async (key, data, revision) => {
      assert.match(key, /^gmail-account\//);
      if ((records.get(key)?.revision ?? null) !== revision) throw { status: 409 };
      const saved = { data, revision: String(++sequence) };
      records.set(key, saved);
      return saved;
    },
    verify: async (_settings, code, verifier) => {
      exchanges++;
      assert.equal(code, 'google-code');
      assert.equal(digest(verifier), oauthChallenge);
      if (resolveVerification) await resolveVerification;
      return inbox;
    },
  });
  let oauthChallenge;
  return {
    handler, records, exchanges: () => exchanges,
    changeUser: value => { user = value; }, advanceTime: () => { now += 601_000; },
    pauseExchange: () => {
      let resume;
      resolveVerification = new Promise(resolve => { resume = resolve; });
      return resume;
    },
    begin: async () => {
      const start = await handler(call('action=connect', { method: 'POST' }));
      assert.equal(start.status, 200);
      const authorization = new URL((await start.json()).authorizationUrl);
      const cookie = start.headers.get('set-cookie');
      assert.match(cookie, /HttpOnly; SameSite=Lax; Secure; Max-Age=600/);
      assert.equal(authorization.origin, 'https://accounts.google.com');
      assert.equal(authorization.searchParams.get('scope'), 'openid email');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authorization.searchParams.get('access_type'), 'online');
      assert.equal(authorization.searchParams.get('client_secret'), null);
      oauthChallenge = authorization.searchParams.get('code_challenge');
      return { query: 'state=' + authorization.searchParams.get('state'), cookie: cookie.split(';')[0] };
    },
  };
}

test('Gmail linking requires owner access and the initiating browser and consumes each attempt once', async () => {
  const { handler, records, exchanges, changeUser, begin, advanceTime } = fixture();
  const link = await begin();
  assert.equal((await handler(call('action=disconnect', { method: 'POST', source: 'https://other.example' }))).status, 403);
  changeUser({ id: 'staff-account', roles: ['staff'] });
  assert.equal((await handler(call('action=status'))).status, 403);
  assert.equal((await handler(call('action=connect', { method: 'POST' }))).status, 403);
  changeUser(null);
  assert.equal((await handler(call('action=status'))).status, 401);
  changeUser({ id: 'owner-2', roles: ['owner'] });
  assert.match((await handler(call(link.query + '&code=google-code', link))).headers.get('location'), /expired/);
  changeUser(owner);
  assert.match((await handler(call(link.query + '&code=google-code'))).headers.get('location'), /expired/);
  assert.equal(exchanges(), 0);

  const success = await handler(call(link.query + '&code=google-code', link));
  assert.equal(success.headers.get('location'), '/admin/?email-status=linked#email');
  assert.match(success.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await (await handler(call('action=status'))).json(), { available: true, account: { email: inbox.email } });
  assert.deepEqual([...records.values()][0].data, { account: inbox, pending: null });
  assert.match((await handler(call(link.query + '&code=google-code', link))).headers.get('location'), /expired/);
  const stale = await begin();
  advanceTime();
  assert.match((await handler(call(stale.query + '&code=google-code', stale))).headers.get('location'), /expired/);
  assert.equal(exchanges(), 1);
});

test('cancelling leaves the previous link intact and a disconnect wins over a pending Google response', async () => {
  const { handler, begin, pauseExchange, exchanges } = fixture();
  const first = await begin();
  await handler(call(first.query + '&code=google-code', first));
  const cancelled = await begin();
  assert.match((await handler(call(cancelled.query + '&error=access_denied', cancelled))).headers.get('location'), /cancelled/);
  assert.deepEqual((await (await handler(call('action=status'))).json()).account, { email: inbox.email });
  const pending = await begin();
  const resume = pauseExchange();
  const linking = handler(call(pending.query + '&code=google-code', pending));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exchanges(), 2);
  assert.deepEqual((await (await handler(call('action=disconnect', { method: 'POST' }))).json()).account, null);
  resume();
  assert.match((await linking).headers.get('location'), /expired/);
  assert.deepEqual((await (await handler(call('action=status'))).json()).account, null);
});

test('the Google connection uses a configured origin and reports only verified Gmail identities', async () => {
  const env = { CONTEXT: 'production', RS_GMAIL_ORIGIN: origin, RS_GMAIL_CLIENT_ID: 'client', RS_GMAIL_CLIENT_SECRET: 'secret' };
  assert.deepEqual(gmailConfig(call('action=status'), env), settings);
  assert.equal(gmailConfig(call('action=status'), { ...env, CONTEXT: 'deploy-preview' }), null);
  assert.equal(gmailConfig(call('action=status'), { ...env, RS_GMAIL_ORIGIN: 'https://other.example' }), null);
  assert.equal(gmailConfig(call('action=status'), { ...env, RS_GMAIL_CLIENT_SECRET: '' }), null);
  const mockGoogle = address => async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('code_verifier'), 'verifier');
      assert.equal(options.body.get('client_secret'), 'secret');
      return Response.json({ access_token: 'temporary-test-token', refresh_token: 'ignored' });
    }
    assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
    assert.equal(options.headers.Authorization, 'Bearer temporary-test-token');
    return Response.json(address);
  };
  const verified = { sub: 'google-user', email: 'dispatch@gmail.com', email_verified: true };
  assert.deepEqual(await verifyGoogleEmail(settings, 'code', 'verifier', mockGoogle(verified)), { subject: verified.sub, email: verified.email });
  await assert.rejects(verifyGoogleEmail(settings, 'code', 'verifier', mockGoogle({ ...verified, email_verified: false })));
  await assert.rejects(verifyGoogleEmail(settings, 'code', 'verifier', mockGoogle({ ...verified, email: 'dispatch@other.example' })), { status: 422 });
});

test('the Email view shows a linked inbox and supports disconnect and unconfigured states', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: origin + '/admin/?email-status=linked#email' });
  const { document } = dom.window;
  let status = { available: true, account: { email: inbox.email } };
  const view = new WorkspaceEmail(document.querySelector('#owner-email-view'), async action => {
    if (action === 'email-disconnect') status = { available: true, account: null };
    return status;
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(document.querySelector('[data-owner-view="email"]').dataset.permission, 'email');
    view.setActive(true);
    await settle();
    assert.match(document.querySelector('#gmail-feedback').textContent, /linked/);
    assert.equal(dom.window.location.search, '');
    assert.equal(new URL(document.querySelector('#gmail-inbox').href).searchParams.get('authuser'), inbox.email);
    document.querySelector('#gmail-disconnect').click();
    await settle();
    assert.equal(document.querySelector('#gmail-connect').hidden, false);
    assert.equal(document.querySelector('#gmail-disconnect').hidden, true);
    view.setActive(false);
    status = { available: false, account: null };
    view.setActive(true);
    await settle();
    assert.equal(document.querySelector('#gmail-connect').hidden, true);
    assert.match(document.querySelector('#gmail-description').textContent, /setup is required/);
    assert.equal(document.querySelector('#gmail-inbox').href, 'https://mail.google.com/mail/');
  } finally {
    dom.window.close();
  }
});
