import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createWorkspaceEmail } from '../netlify/functions/workspace-email.mjs';
import { digest, gmailReadScope, gmailSendAccess, gmailSendScope } from '../netlify/lib/gmail-account.mjs';
import { buildGmailMessage, outgoingMail, sendGmailMessage } from '../netlify/lib/gmail-send.mjs';
import { protectGmailToken } from '../netlify/lib/gmail-token.mjs';
import { WorkspaceEmail } from '../src/admin/email.ts';

const origin = 'https://workspace.example';
const route = origin + '/.netlify/functions/workspace-email';
const account = { subject: 'test-google-subject', email: 'dispatch@example.org' };
const receipt = { id: 'sent-message', threadId: 'gmail-conversation' };
const draft = () => ({
  requestId: randomUUID(), to: ['test-recipient@example.org'], cc: [], bcc: ['private-copy@example.org'],
  subject: 'Pickup confirmation', text: 'We can pick it up at 3 PM.',
  attachments: [{ name: 'notes.txt', data: Buffer.from('Synthetic attachment').toString('base64') }],
});

test('Gmail receives MIME with recipients, attachments, and headers derived from the original reply', async () => {
  const request = { ...draft(), reply: { threadId: receipt.threadId, messageId: 'original-message' } };
  const fixtures = [
    { name: 'Subject', value: 'Pickup time' }, { name: 'Message-ID', value: '<parent@example.org>' },
    { name: 'References', value: '<earlier@example.org>' },
  ];
  const message = await buildGmailMessage('fake-access-token', account.email, outgoingMail(request), async (url, options) => {
    assert.equal(url.pathname, '/gmail/v1/users/me/messages/original-message');
    assert.equal(url.searchParams.get('format'), 'metadata');
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    return Response.json({ threadId: receipt.threadId, payload: { headers: fixtures } });
  });
  assert.equal(message.threadId, receipt.threadId);
  const mime = Buffer.from(message.raw, 'base64url').toString();
  assert.match(mime, /^From: dispatch@example\.org\r?$/m);
  assert.match(mime, /^To: test-recipient@example\.org\r?$/m);
  assert.match(mime, /^Bcc: private-copy@example\.org\r?$/m);
  assert.match(mime, /^Subject: Re: Pickup time\r?$/m);
  assert.match(mime, /^In-Reply-To: <parent@example\.org>\r?$/m);
  assert.match(mime, /^References: <earlier@example\.org> <parent@example\.org>\r?$/m);
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /filename=notes\.txt/);
  assert.ok(mime.includes(request.attachments[0].data));
  assert.deepEqual(await sendGmailMessage('fake-access-token', message, async (url, options) => {
    assert.equal(url.origin, 'https://gmail.googleapis.com');
    assert.equal(url.pathname, '/gmail/v1/users/me/messages/send');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), message);
    return Response.json(receipt);
  }), receipt);
  await assert.rejects(buildGmailMessage('fake-access-token', account.email, outgoingMail(request),
    async () => Response.json({ threadId: 'different-thread', payload: { headers: fixtures } })), { status: 400 });
  assert.throws(() => outgoingMail({ ...draft(), subject: 'Pickup\r\nBcc: someone@example.org' }), { status: 400 });
  assert.throws(() => outgoingMail({ ...draft(), to: ['a@example.org\r\nBcc: b@example.org'] }), { status: 400 });
  assert.throws(() => outgoingMail({ ...draft(), attachments: [{ name: '../../file.txt', data: 'YQ==' }] }), { status: 400 });
  const encoded = Buffer.alloc(1_600_000).toString('base64');
  assert.throws(() => outgoingMail({ ...draft(), attachments: ['a.pdf', 'b.pdf'].map(name => ({ name, data: encoded })) }), { status: 413 });
});

test('owners grant send access separately and the server prevents duplicate delivery', async () => {
  const key = 'gmail-account/' + digest('test-owner');
  const settings = { clientId: 'client', clientSecret: 'secret', tokenKey: Buffer.alloc(32, 21), redirectUri: route };
  const grant = protectGmailToken(settings.tokenKey, key + '/' + account.subject, 'fake-refresh-token');
  const records = new Map([[key, { data: { account, grant }, revision: '1' }]]);
  let sequence = 1;
  let role = 'owner';
  let decision = 'deny';
  let delivery = 0;
  let mode = 'wait';
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const handler = createWorkspaceEmail({
    authenticate: async () => ({ id: 'test-owner', roles: [role] }),
    settingsFor: () => settings,
    read: async record => records.get(record) ?? { data: null, revision: null },
    write: async (record, data, revision) => {
      if ((records.get(record)?.revision ?? null) !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
      const saved = { data, revision: String(++sequence) };
      records.set(record, saved);
      return saved;
    },
    permitInbox: async () => ({
      account: decision === 'wrong' ? { ...account, subject: 'another-mailbox' } : account,
      refreshToken: 'replacement-refresh-token', canSend: decision !== 'deny',
    }),
    renew: async (_settings, token, _fetcher, send) => {
      assert.equal(token, 'replacement-refresh-token');
      assert.equal(send, true);
      return 'fake-access-token';
    },
    send: async () => {
      delivery++;
      if (mode === 'unknown') return sendGmailMessage('fake-access-token', {}, async () => { throw new Error('Timed out'); });
      if (mode === 'revoked') throw gmailSendAccess();
      await hold;
      return receipt;
    },
  });
  const post = (action, body = {}, source = origin) => handler(new Request(route + '?action=' + action, {
    method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const status = async () => (await handler(new Request(route + '?action=status'))).json();
  const approve = async () => {
    const start = await post('enable-send');
    const target = new URL((await start.json()).authorizationUrl);
    const scopes = target.searchParams.get('scope').split(' ');
    assert.ok(scopes.includes(gmailReadScope));
    assert.ok(scopes.includes(gmailSendScope));
    const finish = new URL(route);
    finish.searchParams.set('state', target.searchParams.get('state'));
    finish.searchParams.set('code', 'fake-code');
    return handler(new Request(finish, { headers: { Cookie: start.headers.get('Set-Cookie').split(';')[0] } }));
  };
  assert.equal((await (await post('send', draft())).json()).code, 'gmail-send-access');
  assert.equal((await post('enable-send', {}, 'https://different.example')).status, 403);
  role = 'staff';
  assert.equal((await post('send', draft())).status, 403);
  role = 'owner';
  assert.match((await approve()).headers.get('Location'), /send-denied/);
  assert.equal((await status()).inboxConnected, true);
  decision = 'wrong';
  assert.match((await approve()).headers.get('Location'), /wrong-account/);
  assert.equal((await status()).sendConnected, undefined);
  decision = 'allow';
  assert.match((await approve()).headers.get('Location'), /send-ready/);
  assert.equal((await status()).sendConnected, true);

  const mail = draft();
  const sending = post('send', mail);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await (await post('send', mail)).json()).code, 'gmail-send-unknown');
  release();
  assert.deepEqual(await (await sending).json(), receipt);
  assert.deepEqual(await (await post('send', mail)).json(), receipt);
  assert.equal(delivery, 1);
  assert.doesNotMatch(JSON.stringify([...records]), /Synthetic attachment|test-recipient@example\.org|replacement-refresh-token|Pickup confirmation/);
  mode = 'unknown';
  const unconfirmed = draft();
  assert.equal((await (await post('send', unconfirmed)).json()).code, 'gmail-send-unknown');
  assert.equal((await (await post('send', unconfirmed)).json()).code, 'gmail-send-unknown');
  assert.equal(delivery, 2);
  mode = 'revoked';
  assert.equal((await (await post('send', draft())).json()).code, 'gmail-send-access');
  assert.equal((await status()).sendConnected, undefined);
  assert.equal((await status()).inboxConnected, true);
});

test('the composer sends files, retains a draft after an uncertain result, and opens a threaded reply', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: origin + '/admin/#email' });
  const { document, File, Event } = dom.window;
  const $ = selector => document.querySelector(selector);
  const dialog = $('#gmail-compose-dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const summary = { id: receipt.threadId, subject: 'Pickup time', from: 'Customer <customer@example.org>', at: Date.now(), unread: false, snippet: 'Tomorrow?' };
  const sends = [];
  let resolveFirst;
  const firstSend = new Promise(resolve => { resolveFirst = resolve; });
  const view = new WorkspaceEmail($('#owner-email-view'), async (action, data) => {
    if (action === 'email-status') return { available: true, account, inboxConnected: true, sendConnected: true };
    if (action === 'email-inbox') return { threads: [summary], nextPage: null };
    if (action === 'email-thread') return { ...summary, earlier: 0, messages: [
      { ...summary, id: 'original-message', to: account.email, replyTo: 'Dispatch replies <reply@example.org>', body: 'Pickup tomorrow?', previewOnly: false },
    ] };
    assert.equal(action, 'email-send');
    sends.push(data);
    if (sends.length === 1) {
      resolveFirst();
      throw Object.assign(new Error('Unknown'), { status: 409, code: 'gmail-send-unknown' });
    }
    return receipt;
  });
  const submit = () => $('#gmail-compose-form').dispatchEvent(new Event('submit', { cancelable: true }));
  try {
    view.setActive(true);
    await settle();
    $('#gmail-compose').click();
    assert.equal(dialog.open, true);
    assert.equal($('#gmail-compose-from').textContent, account.email);
    submit();
    assert.equal(sends.length, 0);
    assert.match($('#gmail-compose-status').textContent, /recipients/);
    $('#gmail-compose-to').value = 'customer@example.org, second@example.org';
    $('#gmail-compose-text').value = 'We can pick it up tomorrow.';
    $('#gmail-compose-copy').click();
    $('#gmail-compose-bcc').value = 'private-copy@example.org';
    const file = $('#gmail-compose-file');
    Object.defineProperty(file, 'files', { value: [new File(['Test file'], 'details.txt')] });
    file.dispatchEvent(new Event('change'));
    assert.match($('#gmail-compose-attachments').textContent, /details\.txt/);
    $('#gmail-compose-close').click();
    $('#gmail-compose').click();
    assert.equal($('#gmail-compose-text').value, 'We can pick it up tomorrow.');
    submit();
    await firstSend;
    await settle();
    assert.equal(dialog.open, true);
    assert.equal($('#gmail-compose-send').textContent, 'Retry safely');
    assert.match($('#gmail-compose-status').textContent, /Gmail Sent/);
    assert.deepEqual(sends[0].attachments, [{ name: 'details.txt', data: Buffer.from('Test file').toString('base64') }]);
    submit();
    await settle();
    assert.deepEqual(sends[0], sends[1]);
    assert.equal(dialog.open, false);
    assert.match($('#gmail-feedback').textContent, /Sent through Gmail/);
    $('#gmail-threads button').click();
    await settle();
    $('.gmail-reply').click();
    assert.equal($('#gmail-compose-to').value, 'reply@example.org');
    assert.equal($('#gmail-compose-subject').value, 'Re: Pickup time');
    assert.equal($('#gmail-compose-subject').readOnly, true);
    $('#gmail-compose-text').value = 'Confirmed.';
    submit();
    await settle();
    assert.deepEqual(sends[2].reply, { threadId: receipt.threadId, messageId: 'original-message' });
  } finally { dom.window.close(); }
});

test('saved drafts are encrypted, revision checked, and cleared after confirmed delivery', async () => {
  const ownerKey = 'gmail-account/' + digest('draft-owner');
  const binding = ownerKey + '/' + account.subject;
  const settings = { tokenKey: Buffer.alloc(32, 22) };
  const grant = protectGmailToken(settings.tokenKey, binding, 'test-refresh-token');
  const records = new Map([[ownerKey, { data: { account, grant, canSend: true }, revision: 'owner-1' }]]);
  let owner = 'draft-owner';
  let deliveries = 0;
  let now = Date.parse('2026-11-22T17:00:00Z');
  const handler = createWorkspaceEmail({
    authenticate: async () => ({ id: owner, roles: ['owner'] }),
    settingsFor: () => settings, now: () => now,
    read: async key => records.get(key) ?? { data: null, revision: null },
    write: async (key, data, revision) => {
      if ((records.get(key)?.revision ?? null) !== revision) throw { status: 409 };
      const saved = { data, revision: randomUUID() };
      records.set(key, saved);
      return saved;
    },
    renew: async () => 'test-access-token',
    send: async () => { deliveries++; return receipt; },
  });
  const get = (action, query = '') => handler(new Request(route + '?action=' + action + query));
  const post = (action, body) => handler(new Request(route + '?action=' + action, {
    method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body),
  }));
  const { draftMailbox: mailbox } = await (await get('status')).json();
  const query = '&mailbox=' + mailbox;
  const outgoing = draft();
  const message = { to: outgoing.to.join(', '), cc: '', bcc: outgoing.bcc.join(', '),
    subject: outgoing.subject, text: outgoing.text, attachments: outgoing.attachments };
  const saved = await post('draft', { mailbox, revision: null, draft: message });
  assert.equal(saved.status, 200);
  const { revision } = await saved.json();
  assert.doesNotMatch(JSON.stringify([...records.values()]), /Pickup confirmation|test-recipient@example\.org|notes\.txt/);
  assert.deepEqual(await (await get('draft', query)).json(), { data: message, revision });
  assert.equal((await post('draft', { mailbox, revision: null, draft: null })).status, 409);
  owner = 'other-owner';
  assert.equal((await get('draft', query)).status, 409);
  owner = 'draft-owner';

  const preparing = await post('draft', { mailbox, revision, draft: { ...message, attempt: { id: outgoing.requestId, at: 0 } } });
  assert.equal(preparing.status, 200);
  const pending = await (await get('draft', query)).json();
  assert.equal(pending.data.attempt.at, now);
  assert.deepEqual(await (await post('send', { ...outgoing, mailbox })).json(), receipt);
  const cleared = await (await get('draft', query)).json();
  assert.equal(cleared.data, null);
  const oldId = randomUUID();
  await post('draft', { mailbox, revision: cleared.revision, draft: { ...message, attempt: { id: oldId } } });
  now += 25 * 60 * 60_000;
  const expired = await post('send', { ...outgoing, mailbox, requestId: oldId });
  assert.equal((await expired.json()).code, 'gmail-send-unknown');
  assert.equal(deliveries, 1);
});

test('the composer restores saved text and attachments in a fresh page and removes a discarded draft', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  let saved = { data: null, revision: null };
  const mailbox = 'test-draft-mailbox';
  const settle = () => new Promise(resolve => setImmediate(resolve));
  async function mount() {
    const dom = new JSDOM(html, { url: origin + '/admin/#email' });
    const { document } = dom.window;
    const $ = selector => document.querySelector(selector);
    const dialog = $('#gmail-compose-dialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    const view = new WorkspaceEmail($('#owner-email-view'), async (action, data, query) => {
      if (action === 'email-status') return { available: true, account, inboxConnected: true, sendConnected: true, draftMailbox: mailbox };
      if (action === 'email-inbox') return { threads: [], nextPage: null };
      assert.equal(action, 'email-draft');
      if (!data) {
        assert.equal(query.mailbox, mailbox);
        return structuredClone(saved);
      }
      assert.equal(data.mailbox, mailbox);
      assert.equal(data.revision, saved.revision);
      saved = { data: data.draft, revision: randomUUID() };
      return saved;
    });
    view.setActive(true);
    await settle();
    $('#gmail-compose').click();
    await settle();
    return { $, dom };
  }
  let page = await mount();
  try {
    const field = page.$('#gmail-compose-text');
    field.value = 'Unfinished pickup confirmation.';
    field.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    const file = page.$('#gmail-compose-file');
    Object.defineProperty(file, 'files', { value: [new page.dom.window.File(['Example PDF'], 'estimate.pdf')] });
    file.dispatchEvent(new page.dom.window.Event('change'));
    page.$('#gmail-compose-save-draft').click();
    for (let tries = 0; tries < 40 && !saved.data; tries++) await settle();
    assert.equal(saved.data.text, 'Unfinished pickup confirmation.');
    assert.equal(saved.data.attachments[0].name, 'estimate.pdf');
    page.dom.window.close();
    page = await mount();
    assert.equal(page.$('#gmail-compose-text').value, saved.data.text);
    assert.match(page.$('#gmail-compose-attachments').textContent, /estimate\.pdf/);
    assert.match(page.$('#gmail-compose-draft-status').textContent, /restored/i);
    page.$('#gmail-compose-discard').click();
    await settle();
    assert.equal(saved.data, null);
    assert.equal(page.$('#gmail-compose-dialog').open, false);
  } finally { page.dom.window.close(); }
});
