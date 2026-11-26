import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { enqueueQuote, deliverNotification, quoteAlertSummary } from '../netlify/lib/notification-mail.mjs';
import { canUseAction } from '../netlify/lib/owner-access.mjs';
import { readRecoveredSubmissions, openSubmissionArchive } from '../netlify/lib/submission-archive.mjs';
import { submissionBackups } from '../netlify/lib/submission-backups.mjs';
import { publishedOrigin, siteDiscovery } from '../scripts/site-discovery.mjs';
import { Enquiries } from '../src/admin/enquiries/index.ts';

function store() {
  const entries = new Map();
  return {
    entries,
    read: async key => structuredClone(entries.get(key) ?? { data: null, revision: null }),
    write: async (key, data, revision) => {
      if ((entries.get(key)?.revision ?? null) !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
      const saved = { data, revision: randomUUID() };
      entries.set(key, structuredClone(saved));
      return saved;
    },
  };
}

const quote = {
  'form-name': 'quote-request', name: 'Fixture customer', pickup: 'Charlotte, NC', dropoff: 'Raleigh, NC',
  phone: '202-555-0100', service: 'Scheduled vehicle hauling', pickup_timing: 'Flexible', details: 'Test load',
};
const created_at = '2026-11-22T14:00:00.000Z';

test('quote email counts include limit skips once and separate pending and failed deliveries', async () => {
  const storage = store();
  const settings = { quotes: true, admin: 'https://admin.example.org/admin/', to: 'owner@example.org', from: 'alerts@example.org' };
  const now = Date.parse(created_at);
  const accepted = [];
  for (let index = 0; index < 25; index++) accepted.push(await enqueueQuote({ ...quote, request_id: randomUUID() }, settings, now, storage));
  const overflow = { ...quote, request_id: randomUUID() };
  await Promise.all([enqueueQuote(overflow, settings, now, storage), enqueueQuote(overflow, settings, now, storage)]);
  await enqueueQuote({ ...quote, request_id: randomUUID() }, settings, now, storage);
  await deliverNotification(accepted[0].key, accepted[0].id, settings, { storage, now, deliver: async () => {} });
  let result = await quoteAlertSummary({ settings, now, storage });
  assert.deepEqual(result.today, { date: '2026-11-22', sent: 1, pending: 24, failed: 0, skipped: 2, lowerBound: false });
  result = await quoteAlertSummary({ settings, now: now + 24 * 60 * 60_000, storage });
  assert.deepEqual(result.previous, { date: '2026-11-22', sent: 1, pending: 0, failed: 24, skipped: 2, lowerBound: false });
});

test('encrypted backups restore original form rows once and retain newer live data', async () => {
  const storage = store();
  const key = Buffer.alloc(32, 101);
  const owner = { roles: ['owner'] };
  const staff = { roles: ['staff'] };
  assert.equal(canUseAction(owner, 'backups', 'POST'), true);
  assert.equal(canUseAction(staff, 'backups', 'GET'), false);
  assert.equal(canUseAction(staff, 'backup-download', 'GET'), false);
  const original = { id: 'quote-1', form_name: 'quote-request', created_at, data: quote };
  const review = { id: 'review-1', form_name: 'customer-review', created_at,
    data: { 'form-name': 'customer-review', review: 'Fictional private review', rating: '4', 'publish-permission': '' } };
  let source = [original, review];
  const backups = submissionBackups({ key, ...storage, now: () => new Date(created_at), originals: async () => source });
  const morning = await backups.capture(null, { scheduled: true });
  assert.deepEqual(await backups.status(), { enabled: true, copies: [morning] });
  const archive = JSON.parse(await (await backups.download(morning.id)).text());
  assert.doesNotMatch(JSON.stringify([...storage.entries]), /Fixture customer|Fictional private review|202-555-0100/);
  assert.throws(() => openSubmissionArchive(archive, Buffer.alloc(32, 2), 'submission-backups/archive/' + morning.id), { status: 409 });
  assert.throws(() => openSubmissionArchive({ ...archive, info: { ...archive.info, reviews: 5 } }, key, 'submission-backups/archive/' + morning.id), { status: 409 });
  source = [{ ...original, data: { ...quote, details: 'Newer live value' } }];
  assert.deepEqual(await backups.restore(null, morning.id), { restored: 1 });
  assert.deepEqual(await readRecoveredSubmissions(key, storage.read), [review]);
  assert.equal(source[0].data.details, 'Newer live value');
  assert.deepEqual(await backups.restore(null, morning.id), { restored: 0 });
  assert.deepEqual(await backups.capture(null, { scheduled: true }), morning);
  const manual = await backups.capture(null);
  assert.equal(manual.reviews, 1, 'a new copy includes the recovered original');
});

test('production discovery uses the configured origin and omits admin and receipt URLs', () => {
  assert.equal(publishedOrigin({ CONTEXT: 'deploy-preview', URL: 'https://preview.example.org' }), '');
  assert.throws(() => publishedOrigin({ CONTEXT: 'production', URL: 'http://jobs.example.org' }));
  const origin = publishedOrigin({ CONTEXT: 'production', URL: 'https://default.example.org', RS_CANONICAL_URL: 'https://jobs.example.org' });
  const generated = siteDiscovery(origin);
  assert.match(generated.sitemap, /https:\/\/jobs\.example\.org\/reviews\//);
  assert.doesNotMatch(generated.sitemap, /quote-sent|review-sent|\/admin/);
  assert.match(generated.robots, /https:\/\/jobs\.example\.org\/sitemap\.xml/);
  assert.match(generated.metadata[0].markup, /application\/ld\+json/);
  assert.match(generated.metadata[0].markup, /\+12392465837/);
});

test('enquiries page the rendered rows while search and old job links cover all rows', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://admin.example.org/admin/' });
  const browserGlobals = ['document', 'window', 'Option'];
  const previous = new Map(browserGlobals.map(name => [name, globalThis[name]]));
  for (const name of browserGlobals) globalThis[name] = dom.window[name];
  const $ = query => document.querySelector(query);
  const selected = [];
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  $('#owner-signin').hidden = true;
  $('#owner-workspace').hidden = false;
  $('#owner-enquiries').hidden = false;
  try {
    const list = new Enquiries({
      date: value => value, shortDate: value => value, time: value => value, canRestore: () => false,
      onHistory: async () => {}, onSave: async () => {}, onSaved() {},
      onSelect(item, compact) { selected.push([item.id, compact]); },
      onBack() { list.showInbox(true); }, onError() {},
    });
    list.setItems(Array.from({ length: 51 }, (_, index) => ({
      id: 'job-' + index, jobNumber: 'RS-202611-TOW-' + String(index + 1).padStart(4, '0'), form_name: 'quote-request',
      created_at: new Date(Date.parse(created_at) - index * 60_000).toISOString(), data: { ...quote, name: 'Fixture ' + index },
    })));
    assert.equal($('#enquiry-workspace').dataset.enquiryPane, 'list');
    assert.equal($('.enquiry-row').hasAttribute('aria-pressed'), false);
    assert.equal(document.querySelectorAll('.enquiry-row').length, 25);
    assert.equal($('#enquiry-result-count').textContent, '51');
    $('#enquiry-next').click();
    assert.equal($('#enquiry-page-status').textContent, 'Page 2 of 3');
    assert.ok(list.openNumber('RS-202611-TOW-0051'));
    assert.equal($('#enquiry-workspace').dataset.enquiryPane, 'detail');
    list.showInbox();
    assert.equal($('#enquiry-page-status').textContent, 'Page 3 of 3');
    assert.equal(document.querySelectorAll('.enquiry-row').length, 1);
    $('#enquiry-search').value = 'Fixture 0';
    $('#enquiry-search').dispatchEvent(new dom.window.Event('input'));
    assert.equal($('#enquiry-pagination').hidden, true);
    assert.equal($('.enquiry-row').dataset.enquiryId, 'job-0');
    document.documentElement.scrollTop = 320;
    $('.enquiry-row').click();
    assert.deepEqual(selected, [['job-0', true]]);
    assert.equal($('#enquiry-workspace').dataset.enquiryPane, 'detail');
    assert.equal(document.activeElement, $('#enquiry-detail .record-heading h3'));
    assert.equal(document.documentElement.scrollTop, 0);
    $('#enquiry-tab-2').click();
    $('#owner-field-note').value = 'Preserve this draft';
    $('#owner-field-note').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    $('#enquiry-list-back').click();
    assert.equal($('#enquiry-workspace').dataset.enquiryPane, 'list');
    assert.equal($('#enquiry-search').value, 'Fixture 0');
    assert.equal(document.activeElement, $('.enquiry-row'));
    assert.equal(document.documentElement.scrollTop, 320);
    $('.enquiry-row').click();
    $('#enquiry-tab-2').click();
    assert.equal($('#owner-field-note').value, 'Preserve this draft');
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
    dom.window.close();
  }
});
