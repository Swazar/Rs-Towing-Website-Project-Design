import { homepageReviewLimit } from '../public/assets/public-reviews.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = 'http://localhost:8888';
async function request(path, body, origin = base) {
  const response = await fetch(base + '/.netlify/functions/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  } : {});
  return { status: response.status, data: await response.json() };
}
async function submit(fields, id = randomUUID()) {
  const response = await fetch(base + '/.netlify/functions/local-submission', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ ...fields, request_id: id }),
  });
  assert.equal(response.status, 200);
}
const session = await request('owner?action=session');
assert.equal(session.data.localPreview, true, 'Run this test only against the local preview.');
const original = (await request('owner?action=content')).data;
const changed = structuredClone(original.data);
changed.headline = 'LOCAL TEST — content publishing';
const save = await request('owner?action=content', { data: changed, revision: original.revision });
assert.equal(save.status, 200);
try {
  const publicContent = (await request('site-content')).data;
  assert.equal(publicContent.settings.headline, changed.headline);
  assert.equal(publicContent.settings.updatedBy, undefined);
  const stale = await request('owner?action=content', { data: changed, revision: original.revision });
  assert.equal(stale.status, 409);
  const crossOrigin = await request('owner?action=content', { data: changed, revision: save.data.revision }, 'https://untrusted.example');
  assert.equal(crossOrigin.status, 403);
} finally {
  const restore = await request('owner?action=content', { data: original.data, revision: save.data.revision });
  assert.equal(restore.status, 200);
}
const marker = 'LOCAL TEST ' + randomUUID().slice(0, 8);
const quoteId = randomUUID();
const quoteFields = {
  'form-name': 'quote-request', name: marker, phone: '202-555-0142', pickup: 'Charlotte, NC', dropoff: 'Unsure',
  pickup_timing: 'Flexible', service: 'Scheduled vehicle hauling', details: 'Fictional enquiry for the local workflow test.',
};
await submit(quoteFields, quoteId);
await submit(quoteFields, quoteId);
let enquiries = (await request('owner?action=list')).data.items.filter(item => item.id === quoteId);
assert.equal(enquiries.length, 1, 'Retrying the same local request must not create another enquiry.');
assert.match(enquiries[0].jobNumber, /^RS-\d{6}-VEH-\d{4,}$/);
const enquirySave = await request('owner?action=enquiry', {
  id: quoteId, revision: enquiries[0].revision, status: 'Contacted', note: 'Local test note.', followUp: '',
});
assert.equal(enquirySave.status, 200);
assert.equal((await request('owner?action=enquiry', {
  id: quoteId, revision: enquiries[0].revision, status: 'Booked', note: '', followUp: '',
})).status, 409);
await submit({ 'form-name': 'customer-review', first_name: marker, review: 'Fictional feedback for the local publishing test.', rating: '4', email: 'private@example.com', 'publish-permission': 'yes' });
await submit({ 'form-name': 'customer-review', first_name: marker + ' private', review: 'Private local test feedback.', rating: '2' });
const starting = (await request('owner?action=list')).data;
const publicItem = starting.items.find(item => item.data.first_name === marker);
const privateItem = starting.items.find(item => item.data.first_name === marker + ' private');
assert.equal((await request('owner?action=review', { id: privateItem.id, publication: 'Published', revision: privateItem.revision })).status, 400);
const add = await request('owner?action=review', { id: publicItem.id, publication: 'Published', revision: publicItem.revision });
const reviews = (await request('site-content')).data.reviews;
assert.ok(reviews.length <= homepageReviewLimit);
assert.ok(!JSON.stringify(reviews).includes('private@example.com'));
const publication = (await request('owner?action=list')).data;
assert.ok(!publication.homepageReviews.some(review => review.id === privateItem.id));
if (starting.homepageReviews.length === homepageReviewLimit) {
  assert.equal(add.status, 409);
  assert.deepEqual(publication.homepageReviews, starting.homepageReviews);
  assert.ok(!reviews.some(review => review.name === marker));
} else {
  assert.equal(add.status, 200);
  const onHomepage = publication.homepageReviews.find(review => review.id === publicItem.id);
  assert.equal(onHomepage.name, marker);
  assert.equal(onHomepage.revision, publication.items.find(item => item.id === publicItem.id).revision);
  assert.ok(!Object.hasOwn(reviews.find(review => review.name === marker), 'id'));
  assert.equal((await request('owner?action=review', { id: publicItem.id, publication: 'Unpublished', revision: onHomepage.revision })).status, 200);
  assert.ok(!(await request('site-content')).data.reviews.some(review => review.name === marker));
  assert.ok(!(await request('owner?action=list')).data.homepageReviews.some(review => review.id === publicItem.id));
}
console.log('Passed local submissions/retries, enquiry saves, content publishing, stale-edit protection, origin protection, consent checks, and public/private separation.');
