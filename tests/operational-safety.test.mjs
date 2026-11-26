import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import owner from '../netlify/functions/owner.mjs';
import formTraffic from '../netlify/edge-functions/form-traffic.js';
import { storeName, readRecord, writeRecord } from '../netlify/lib/store.mjs';
import { assignJobNumbers } from '../netlify/lib/jobs/number-store.ts';
import { canUseAction } from '../netlify/lib/owner-access.mjs';
import { openWorkspaceSession, checkWorkspaceSession, recordIdentitySignIn, workspaceCookie } from '../netlify/lib/workspace-session.mjs';
import { deliverNotification, enqueueQuote, runNotifications, mailSettings } from '../netlify/lib/notification-mail.mjs';
import { contactLinks } from '../public/assets/enquiry-contact.js';
import { defaults } from '../public/assets/business-defaults.js';

function memory() {
  const records = new Map();
  const read = async key => structuredClone(records.get(key) || { data: null, revision: null });
  const write = async (key, data, revision) => {
    if ((records.get(key)?.revision ?? null) !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
    const next = { data, revision: crypto.randomUUID() };
    records.set(key, structuredClone(next));
    return next;
  };
  return { read, write, readRecord: read, writeRecord: write, async *pages(prefix) {
    yield [...records.keys()].filter(key => key.startsWith(prefix));
  } };
}

const quote = {
  'form-name': 'quote-request', request_id: '2e37702e-139a-4ab8-a0cb-b363d937af14',
  name: 'Local test customer', phone: '202-555-0142', pickup: 'Charlotte, NC', dropoff: 'Raleigh, NC',
  service: 'Equipment hauling', details: 'Move a small tractor.', pickup_timing: 'Flexible',
};

test('owner can restore job and website versions without losing a newer edit or exposing history to staff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rs-recovery-test-'));
  const previousDir = process.cwd(), previousDev = process.env.NETLIFY_DEV;
  process.chdir(directory);
  process.env.NETLIFY_DEV = 'true';
  const id = quote.request_id;
  const origin = 'http://localhost:8888';
  async function api(action, body, params) {
    const url = origin + '/.netlify/functions/owner?' + new URLSearchParams({ action, ...params });
    const response = await owner(new Request(url, body ? { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) } : {}));
    return { status: response.status, ...await response.json() };
  }
  try {
    await writeRecord('local-submissions', [{ id, form_name: 'quote-request', created_at: '2026-11-21T17:00:00Z', data: quote }], null);
    const first = await api('enquiry', { id, status: 'Quoted', note: 'Price agreed', followUp: '', agreedPrice: '249.99' });
    assert.equal(first.status, 200);
    assert.equal(first.data.priceCents, 24999);
    assert.equal(first.data.versions, undefined);
    assert.equal((await api('enquiry', { id, revision: first.revision, status: 'Booked', note: '', followUp: '', agreedPrice: '-1' })).status, 400);
    const second = await api('enquiry', { id, revision: first.revision, status: 'Booked', note: '', followUp: '', agreedPrice: '0' });
    assert.equal(second.data.priceCents, 0);
    const history = await api('versions', null, { id });
    assert.equal(history.versions[0].data.priceCents, 24999);
    assert.equal((await api('versions', { id, revision: first.revision, version: history.versions[0].id })).status, 409);
    const restore = await api('versions', { id, revision: second.revision, version: history.versions[0].id });
    assert.equal(restore.data.priceCents, 24999);
    assert.equal(restore.data.note, 'Price agreed');
    assert.equal((await api('versions', null, { id })).versions[0].data.priceCents, 0);
    const listed = (await api('list')).items[0];
    assert.equal(listed.state.versions, undefined);
    assert.equal(listed.id, id, 'the existing record key still identifies the saved enquiry');
    assert.equal(listed.jobNumber, 'RS-202611-EQP-0001');
    assert.equal((await api('list')).items[0].jobNumber, listed.jobNumber);
    assert.equal(canUseAction({ roles: ['staff'] }, 'versions', 'GET'), false);
    assert.equal(canUseAction({ roles: ['staff'] }, 'versions', 'POST'), false);
    const published = await api('content', { data: { ...defaults, headline: 'A new headline' } });
    assert.equal(published.status, 200);
    const versions = await api('versions');
    const website = await api('versions', { revision: published.revision, version: versions.versions[0].id });
    assert.equal(website.data.headline, defaults.headline);
    assert.equal((await api('versions')).versions[0].data.headline, 'A new headline');
  } finally {
    process.chdir(previousDir);
    if (previousDev === undefined) delete process.env.NETLIFY_DEV;
    else process.env.NETLIFY_DEV = previousDev;
    await rm(directory, { recursive: true, force: true });
  }
});

test('workspace sessions require an unexpired server record and a fresh Identity sign-in can only be used once', async () => {
  const storage = memory(), now = Date.parse('2026-11-22T15:00:00Z'), minute = 60_000;
  const user = { id: 'owner-user', lastSignInAt: new Date(now - 500).toISOString() };
  const naked = new Request('https://towing.example/admin');
  const token = await openWorkspaceSession(naked, user, { freshIdentity: true, now, storage });
  assert.match(workspaceCookie(token), /HttpOnly; SameSite=Lax/);
  const request = new Request(naked.url, { headers: { Cookie: workspaceCookie(token).split(';')[0] } });
  await assert.rejects(checkWorkspaceSession(naked, user, { now, storage }), { status: 401 });
  await assert.rejects(checkWorkspaceSession(request, { id: 'other-user' }, { now, storage }), { status: 401 });
  const deadline = now + 30 * minute;
  assert.equal(await checkWorkspaceSession(request, user, { now: now + 29 * minute, storage }), deadline);
  assert.equal(await checkWorkspaceSession(request, user, { now: now + 29 * minute, storage, touch: true }), now + 59 * minute);
  await assert.rejects(checkWorkspaceSession(request, user, { now: now + 59 * minute, storage, touch: true }), { status: 401 });
  await assert.rejects(openWorkspaceSession(naked, user, { freshIdentity: true, now: now + minute, storage }), { status: 401 });
});

test('a trusted Identity login event can open one workspace session when the profile sign-in time is stale', async () => {
  const storage = memory(), now = Date.parse('2026-11-22T15:00:00Z'), minute = 60_000;
  const request = new Request('https://towing.example/admin/');
  const user = { id: 'owner-user', lastSignInAt: new Date(now - 10 * minute).toISOString() };
  const signIn = (at, account = user) => openWorkspaceSession(request, account, { freshIdentity: true, now: at, storage });

  await assert.rejects(signIn(now), { code: 'WORKSPACE_SIGN_IN_FRESHNESS' });
  await recordIdentitySignIn(user, { now, storage });
  await assert.rejects(signIn(now, { id: 'other-user' }), { code: 'WORKSPACE_SIGN_IN_FRESHNESS' });
  assert.match(await signIn(now), /^[a-f0-9]{64}$/);
  await assert.rejects(signIn(now + 1), { code: 'WORKSPACE_SIGN_IN_FRESHNESS' });

  await recordIdentitySignIn(user, { now: now + minute, storage });
  await assert.rejects(signIn(now + 7 * minute), { code: 'WORKSPACE_SIGN_IN_FRESHNESS' });
  await recordIdentitySignIn(user, { now: now + 8 * minute, storage });
  assert.match(await signIn(now + 8 * minute), /^[a-f0-9]{64}$/);
});

test('verified notifications cap quote volume, retry with one delivery key, and send only one pickup digest', async () => {
  const now = Date.parse('2026-11-22T13:30:00Z'), storage = memory();
  const settings = { quotes: true, pickups: true, from: 'alerts@example.com', to: 'owner@example.com', admin: 'https://towing.example/admin/' };
  assert.equal(mailSettings({ CONTEXT: 'deploy-preview' }), null);
  assert.equal(mailSettings({ URL: 'https://towing.example', RESEND_API_KEY: 'simulated', RS_MAIL_FROM: settings.from, RS_ALERT_EMAIL: settings.to, RS_QUOTE_EMAILS: 'true' }, 'production').quotes, true);
  assert.equal(storeName('production', {}), 'rs-owner-preview');
  assert.equal(storeName('production', { CONTEXT: 'production' }), 'rs-owner-production');
  assert.equal(storeName('deploy-preview', { RS_OWNER_STORE: 'rs-owner-preview' }), 'rs-owner-sandbox');
  assert.equal(await enqueueQuote({ ...quote, 'bot-field': 'filled' }, settings, now, storage), null);
  const queued = await enqueueQuote(quote, settings, now, storage);
  assert.equal(await enqueueQuote(quote, settings, now, storage), null);
  const attempts = [];
  const deliver = async (message, key) => { attempts.push({ message, key }); };
  await assert.rejects(deliverNotification(queued.key, queued.id, settings, { now, storage, deliver: async (...args) => {
    await deliver(...args); throw new Error('Provider timeout');
  } }));
  assert.equal(await deliverNotification(queued.key, queued.id, settings, { now, storage, deliver }), false);
  await storage.write('enquiry/booked', { status: 'Booked', scheduledDate: '2026-11-23' }, null);
  await storage.write('enquiry/closed', { status: 'Closed', scheduledDate: '2026-11-23' }, null);
  await runNotifications(settings, { now: now + 16 * 60_000, storage, deliver });
  await runNotifications(settings, { now: now + 32 * 60_000, storage, deliver });
  assert.equal(attempts.length, 3);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].message, attempts[1].message);
  assert.match(attempts[2].message.text, /1 confirmed pickup on 2026-11-23/);
  assert.ok(attempts.every(({ message }) => !message.text.includes(quote.name)));
  const remaining = await Promise.all(Array.from({ length: 2 }, () => enqueueQuote(quote, settings, now, storage)));
  assert.deepEqual(remaining, [null, null]);
  for (let index = 0; index < 24; index++) {
    assert.ok(await enqueueQuote({ ...quote, request_id: crypto.randomUUID() }, settings, now, storage));
  }
  assert.equal(await enqueueQuote({ ...quote, request_id: crypto.randomUUID() }, settings, now, storage), null);
});

test('public form protection preserves a valid forwarding body and rejects spam or oversized submissions', async () => {
  const url = 'https://towing.example/quote-sent/';
  const request = (data, headers = {}) => new Request(url, { method: 'POST', headers,
    body: data instanceof URLSearchParams ? data : new URLSearchParams(data) });
  const context = { next: async input => Response.json(Object.fromEntries(await input.formData())) };
  assert.deepEqual(await (await formTraffic(request(quote), context)).json(), quote);
  assert.equal((await formTraffic(request({ ...quote, 'bot-field': 'bot' }), context)).status, 400);
  assert.equal((await formTraffic(request({ ...quote, details: 'x'.repeat(50_000) }), context)).status, 413);
  assert.equal((await formTraffic(request(quote, { Origin: 'https://other.example' }), context)).status, 403);
  assert.deepEqual(contactLinks({ phone: '+1 (202) 555-0142', email: 'quote+test@example.com' }), {
    call: 'tel:+12025550142', sms: 'sms:+12025550142', mail: 'mailto:quote%2Btest@example.com',
  });
  assert.equal(contactLinks({ email: 'a@example.com?bcc=x@example.com' }).mail, '');
});

test('pickup scans recover from an empty day and send a separate notice only for later bookings', async () => {
  const storage = memory();
  const settings = { quotes: false, pickups: true, from: 'alerts@example.com', to: 'owner@example.com', admin: 'https://towing.example/admin/' };
  const delivered = [];
  const run = date => runNotifications(settings, {
    now: Date.parse(date), storage, deliver: async (message, key) => { delivered.push({ text: message.text, key }); },
  });
  await run('2026-11-22T13:00:00Z');
  assert.equal(delivered.length, 0);
  const key = 'mail/pickups/2026-11-22';
  await storage.write(key, { empty: true }, null);
  await storage.write('enquiry/first', { status: 'Booked', scheduledDate: '2026-11-23' }, null);
  await Promise.all([run('2026-11-22T18:00:00Z'), run('2026-11-22T18:00:00Z')]);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].text, /1 confirmed pickup on 2026-11-23/);
  await storage.write('enquiry/late', { status: 'Booked', scheduledDate: '2026-11-23' }, null);
  await run('2026-11-23T02:15:00Z');
  await run('2026-11-23T02:30:00Z');
  assert.equal(delivered.length, 2);
  assert.match(delivered[1].text, /1 additional confirmed pickup on 2026-11-23/);
  assert.notEqual(delivered[1].key, delivered[0].key);
});

test('quote retry rows share one export entry and previously issued job numbers stay searchable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rs-double-quote-test-'));
  const previousDir = process.cwd(), previousDev = process.env.NETLIFY_DEV;
  process.chdir(directory);
  process.env.NETLIFY_DEV = 'true';
  try {
    const original = { id: 'provider-original', form_name: 'quote-request', created_at: '2026-11-21T16:00:00Z', data: quote };
    const retry = { ...original, id: 'provider-retry', created_at: '2026-11-21T17:00:00Z' };
    const legacy = { ...original, id: 'legacy-job', data: { ...quote, request_id: 'invalid' } };
    const other = { ...legacy, id: 'other-job' };
    await writeRecord('local-submissions', [retry, other, legacy, original], null);
    const issued = await assignJobNumbers([retry, original]);
    await writeRecord('enquiry/' + retry.id, { status: 'Booked', scheduledDate: '2026-11-23', note: 'Booking belongs to the retry row' }, null);
    const response = await owner(new Request('http://localhost:8888/.netlify/functions/owner?action=list'));
    const { items } = await response.json();
    assert.equal(items.length, 3);
    assert.deepEqual(items.find(item => item.id === retry.id).duplicateIds, [original.id]);
    assert.deepEqual(items.find(item => item.id === retry.id).jobNumberAliases, [issued.get(original.id)]);
    assert.equal(items.find(item => item.id === retry.id).state.status, 'Booked');
    assert.equal((await readRecord('local-submissions')).data.length, 4);
    const exportUrl = new URL('http://localhost:8888/.netlify/functions/owner?action=export');
    exportUrl.searchParams.set('search', issued.get(original.id));
    const csv = await (await owner(new Request(exportUrl))).text();
    assert.equal(csv.split('\r\n').length, 2);
    assert.ok(csv.includes(issued.get(retry.id)));
  } finally {
    process.chdir(previousDir);
    if (previousDev == null) delete process.env.NETLIFY_DEV;
    else process.env.NETLIFY_DEV = previousDev;
    await rm(directory, { recursive: true, force: true });
  }
});
