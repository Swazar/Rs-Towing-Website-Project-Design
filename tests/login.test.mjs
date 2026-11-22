import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLoginEmail } from '../netlify/lib/login-identifier.mjs';
import { createAuthHandler } from '../netlify/functions/owner-auth.mjs';

test('username resolution is server configured; typed email works independently', () => {
  const env = { OWNER_LOGIN_USERNAME: 'dispatcher', OWNER_LOGIN_EMAIL: 'owner@example.com' };
  assert.equal(resolveLoginEmail(' Dispatcher ', env), 'owner@example.com');
  assert.equal(resolveLoginEmail(' staff@gmail.com ', env), 'staff@gmail.com');
  for (const value of ['someone', '', 'owner', 'bad@address', null, {}, 'a'.repeat(255)]) assert.equal(resolveLoginEmail(value, env), null);
  assert.equal(resolveLoginEmail('dispatcher', {}), null);
  assert.equal(resolveLoginEmail('dispatcher', { ...env, OWNER_LOGIN_EMAIL: '' }), null);
});

test('password login verifies the mapped email, rejects wrong credentials, and enforces server roles', async () => {
  const savedFetch = globalThis.fetch, savedRuntime = globalThis.Netlify;
  const savedUsername = process.env.OWNER_LOGIN_USERNAME, savedEmail = process.env.OWNER_LOGIN_EMAIL;
  const cookies = new Map(), calls = [];
  const owner = createAuthHandler(async () => 'a'.repeat(64));
  let roles = ['owner'], rejectPassword = false;
  process.env.OWNER_LOGIN_USERNAME = 'dispatcher'; process.env.OWNER_LOGIN_EMAIL = 'owner@example.com';
  globalThis.Netlify = { context: { url: 'https://rs.example/admin/', cookies: {
    set(cookie) { cookies.set(cookie.name, cookie.value); }, get(name) { return cookies.get(name); }, delete(name) { cookies.delete(name); },
  } } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return rejectPassword ? Response.json({ msg: 'Invalid login' }, { status: 400 }) : Response.json({ access_token: 'test-token', refresh_token: 'test-refresh' });
    if (url.endsWith('/user')) return Response.json({ id: 'invited-owner', email: 'owner@example.com', app_metadata: { roles }, user_metadata: { roles: ['owner'] } });
    if (url.endsWith('/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('/recover')) return new Response(null, { status: 204 });
    throw new Error('Unexpected auth request: ' + url);
  };
  const request = (action, body, origin = 'https://rs.example') => new Request('https://rs.example/.netlify/functions/owner?action=' + action, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const password = '  test-password!  ';
    const signedIn = await owner(request('login', { identifier: 'DISPATCHER', password }));
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.headers.get('set-cookie'), /__Host-rs_workspace=.*Secure; HttpOnly; SameSite=Lax/);
    const credentials = new URLSearchParams(calls[0].options.body);
    assert.equal(credentials.get('username'), 'owner@example.com');
    assert.equal(credentials.get('password'), password);
    rejectPassword = true;
    const invalid = await owner(request('login', { identifier: 'owner@example.com', password: 'incorrect' }));
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error, 'Check your email or username and password.');
    rejectPassword = false; roles = [];
    assert.equal((await owner(request('login', { identifier: 'dispatcher', password }))).status, 403);
    assert.equal(cookies.size, 0, 'an account without a server role loses its session');
    roles = ['staff'];
    assert.equal((await owner(request('login', { identifier: 'staff@gmail.com', password }))).status, 200);
    const before = calls.length;
    assert.equal((await owner(request('login', { identifier: 'dispatcher', password }, 'https://evil.example'))).status, 403);
    assert.equal(calls.length, before, 'cross-origin login never reaches Identity');
    const known = await owner(request('recovery', { identifier: 'dispatcher' }));
    const unknown = await owner(request('recovery', { identifier: 'unmatched-user' }));
    assert.deepEqual(await known.json(), await unknown.json(), 'recovery never reveals the alias email or whether an account exists');
    assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/recover')).options.body).email, 'owner@example.com');
    assert.equal((await owner(request('recovery', { identifier: 'dispatcher' }, 'https://evil.example'))).status, 403);
  } finally {
    globalThis.fetch = savedFetch; globalThis.Netlify = savedRuntime;
    for (const [key, value] of Object.entries({ OWNER_LOGIN_USERNAME: savedUsername, OWNER_LOGIN_EMAIL: savedEmail })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
