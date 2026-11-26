import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { changeReviewPublication, reviewHomepage } from '../netlify/lib/review-publication.mjs';
import { defaults } from '../public/assets/business-defaults.js';

test('admin sections hide fields, preview drafts, reveal invalid fields, and preserve enquiry notes', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8888/admin/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'Event', 'Option', 'FormData', 'location', 'history']) globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.matchMedia = () => ({ matches: false });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let settings = structuredClone(defaults), contentWrites = 0, inboxReads = 0;
  const uploadRequests = [], canvasSizes = [];
  globalThis.createImageBitmap = async () => ({ width: 3000, height: 1500, close() {} });
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { drawImage() {} }; };
  dom.window.HTMLCanvasElement.prototype.toDataURL = function () { canvasSizes.push([this.width, this.height]); return 'data:image/webp;base64,UklGRg=='; };
  let reviewPublication = null;
  const records = [
    { id: 'new-job', form_name: 'quote-request', created_at: '2026-11-17T13:00:00Z', data: { name: 'New customer', pickup: 'Charlotte, NC', dropoff: 'Newton, NC', service: 'Equipment hauling', pickup_timing: 'Flexible', details: 'Test load' } },
    { id: 'active-job', jobNumber: 'RS-202611-TOW-0001', form_name: 'quote-request', created_at: '2026-11-17T12:00:00Z', state: { status: 'Contacted', note: 'Saved note' }, data: { name: 'Active customer', pickup: 'Charlotte, NC', dropoff: 'Unsure', service: 'Vehicle towing or transport', pickup_timing: 'Today' } },
    { id: 'private-review', form_name: 'customer-review', created_at: '2026-11-17T11:00:00Z', data: { first_name: 'Jamie', rating: '4', review: '<script>Private feedback</script>', 'publish-permission': '' } },
  ];
  globalThis.fetch = async (url, options) => {
    if (url === '/assets/us-places.json') return Response.json([['Charlotte, NC', 35.227, -80.843]]);
    if (url.startsWith('/.netlify/functions/owner-media')) {
      if (options?.method === 'POST') {
        const upload = JSON.parse(options.body); uploadRequests.push(upload);
        return Response.json({ src: '/.netlify/functions/site-image?id=' + upload.id, width: upload.width, height: upload.height, alt: upload.alt });
      }
      return Response.json({ items: [], nextOffset: null });
    }
    const action = new URL(url, location.href).searchParams.get('action');
    if (action === 'session') return Response.json({ localPreview: true, role: 'Owner', permissions: ['jobs', 'content', 'reviews', 'export', 'activity'], user: { id: 'fixture-owner', email: 'Local preview' } });
    if (action === 'profile') return Response.json({ data: null, revision: null });
    if (action === 'content') {
      if (options?.method === 'POST') { settings = JSON.parse(options.body).data; contentWrites++; }
      return Response.json({ data: settings, revision: 'revision-' + contentWrites });
    }
    if (action === 'list') {
      inboxReads++;
      return Response.json({ items: records, homepageReviews: reviewHomepage(reviewPublication, records) });
    }
    if (action === 'review' && options?.method === 'POST') {
      const action = JSON.parse(options.body);
      reviewPublication = changeReviewPublication(reviewPublication, records, action, 'fixture-owner').snapshot;
      const review = records.find(record => record.id === action.id);
      review.state = reviewPublication.decisions[action.id];
      return Response.json({ revision: action.publication });
    }
    throw new Error('Unexpected request ' + url);
  };
  await import('../src/admin/index.js');
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  await settle();
  const $ = selector => document.querySelector(selector);
  assert.equal($('#owner-workspace').hidden, false);
  assert.equal($('.editor-section[open]'), null);
  assert.equal(document.querySelectorAll('.metric-card').length, 3);
  assert.equal($('.notification-trigger').getAttribute('aria-label'), 'Notifications, 2 unread');
  $('.notification-trigger').click();
  assert.equal(inboxReads, 1, 'Opening immediately reuses the loaded inbox');
  assert.equal(document.activeElement.id, 'notification-heading');
  assert.equal(document.querySelectorAll('.notification-item').length, 2);
  $('.notification-item').click();
  assert.equal(location.hash, '#enquiries');
  assert.match($('#enquiry-detail').textContent, /New customer/);
  assert.equal($('.notification-trigger').getAttribute('aria-label'), 'Notifications, 1 unread');
  $('.notification-trigger').click();
  $('.notification-read-all').click();
  assert.equal($('.notification-badge').hidden, true);
  assert.ok(dom.window.localStorage.getItem('rs-workspace-notifications-v1:fixture-owner'));
  $('#notification-heading').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('#notification-panel').hidden, true);
  assert.equal(document.activeElement, $('.notification-trigger'));
  $('[data-owner-view="overview"]').click();
  document.documentElement.scrollTop = 500;
  document.querySelectorAll('.metric-card')[1].click();
  assert.equal(document.documentElement.scrollTop, 0, 'switching sections brings the new page heading into view');
  assert.equal(document.activeElement.id, 'workspace-title', 'section changes announce the page heading to keyboard and screen-reader users');
  assert.equal($('#enquiry-filter').value, 'active');
  assert.equal(document.querySelectorAll('.enquiry-row').length, 1);
  assert.match($('.enquiry-row').textContent, /Active customer/);
  assert.match($('.enquiry-reference').textContent, /RS-202611-TOW-0001/);
  $('.enquiry-row').click();
  assert.equal(location.hash, '#enquiries/RS-202611-TOW-0001');
  $('#enquiry-search').value = 'rs 202611 tow 0001';
  $('#enquiry-search').dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('.enquiry-row').length, 1);
  $('#enquiry-search').value = '';
  $('#enquiry-search').dispatchEvent(new Event('input', { bubbles: true }));
  $('#enquiry-tab-2').click();
  $('#owner-field-note').value = 'Unsaved note, keep it';
  $('#owner-field-note').dispatchEvent(new Event('input', { bubbles: true }));
  $('#enquiry-search').value = 'does not exist';
  $('#enquiry-search').dispatchEvent(new Event('input', { bubbles: true }));
  $('#enquiry-search').value = '';
  $('#enquiry-search').dispatchEvent(new Event('input', { bubbles: true }));
  $('#enquiry-tab-2').click();
  assert.equal($('#owner-field-note').value, 'Unsaved note, keep it');
  $('[data-owner-view="website"]').click();
  const opening = $('[data-section="opening"]'); opening.open = true;
  opening.dispatchEvent(new Event('toggle'));
  document.querySelector('[aria-label="Change homepage photo"]').click();
  assert.equal($('#image-picker-dialog').open, true);
  $('[data-media-tab="library"]').click(); await settle();
  document.querySelector('[data-image-src="/assets/flatbed-freight.webp"]').click();
  $('#image-picker-use').click(); await settle();
  assert.equal($('#image-picker-dialog').open, false);
  assert.equal($('#section-preview .site-mini-hero > img').getAttribute('src'), '/assets/flatbed-freight.webp');
  assert.equal(contentWrites, 0, 'Choosing an image only changes the draft.');
  $('#content-discard').click();
  assert.equal($('#section-preview .site-mini-hero > img').getAttribute('src'), defaults.heroImage.src);
  const photoDrop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(photoDrop, 'dataTransfer', { value: { files: [{ type: 'image/png', size: 3000, name: 'Equipment photo.png' }] } });
  $('.website-image-current').dispatchEvent(photoDrop); await settle();
  assert.equal($('#image-picker-dialog').open, true);
  assert.match($('#image-picker-file-info').textContent, /Equipment photo.png/);
  assert.deepEqual(canvasSizes, [[1920, 960]], 'Large device images are prepared at a bounded size.');
  assert.equal($('#image-picker-alt').value, '', 'A new image needs its own description.');
  $('#image-picker-alt').value = 'Our truck carrying a tractor';
  $('#image-picker-use').click(); await settle();
  assert.equal(uploadRequests.length, 1);
  assert.equal($('#image-picker-dialog').open, false);
  assert.equal($('#section-preview .site-mini-hero > img').getAttribute('src'), '/.netlify/functions/site-image?id=' + uploadRequests[0].id);
  assert.equal(contentWrites, 0, 'Uploading an image must not publish the website.');
  $('#content-discard').click();
  assert.equal($('#section-preview .site-mini-hero > img').getAttribute('src'), defaults.heroImage.src);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [{ type: 'application/pdf', size: 10 }] } });
  $('.website-image-current').dispatchEvent(drop); await settle();
  assert.match($('#image-picker-status').textContent, /JPG/);
  $('#image-picker-dialog').close();
  $('#owner-field-headline').value = 'Draft only headline';
  $('#owner-field-headline').dispatchEvent(new Event('input', { bubbles: true }));
  assert.match($('#section-preview').textContent, /Draft only headline/);
  assert.equal(contentWrites, 0);
  const contact = $('[data-section="contact"]'); contact.open = true;
  contact.dispatchEvent(new Event('toggle'));
  assert.equal(opening.open, false);
  assert.equal($('#owner-field-headline').value, 'Draft only headline');
  $('#owner-field-email').value = 'bad email'; contact.open = false;
  $('#content-publish').click();
  assert.equal(contentWrites, 0);
  assert.equal(contact.open, true);
  assert.equal(document.activeElement.id, 'owner-field-email');
  $('#owner-field-email').value = defaults.email;
  $('#content-publish').click(); await settle();
  assert.equal(contentWrites, 1);
  assert.equal(settings.headline, 'Draft only headline');
  assert.equal($('#content-publish').disabled, true);
  $('[data-owner-view="reviews"]').click();
  const category = key => $('[data-review-category="' + key + '"]');
  const mainReviewAction = () => $('.review-row-actions > button');
  assert.equal(category('ready').getAttribute('aria-pressed'), 'true');
  assert.equal($('#review-average-score').textContent, '4.0');
  assert.match($('#review-average-count').textContent, /^1 rating /);
  assert.equal(document.querySelectorAll('#review-trend-months li').length, 6);
  assert.match($('#review-trend-months li:last-child .sr-only').textContent, /, \d+ reviews?$/);
  assert.match($('#owner-review-list').textContent, /No reviews are ready/);
  category('private').click();
  assert.equal(category('private').getAttribute('aria-pressed'), 'true');
  assert.equal(mainReviewAction(), null);
  assert.match($('#review-list-note').textContent, /did not agree to have their feedback published/);
  assert.match($('.review-row blockquote').textContent, /<script>Private feedback<\/script>/);
  assert.equal($('.review-row script'), null);
  assert.equal($('.review-rating').getAttribute('aria-label'), '4 out of 5 stars');
  assert.equal(document.querySelectorAll('.review-rating .is-filled').length, 4);
  assert.equal(document.querySelectorAll('.review-rating svg').length, 5);
  assert.equal($('.review-more').open, false);
  assert.equal($('.review-more-menu button').textContent, 'Mark as spam');
  assert.equal($('#review-preview-dialog'), null);
  assert.equal(category('homepage'), null);
  assert.equal(document.querySelectorAll('.review-slot-add').length, 3);
  assert.match($('#review-slots-status').textContent, /^0 of 3 slots filled/);
  records.push({ ...records[0], id: 'later-job', created_at: '2026-11-17T14:00:00Z', data: { ...records[0].data, name: 'Later customer' } });
  $('.notification-trigger').click();
  $('.notification-refresh').click();
  await settle();
  assert.equal(inboxReads, 2);
  assert.equal($('.notification-trigger').getAttribute('aria-label'), 'Notifications, 1 unread');
  assert.match($('.notification-item').textContent, /Later customer/);
  const review = records.find(record => record.id === 'private-review');
  review.data['publish-permission'] = 'yes';
  review.state = { publication: 'Unpublished' };
  $('#owner-reviews .owner-refresh').click();
  await settle();
  $('.review-slot-add').click();
  assert.equal(document.activeElement, mainReviewAction());
  assert.equal(mainReviewAction().textContent, 'Add to homepage');
  mainReviewAction().click();
  await settle();
  assert.match($('#owner-review-list').textContent, /No reviews are ready/);
  assert.equal(document.activeElement, $('.review-slot h3'));
  assert.match($('.review-slot h3').textContent, /Jamie/);
  assert.equal(document.querySelectorAll('.review-slot-add').length, 2);
  $('.review-slot-remove').click();
  await settle();
  assert.equal(document.querySelectorAll('.review-slot-add').length, 3);
  assert.equal(document.activeElement, $('.review-slot-add'));
  assert.equal(mainReviewAction().textContent, 'Add to homepage');
  $('.review-more summary').click();
  assert.equal($('.review-more').open, true);
  $('.review-more-menu button').click();
  await settle();
  assert.match($('#owner-review-list').textContent, /No reviews are ready/);
  category('spam').click();
  assert.equal($('#review-average-scale').hidden, true);
  assert.equal($('#review-average-count').textContent, 'No ratings yet');
  assert.equal(mainReviewAction().textContent, 'Restore review');
  mainReviewAction().click();
  await settle();
  assert.match($('#owner-review-list').textContent, /No reviews marked as spam/);
  assert.equal($('#review-average-score').textContent, '4.0');

  const currentMonth = new Date().toISOString();
  review.created_at = currentMonth;
  records.push({
    ...review,
    id: 'another-rating',
    created_at: currentMonth,
    state: { publication: 'Unpublished' },
    data: { ...review.data, rating: '5', 'publish-permission': '' },
  });
  $('#owner-reviews .owner-refresh').click();
  await settle();
  assert.equal($('#review-average-score').textContent, '4.5');
  assert.equal($('#review-trend-months li:last-child .review-trend-value').textContent, '2');
  category('ready').click();
  assert.equal(mainReviewAction().textContent, 'Add to homepage');
  $('#review-search').value = 'a different customer';
  $('#review-search').dispatchEvent(new Event('input'));
  assert.match($('#owner-review-list').textContent, /No reviews match your search/);
  dom.window.close();
});
