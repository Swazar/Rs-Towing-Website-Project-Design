import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createWorkspaceEmail } from '../netlify/functions/workspace-email.mjs';
import { gmailReadScope, reconnectGmail } from '../netlify/lib/gmail-account.mjs';
import { listGmailThreads, readGmailThread } from '../netlify/lib/gmail-inbox.mjs';
import { readableMailHtml } from '../netlify/lib/gmail-content.mjs';
import { formattedMail } from '../netlify/lib/gmail-formatted.mjs';
import { WorkspaceEmail } from '../src/admin/email.ts';
import { mailReadingBody, mailVisualPreview } from '../src/admin/gmail-reading.ts';

const origin = 'https://workspace.example';
const route = origin + '/.netlify/functions/workspace-email';
const account = { subject: 'linked-google-subject', email: 'owner@workspace.example' };
const id = 'test-thread';
const summary = { id, subject: 'Pickup arrangements', from: 'Test sender', at: 1760000000000, unread: true, snippet: 'Can we move it Friday?' };

test('existing links require consent for inbox access and the grant is private and bound to the linked account', async () => {
  let record = { data: { account, pending: null }, revision: 'original' };
  let user = { id: 'owner', roles: ['owner'] };
  let approvedAccount = { ...account, subject: 'wrong-account' };
  let revoked = false;
  let expired = false;
  const email = createWorkspaceEmail({
    authenticate: async () => user,
    settingsFor: () => ({ clientId: 'client', redirectUri: route, tokenKey: Buffer.alloc(32, 7) }),
    read: async () => record,
    write: async (_key, data, revision) => {
      assert.equal(revision, record.revision);
      record = { data, revision: revision + 'x' };
      return record;
    },
    permitInbox: async () => ({ account: approvedAccount, refreshToken: 'test-refresh-token' }),
    renew: async (_settings, token) => {
      assert.equal(token, 'test-refresh-token');
      if (expired) throw reconnectGmail();
      return 'test-access-token';
    },
    list: async (token, query) => {
      assert.equal(token, 'test-access-token');
      assert.deepEqual(query, { q: 'pickup Friday', page: '', folder: 'inbox' });
      return { threads: [summary], nextPage: 'next' };
    },
    revoke: async token => { assert.equal(token, 'test-refresh-token'); revoked = true; return true; },
  });
  const status = () => email(new Request(route + '?action=status'));
  const post = (action, body = {}) => email(new Request(route + '?action=' + action, {
    method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body),
  }));
  const approve = async (linked = true) => {
    const response = await post('enable-inbox');
    const target = new URL((await response.json()).authorizationUrl);
    assert.deepEqual(target.searchParams.get('scope').split(' '), ['openid', 'email', gmailReadScope]);
    assert.equal(target.searchParams.get('access_type'), 'offline');
    assert.equal(target.searchParams.get('login_hint'), linked ? account.email : null);
    const callback = new URL(route);
    callback.searchParams.set('state', target.searchParams.get('state'));
    callback.searchParams.set('code', 'test-code');
    return email(new Request(callback, { headers: { Cookie: response.headers.get('Set-Cookie').split(';')[0] } }));
  };
  assert.equal((await (await status()).json()).inboxConnected, false);
  assert.equal((await post('inbox')).status, 409);
  assert.match((await approve()).headers.get('Location'), /wrong-account/);
  assert.equal(record.data.grant, undefined);
  approvedAccount = account;
  assert.match((await approve()).headers.get('Location'), /inbox-ready/);
  assert.equal(record.data.grant.version, 1);
  assert.doesNotMatch(JSON.stringify(record), /test-refresh-token|test-access-token/);
  assert.deepEqual(await (await status()).json(), { available: true, account: { email: account.email }, inboxAvailable: true, inboxConnected: true });
  assert.equal((await post('thread', { id: '../../settings' })).status, 400);
  assert.deepEqual(await (await post('inbox', { q: 'pickup Friday' })).json(), { threads: [summary], nextPage: 'next' });
  user = { id: 'staff', roles: ['staff'] };
  assert.equal((await post('inbox')).status, 403);
  user = { id: 'owner', roles: ['owner'] };
  expired = true;
  assert.equal((await (await post('inbox')).json()).code, 'gmail-reconnect');
  assert.equal((await post('disconnect')).status, 200);
  assert.equal(record.data, null);
  assert.equal(revoked, true);
  assert.match((await approve(false)).headers.get('Location'), /inbox-ready/);
  assert.equal((await (await status()).json()).inboxConnected, true);
});

test('Gmail search forwards pagination and message reading preserves safe links and attachment names', async () => {
  const header = (name, value) => ({ name, value });
  const encode = content => Buffer.from(content).toString('base64url');
  const main = {
    id: 'test-message', internalDate: '1760000000000', labelIds: ['UNREAD'],
    payload: {
      headers: [header('From', 'Test sender'), header('To', 'Test recipient'), header('Subject', summary.subject)],
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { data: encode('<p style="display:none">Preheader</p><p>Pickup &amp; <strong>delivery</strong></p><script>alert(1)</script><img src="https://tracking.example/pixel"><a href="https://notice.example/status" onclick="alert(1)">Details</a><a href="java&#x73;cript:alert(1)">Unsafe label</a>') } },
        { mimeType: 'text/plain', filename: 'file.txt', body: { size: 3277, data: encode('Private attachment') } },
        { mimeType: 'image/png', filename: 'inline.png', headers: [header('Content-Disposition', 'INLINE')], body: { size: 600 } },
      ],
    },
  };
  const fetcher = async (url, options) => {
    assert.equal(url.host, 'gmail.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (url.pathname.endsWith('/threads')) {
      assert.equal(url.searchParams.get('q'), 'from:test@example.org');
      assert.equal(url.searchParams.get('labelIds'), null);
      assert.equal(url.searchParams.get('pageToken'), 'current-page');
      return Response.json({ threads: [{ id, snippet: 'Pickup &amp; delivery' }], nextPageToken: 'next' });
    }
    assert.equal(url.pathname, '/gmail/v1/users/me/threads/' + id);
    assert.match(url.searchParams.get('format'), /^(metadata|full)$/);
    return Response.json({ id, messages: [main] });
  };
  const list = await listGmailThreads('test-token', { q: 'from:test@example.org', page: 'current-page' }, fetcher);
  assert.equal(list.nextPage, 'next');
  assert.deepEqual(list.threads, [{ ...summary, snippet: 'Pickup & delivery' }]);
  const detail = await readGmailThread('test-token', id, fetcher);
  assert.match(detail.messages[0].body, /Pickup & delivery[\s\S]*Details/);
  assert.doesNotMatch(detail.messages[0].body, /alert|https?:|Private attachment/);
  assert.deepEqual(detail.messages[0].attachments, [{ name: 'file.txt', size: 3277 }]);
  const serialized = JSON.stringify(detail.messages[0].content);
  assert.match(serialized, /https:\/\/notice\.example\/status/);
  assert.doesNotMatch(serialized, /tracking|script:|onclick|Preheader/);
  assert.equal(detail.messages[0].formatted.hasImages, true);
  assert.match(detail.messages[0].formatted.html, /Pickup &amp; <strong>delivery<\/strong>/);
  const dom = new JSDOM('');
  try {
    const message = detail.messages[0];
    const body = mailReadingBody(dom.window.document, message.body, message.content);
    const [link] = [...body.querySelectorAll('a')];
    assert.equal(body.querySelectorAll('a').length, 1);
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noreferrer/);
    assert.equal(link.href, 'https://notice.example/status');
    assert.equal(link.textContent, 'Details');
    assert.match(link.getAttribute('aria-label'), /Details.*notice\.example/);
    assert.equal(body.querySelector('strong').textContent, 'delivery');
    assert.equal(body.querySelector('img,script,[onclick]'), null);
    const text = mailReadingBody(dom.window.document, 'See (https://docs.example/Guide_(delivery)).\n\nIgnore https://docs.example@untrusted.example/');
    assert.equal(text.querySelectorAll('a').length, 1);
    assert.equal(text.querySelector('a').href, 'https://docs.example/Guide_(delivery)');
    assert.equal(text.querySelectorAll('p').length, 2);
  } finally { dom.window.close(); }
  await assert.rejects(listGmailThreads('test-token', { q: '', page: '' }, async url => {
    assert.equal(url.searchParams.get('labelIds'), 'INBOX');
    return Response.json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 });
  }), { status: 424 });
  for (const [folder, labels] of [['unread', ['INBOX', 'UNREAD']], ['starred', ['STARRED']], ['sent', ['SENT']], ['all', []]]) {
    await listGmailThreads('test-token', { q: '', page: '', folder }, async url => {
      assert.deepEqual(url.searchParams.getAll('labelIds'), labels);
      return Response.json({ threads: [] });
    });
  }
  await listGmailThreads('test-token', { q: '', page: '', folder: 'attachments' }, async url => {
    assert.equal(url.searchParams.get('q'), 'has:attachment');
    return Response.json({ threads: [] });
  });
  const read = await listGmailThreads('test-token', { q: '', page: '', folder: 'read' }, async url => {
    if (url.pathname.endsWith('/threads')) {
      assert.equal(url.searchParams.get('q'), 'is:read');
      assert.deepEqual(url.searchParams.getAll('labelIds'), ['INBOX']);
      return Response.json({ threads: [{ id }, { id: 'read-thread' }] });
    }
    const isRead = url.pathname.endsWith('/read-thread');
    return Response.json({ id: isRead ? 'read-thread' : id, messages: [{ ...main, labelIds: [] }, ...(isRead ? [] : [main])] });
  });
  assert.deepEqual(read.threads.map(thread => thread.id), ['read-thread']);
});

test('newsletter formatting drops empty scaffolding and keeps named links and true data tables', () => {
  const layout = [
    '<table role="presentation"><tr><td><table><tr><td> &nbsp; </td></tr></table></td></tr>',
    '<tr><td><a href="https://mail.example/hidden-image"><img src="https://mail.example/pixel"></a></td>',
    '<td><a href="https://mail.example/jobs"><img alt="Browse jobs"></a></td>',
    '<td><a href="https://mail.example/alerts">Manage alerts</a></td></tr>',
    '<tr><td colspan="3"><table><caption>Quote details</caption>',
    '<tr><th>Service</th><th>Amount</th></tr><tr><td>Towing</td><td>$120</td></tr>',
    '</table></td></tr></table>',
  ].join('');
  const preview = readableMailHtml([layout]);
  const dom = new JSDOM('');
  try {
    const body = mailReadingBody(dom.window.document, '', preview.content);
    assert.equal(preview.truncated, true, 'image-based links should offer the original message as an option');
    assert.equal(body.querySelectorAll('table').length, 1);
    assert.equal(body.querySelector('caption').textContent, 'Quote details');
    assert.equal(body.querySelector('th').textContent, 'Service');
    assert.equal(body.querySelector('img'), null);
    assert.deepEqual([...body.querySelectorAll('a')].map(link => [link.textContent, link.pathname]),
      [['Browse jobs', '/jobs'], ['Manage alerts', '/alerts']]);
    assert.doesNotMatch(JSON.stringify(preview), /hidden-image|pixel/);
    const empty = readableMailHtml(['<table><tr><td><div><br></div></td></tr></table>']);
    assert.deepEqual(empty.content, []);
  } finally { dom.window.close(); }
});

test('image-heavy newsletters open as a compact preview with distinct links', () => {
  const tiles = Array.from({ length: 4 }, (_, index) =>
    '<table role="presentation"><tr><td><a href="https://mail.example/deal/' + index +
    '"><img src="https://assets.example/image.png" alt="Black Friday Deal"></a></td></tr></table>').join('');
  const original = 'https://mail.google.com/mail/#all/example';
  const newsletter = readableMailHtml([tiles + '<p><a href="https://mail.example/sale">Browse the sale</a></p>']);
  const dom = new JSDOM('');
  try {
    assert.equal(newsletter.imageHeavy, true);
    const preview = mailVisualPreview(dom.window.document, {
      summary: 'See the sale https://mail.example/tracking', content: newsletter.content,
    }, original);
    assert.equal(preview.querySelector('.gmail-original-link').href, original);
    assert.equal(preview.querySelector('details'), null);
    assert.equal(preview.querySelector('.gmail-message-body'), null);
    assert.deepEqual([...preview.querySelectorAll('ul a')].map(link => link.href), ['https://mail.example/sale']);
    assert.doesNotMatch(preview.textContent, /Black Friday Deal|\/tracking/);
    assert.equal(readableMailHtml(['<p>Pickup at noon</p><img src="https://mail.example/logo.png">']).imageHeavy, false);
  } finally { dom.window.close(); }
});

test('the formatted reader shows images by default and remembers when a mailbox blocks them', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: origin + '/admin/#email' });
  const document = dom.window.document;
  const $ = selector => document.querySelector(selector);
  const formatted = formattedMail([
    '<table align="center" role="presentation" width="580" style="background:#f3f4f5"><tr><td style="padding:24px;background-image:url(https://example.org/tracker)">',
    '<h2>Dispatch update</h2><a href="https://example.org/jobs" onclick="bad()">See jobs</a>',
    '<img src="https://cdn.example.org/banner.png" alt="Dispatch" width="500" srcset="https://example.org/tracker 2x" onload="bad()">',
    '<img src="https://cdn.example.org/pixel.png" width="1" height="1">',
    '<img src="https://127.0.0.1/private"><a href="java&#115;cript:bad()">Invalid link</a>',
    '<script>bad()</script><form action="https://example.org"><input></form><iframe src="https://example.org"></iframe>',
    '<span style="display:none">Inbox preheader</span></td></tr></table>',
  ].join('').split('\n'));
  assert.equal(formatted.hasImages, true);
  assert.match(formatted.html, /<table[^>]*width="580"[^>]*align="center"/);
  assert.match(formatted.html, /<td style="padding:24px">/);
  assert.doesNotMatch(formatted.html, /tracker|pixel\.png|<script|<iframe|<form|onload|onclick|javascript:|127\.0\.0\.1|Inbox preheader/);
  assert.equal(formattedMail(['<p>' + 'x'.repeat(100_000) + '</p>']), null);

  let linkedAccount = account;
  const view = new WorkspaceEmail($('#owner-email-view'), async action => {
    if (action === 'email-status') return { available: true, account: linkedAccount, inboxAvailable: true, inboxConnected: true };
    if (action === 'email-inbox') return { threads: [summary], nextPage: null };
    return { id, subject: summary.subject, earlier: 0,
      messages: [{ ...summary, body: 'Plain dispatch update', to: 'Dispatch', formatted, previewOnly: true }] };
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    view.setActive(true);
    await settle();
    $('#gmail-threads button').click();
    await settle();
    const frame = $('#gmail-reader iframe');
    assert.ok(frame);
    assert.equal($('#gmail-list-panel').hidden, true);
    assert.equal($('#gmail-reader').hidden, false);
    assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-scripts|allow-forms|allow-top-navigation/);
    assert.match(frame.srcdoc, /img-src data: https:/);
    assert.match(frame.srcdoc, /<img [^>]* src="https:\/\/cdn.example.org\/banner.png"/);
    assert.match(frame.srcdoc, /href="https:\/\/example.org\/jobs"[^>]+target="_blank" rel="noopener noreferrer"/);
    assert.equal($('.gmail-formatted button'), null);
    const images = $('#gmail-automatic-images');
    assert.equal($('.gmail-message-details button'), null);
    assert.equal(images.checked, true);
    images.click();
    assert.match(frame.srcdoc, /img-src data:;/);
    assert.doesNotMatch(frame.srcdoc, /\ssrc=/);
    $('#gmail-back').click();
    assert.equal($('#gmail-list-panel').hidden, false);
    assert.equal($('#gmail-reader iframe'), null);
    view.setActive(false);
    linkedAccount = { ...account, email: 'other@workspace.example' };
    view.setActive(true);
    await settle();
    assert.equal(images.checked, true);
    view.setActive(false);
    linkedAccount = account;
    view.setActive(true);
    await settle();
    assert.equal(images.checked, false);
    $('#gmail-threads button').click();
    await settle();
    const reopened = $('#gmail-reader iframe');
    assert.doesNotMatch(reopened.srcdoc, /\ssrc=/);
    images.click();
    assert.match(reopened.srcdoc, /\ssrc=/);
  } finally { dom.window.close(); }
});

test('the reader resolves referenced inline images from Gmail and rejects non-image attachment bytes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XQAAAAASUVORK5CYII=', 'base64');
  const svg = Buffer.from('<svg onload="bad()"></svg>');
  const header = (name, value) => ({ name, value });
  const embedded = (cid, body, mimeType = 'image/png') => ({
    mimeType, headers: [header('Content-ID', '<' + cid + '>')], filename: 'graphic.png', body,
  });
  const markup = '<img src="cid:photo%40test" alt="Photo"><img src="cid:signature@test" alt="Signature">' +
    '<img src="cid:bad@test"><img src="cid:svg@test">';
  const message = { id: 'test-message', internalDate: '1760000000000', payload: { mimeType: 'multipart/related', parts: [
    { mimeType: 'text/html', body: { data: Buffer.from(markup).toString('base64url') } },
    embedded('photo@test', { attachmentId: 'image-attachment', size: png.length }),
    embedded('signature@test', { data: png.toString('base64url') }),
    embedded('bad@test', { data: svg.toString('base64url') }),
    embedded('svg@test', { attachmentId: 'blocked-attachment', size: svg.length }, 'image/svg+xml'),
    embedded('unused@test', { attachmentId: 'unused-attachment', size: png.length }),
  ] } };
  const result = await readGmailThread('test-token', id, async url => {
    if (url.pathname.endsWith('/threads/' + id)) return Response.json({ messages: [message] });
    assert.equal(url.pathname, '/gmail/v1/users/me/messages/test-message/attachments/image-attachment');
    return Response.json({ size: png.length, data: png.toString('base64url') });
  });
  const { formatted, attachments } = result.messages[0];
  assert.equal(formatted.hasImages, false, 'attached pictures do not require external images');
  assert.equal(formatted.html.match(/src="data:image\/png;base64,/g).length, 2);
  assert.doesNotMatch(formatted.html, /data:image\/svg|onload|<svg|cid:(?:svg|unused)/);
  assert.equal(attachments, undefined);
});

test('the inbox searches, opens conversations as text, and shows reconnect when access expires', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: origin + '/admin/#email' });
  const document = dom.window.document;
  const $ = selector => document.querySelector(selector);
  const queries = [];
  let expired = false;
  const nextId = 'next-test-thread';
  const view = new WorkspaceEmail($('#owner-email-view'), async (action, data) => {
    if (action === 'email-status') return { available: true, account, inboxAvailable: true, inboxConnected: true };
    if (action === 'email-inbox') {
      queries.push(data);
      if (expired) throw reconnectGmail();
      return { threads: [summary, { ...summary, id: nextId, subject: 'Another conversation' }], nextPage: null };
    }
    assert.equal(action, 'email-thread');
    assert.ok([id, nextId].includes(data.id));
    return { id: data.id, subject: data.id === id ? summary.subject : 'Another conversation', earlier: 0,
      messages: [{ ...summary, to: 'Dispatch', cc: 'Operations', attachments: [{ name: '<Badge>.pdf', size: 700 }], body: '<img src=x onerror=alert(1)>', previewOnly: true }] };
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    $('#owner-workspace').hidden = false;
    $('#owner-email-view').hidden = false;
    view.setActive(true);
    await settle();
    $('[data-inbox-filter="read"]').click();
    await settle();
    assert.equal($('[data-inbox-filter="read"]').getAttribute('aria-pressed'), 'true');
    assert.equal($('[data-mail-folder="inbox"]').getAttribute('aria-current'), 'page');
    $('[data-mail-folder="sent"]').click();
    await settle();
    assert.equal($('#gmail-list-heading').textContent, 'Sent');
    assert.equal($('[data-mail-folder="sent"]').getAttribute('aria-current'), 'page');
    assert.equal($('#gmail-inbox-filters').hidden, true);
    $('#gmail-search-query').value = 'pickup Friday';
    $('#gmail-search').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.deepEqual(queries, [
      { q: '', page: '', folder: 'inbox' },
      { q: '', page: '', folder: 'read' },
      { q: '', page: '', folder: 'sent' },
      { q: 'pickup Friday', page: '', folder: 'sent' },
    ]);
    assert.equal(document.querySelector('[data-mail-folder][aria-current]'), null);
    $('#gmail-threads button').click();
    await settle();
    assert.equal($('#gmail-thread-heading').textContent, summary.subject);
    assert.match($('#gmail-messages').textContent, /<img src=x/);
    assert.equal($('#gmail-messages img'), null);
    assert.equal(new URL($('#gmail-open-thread').href).hostname, 'mail.google.com');
    assert.equal($('.gmail-original-link').href, $('#gmail-open-thread').href);
    assert.equal($('.gmail-attachments strong').textContent, '<Badge>.pdf');
    assert.equal($('.gmail-file-type').textContent, 'PDF');
    assert.match($('.gmail-message-details').textContent, /CcOperations/);
    assert.equal($('#gmail-previous-thread').disabled, true);
    $('#gmail-next-thread').click();
    await settle();
    assert.equal($('#gmail-thread-heading').textContent, 'Another conversation');
    assert.equal($('#gmail-next-thread').disabled, true);
    $('#gmail-previous-thread').click();
    await settle();
    assert.equal($('#gmail-thread-heading').textContent, summary.subject);
    $('#gmail-back').click();
    assert.equal($('#gmail-reader').hidden, true);
    assert.equal(document.activeElement, $('#gmail-threads button'));
    expired = true;
    $('#gmail-refresh').click();
    await settle();
    assert.equal($('#gmail-mailbox').hidden, true);
    assert.equal($('#gmail-enable-inbox').textContent, 'Reconnect inbox');
    assert.equal($('#gmail-messages').textContent, '');
  } finally { dom.window.close(); }
});
