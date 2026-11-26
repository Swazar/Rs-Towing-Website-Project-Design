import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { changeReviewPublication, publicHomepageReviews, reviewHomepage } from '../netlify/lib/review-publication.mjs';
import { renderPublishedReviews } from '../public/assets/public-reviews.js';
import { defaults } from '../public/assets/business-defaults.js';
import { validateSettings, validateSubmission, publicReview } from '../netlify/lib/validation.mjs';
import { isLocalPreview, sameOrigin } from '../netlify/lib/store.mjs';

test('only consented, published review fields reach the public response', () => {
  const submission = { created_at: '2026-11-17T12:00:00Z', data: {
    first_name: 'Jamie', email: 'private@example.com', review: 'Original feedback', rating: '4', 'publish-permission': 'yes',
  } };
  assert.equal(publicReview(submission, { publication: 'Unpublished' }), null);
  assert.deepEqual(publicReview(submission, { publication: 'Published' }), {
    name: 'Jamie', quote: 'Original feedback', rating: 4, date: '2026-11-17',
  });
  submission.data['publish-permission'] = '';
  assert.equal(publicReview(submission, { publication: 'Published' }), null);
});

test('homepage selection caps legacy reviews and requires an open slot before publishing', () => {
  const items = [1, 2, 3, 4].map(number => ({
    id: 'original-' + number, form_name: 'customer-review', created_at: '2026-11-17T12:00:00Z',
    data: { first_name: 'Jamie ' + number, email: 'private@example.com', review: 'On time', rating: '5', 'publish-permission': 'yes' },
  }));
  const decisions = Object.fromEntries(items.map(item => [item.id, { publication: 'Published' }]));
  const legacy = { reviews: items.map(item => publicReview(item, decisions[item.id])), decisions };
  const edit = (snapshot, action, records = items) => changeReviewPublication(snapshot, records, action, 'owner').snapshot;
  assert.equal(publicHomepageReviews(null), null);
  assert.deepEqual(reviewHomepage(legacy, items, 'revision').map(review => review.id), ['original-1', 'original-2', 'original-3']);
  assert.equal(publicHomepageReviews(legacy).length, 3);
  assert.throws(() => edit(legacy, { id: 'original-4', publication: 'Published' }), { status: 409 });
  const withSpace = edit(legacy, { id: 'original-2', publication: 'Unpublished' });
  assert.deepEqual(withSpace.reviewIds, ['original-1', 'original-3'], 'a removed slot stays empty');
  assert.equal(withSpace.decisions['original-4'].publication, 'Published', 'legacy history remains available');
  const replaced = edit(withSpace, { id: 'original-4', publication: 'Published' });
  assert.deepEqual(replaced.reviewIds, ['original-1', 'original-3', 'original-4']);
  assert.ok(replaced.reviews.every(review => !Object.hasOwn(review, 'id') && !Object.hasOwn(review, 'email')));
  assert.equal(reviewHomepage(replaced, [], 'revision')[0].revision, 'revision');
  const orphanRemoved = edit(legacy, { slot: 1, publication: 'Unpublished' }, []);
  assert.deepEqual(orphanRemoved.reviews.map(review => review.name), ['Jamie 1', 'Jamie 3']);
  assert.throws(() => edit(legacy, { slot: 3, publication: 'Unpublished' }, []), { status: 400 });
});

test('public visitors see up to three reviews in the selected order', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const list = document.querySelector('[data-review-list]');
    const template = document.querySelector('#review-card');
    const entries = [17, 19, 18, 20].map(day => ({ name: 'Customer ' + day, quote: 'Public feedback', rating: 5, date: '2026-11-' + day }));
    renderPublishedReviews(entries, { list, template });
    assert.deepEqual([...list.querySelectorAll('.review-author')].map(author => author.textContent), ['Customer 17', 'Customer 19', 'Customer 18']);
    assert.equal(document.querySelector('[data-show-reviews]'), null);
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test('website edits reject unsafe contact URLs, arbitrary photos, and notices without expiry', () => {
  assert.equal(validateSettings(structuredClone(defaults)).phone, defaults.phone);
  const unsafe = structuredClone(defaults);
  unsafe.phone = 'javascript:alert(1)';
  assert.throws(() => validateSettings(unsafe), /phone/);
  const photo = structuredClone(defaults);
  photo.gallery[0].src = 'https://untrusted.example/image';
  assert.throws(() => validateSettings(photo), /gallery photo/);
  const notice = structuredClone(defaults);
  notice.availabilityMessage = 'Limited availability this week';
  assert.throws(() => validateSettings(notice), /expiry/);
});

test('local owner bypass cannot activate on a production hostname and mutations require the same origin', () => {
  const previous = process.env.NETLIFY_DEV;
  process.env.NETLIFY_DEV = 'true';
  assert.equal(isLocalPreview(new Request('https://rs.example/admin')), false);
  assert.equal(isLocalPreview(new Request('http://localhost:8888/admin')), true);
  assert.throws(() => sameOrigin(new Request('http://localhost:8888', { headers: { Origin: 'https://evil.example' } })));
  assert.doesNotThrow(() => sameOrigin(new Request('http://localhost:8888', { headers: { Origin: 'http://localhost:8888' } })));
  if (previous === undefined) delete process.env.NETLIFY_DEV; else process.env.NETLIFY_DEV = previous;
});

test('a manual hauling quote survives refresh and failed sends, then confirms success in the same popup', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const catalog = JSON.parse(await readFile(new URL('../public/assets/us-places.json', import.meta.url), 'utf8'));
  let submitted;
  let acceptQuote = false;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('site-content')) return Response.json({ settings: defaults, reviews: [], localPreview: true });
    if (url.endsWith('us-places.json')) return Response.json(catalog);
    if (url.endsWith('local-submission')) {
      submitted = new URLSearchParams(options.body);
      return new Response(null, { status: acceptQuote ? 204 : 503 });
    }
    throw new Error('Unexpected test request ' + url);
  };
  function mount(draft) {
    const dom = new JSDOM(html, { url: 'http://localhost:8888/', pretendToBeVisual: true });
    for (const key of ['window', 'document', 'Event', 'Option', 'FormData', 'sessionStorage', 'location']) globalThis[key] = dom.window[key];
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    if (draft) sessionStorage.setItem('rs-quote-draft-v1', draft);
    return dom;
  }
  let dom = mount();
  const { enhanceQuoteForm } = await import('../public/assets/quote-form.js');
  enhanceQuoteForm();
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  await settle();
  let form = document.forms['quote-request'];
  const input = (name, value) => {
    form.elements[name].value = value;
    form.elements[name].dispatchEvent(new Event('input', { bubbles: true }));
  };
  input('pickup', 'Charlotte, NC');
  input('dropoff', 'Newton, NC');
  assert.equal(document.querySelectorAll('.route-mode-toggle').length, 1);
  document.querySelector('.route-mode-toggle').click();
  assert.equal(document.querySelector('#automatic-locations').hidden, true);
  assert.equal(document.querySelector('#pickup-manual').hidden, false);
  assert.equal(document.querySelector('#dropoff-manual').hidden, false);
  input('pickup_street', 'I-85 exit 40, near the service station');
  input('pickup_city', 'Charlotte'); input('pickup_state', 'NC');
  document.querySelector('.route-mode-toggle').click();
  assert.equal(document.querySelector('#automatic-locations').hidden, false);
  assert.equal(document.querySelector('#pickup-manual').hidden, true);
  assert.equal(document.querySelector('#dropoff-manual').hidden, true);
  assert.equal(form.elements.pickup.value, 'Charlotte, NC');
  assert.equal(form.elements.dropoff.value, 'Newton, NC');
  document.querySelector('.route-mode-toggle').click();
  assert.equal(form.elements.pickup_street.value, 'I-85 exit 40, near the service station');
  form.elements.dropoff_undecided.checked = true;
  form.elements.dropoff_undecided.dispatchEvent(new Event('change', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.match(document.querySelector('.quote-progress-label').textContent, /Step 2/);
  input('service', 'Scheduled vehicle hauling');
  input('pickup_timing', 'Specific date');
  assert.equal(form.elements.pickup_date.required, true);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.match(document.querySelector('.quote-progress-label').textContent, /Step 2/);
  input('pickup_date', '2099-12-01');
  input('details', 'Test vehicle will not start.');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  input('name', 'Local test');
  input('phone', '202-555-0142');
  assert.match(document.querySelector('#quote-summary-details').textContent, /I-85 exit 40/);
  const draft = sessionStorage.getItem('rs-quote-draft-v1');
  dom.window.close(); dom = mount(draft);
  enhanceQuoteForm(); await settle(); form = document.forms['quote-request'];
  const trigger = document.querySelector('[data-quote]');
  trigger.click();
  await settle();
  assert.equal(form.elements.name.value, 'Local test');
  assert.equal(form.elements.pickup_street.value, 'I-85 exit 40, near the service station');
  assert.match(document.querySelector('.quote-progress-label').textContent, /Step 3/);
  document.querySelector('[aria-label="Change timing"]').click();
  assert.match(document.querySelector('.quote-progress-label').textContent, /Step 2/);
  input('pickup_timing', 'Flexible');
  assert.equal(form.elements.pickup_date.disabled, true);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.match(document.querySelector('.quote-progress-label').textContent, /Step 3/);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(submitted.get('pickup_timing'), 'Flexible');
  assert.equal(submitted.has('pickup_date'), false);
  assert.equal(submitted.get('dropoff'), 'Unsure');
  assert.equal(submitted.get('pickup_accuracy'), 'Manual location — owner confirmation needed');
  assert.match(document.querySelector('.submit-status').textContent, /could not be confirmed/);
  assert.equal(form.elements.name.value, 'Local test');
  assert.ok(sessionStorage.getItem('rs-quote-draft-v1'));
  const requestId = submitted.get('request_id');
  const dialog = document.querySelector('#quote-dialog');
  const success = dialog.querySelector('.quote-success');
  acceptQuote = true;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(success.hidden, true);
  await settle();
  assert.equal(submitted.get('request_id'), requestId);
  assert.equal(location.pathname, '/');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('.quote-entry').hidden, true);
  assert.equal(success.hidden, false);
  assert.equal(success.querySelector('#quote-success-preview').hidden, false);
  assert.equal(document.activeElement.id, 'quote-success-title');
  assert.equal(sessionStorage.getItem('rs-quote-draft-v1'), null);
  success.querySelector('.quote-done').click();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(sessionStorage.getItem('rs-quote-draft-v1'), null);
  trigger.click();
  await settle();
  assert.equal(dialog.open, true);
  assert.equal(success.hidden, true);
  assert.equal(dialog.getAttribute('aria-labelledby'), 'quote-dialog-title');
  assert.match(dialog.querySelector('.quote-progress-label').textContent, /Step 1/);
  assert.equal(form.elements.name.value, '');
  document.querySelector('.quote-reset').click();
  assert.equal(form.elements.name.value, '');
  assert.equal(form.elements.pickup.readOnly, false);
  assert.equal(form.elements.pickup.value, '');
  assert.equal(form.elements.dropoff.value, '');
  input('pickup', 'Charlotte, NC'); input('dropoff', 'Newton, NC');
  document.querySelector('.route-mode-toggle').click();
  input('dropoff_street', '100 Example Street');
  input('dropoff_city', 'Charlotte'); input('dropoff_state', 'NC');
  form.elements.dropoff_undecided.checked = true;
  form.elements.dropoff_undecided.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('.route-mode-toggle').click();
  form.elements.dropoff_undecided.checked = false;
  form.elements.dropoff_undecided.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(form.elements.dropoff.value, 'Newton, NC');
  form.elements.dropoff_undecided.checked = true;
  form.elements.dropoff_undecided.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('.route-mode-toggle').click();
  document.querySelector('.route-mode-toggle').click();
  form.elements.dropoff_undecided.checked = false;
  form.elements.dropoff_undecided.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(form.elements.dropoff.value, 'Newton, NC');
  dom.window.close();
});


test('public submissions reject impossible dates and oversized review names while preserving optional email', () => {
  const quote = { 'form-name': 'quote-request', pickup: 'Charlotte, NC', dropoff: 'Raleigh, NC',
    name: 'Test customer', phone: '202-555-0142', service: 'Equipment hauling', details: 'Move a tractor.',
    pickup_timing: 'Specific date', pickup_date: '2028-02-29' };
  assert.doesNotThrow(() => validateSubmission(quote));
  for (const date of ['2026-02-29', '2026-02-31', '2026-13-01']) {
    assert.throws(() => validateSubmission({ ...quote, pickup_date: date }), /pickup date/);
  }
  assert.doesNotThrow(() => validateSubmission({ ...quote, email: 'dispatch+test@example.com' }));
  assert.throws(() => validateSubmission({ ...quote, email: 'invalid email' }), /email/);
  const review = { 'form-name': 'customer-review', rating: '4', review: 'Helpful service.' };
  assert.doesNotThrow(() => validateSubmission(review));
  assert.throws(() => validateSubmission({ ...review, first_name: 'a'.repeat(81) }), /first name/);
});
