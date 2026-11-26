import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://localhost:8888';
async function api(action, body, origin = base) {
  const response = await fetch(base + '/.netlify/functions/owner?action=' + action, body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
}
assert.equal((await api('session')).data.localPreview, true, 'This test must run locally.');
const originalProfile = (await api('profile')).data;
assert.equal((await api('profile', { displayName: 'Test', avatar: 'data:image/svg+xml,<svg/>', revision: originalProfile.revision })).status, 400);
let profile = await api('profile', { displayName: 'LOCAL PROFILE TEST', avatar: '', revision: originalProfile.revision });
assert.equal(profile.status, 200);
try {
  assert.equal((await api('profile', { displayName: 'Stale edit', avatar: '', revision: originalProfile.revision })).status, 409);
  assert.equal((await api('profile', { displayName: 'Other origin', avatar: '', revision: profile.data.revision }, 'https://untrusted.example')).status, 403);
} finally {
  assert.equal((await api('profile', { displayName: originalProfile.data?.displayName || 'Owner', avatar: originalProfile.data?.avatar || '', revision: profile.data.revision })).status, 200);
}
const id = randomUUID(), marker = 'LOCAL OPS TEST ' + id.slice(0, 8);
const submit = await fetch(base + '/.netlify/functions/local-submission', {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ request_id: id, 'form-name': 'quote-request', name: marker, phone: '+12025550142', pickup: 'Charlotte, NC', dropoff: 'Raleigh, NC', pickup_point: '35.2271,-80.8431', dropoff_point: '35.7796,-78.6382', service: 'Scheduled vehicle hauling', details: 'Local integration fixture.', pickup_timing: 'Specific date', pickup_date: '2026-11-18' }),
}); assert.equal(submit.status, 200);
let list = (await api('list')).data, item = list.items.find(entry => entry.id === id);
let saved = await api('enquiry', { id, revision: item.revision, status: 'Booked', note: '=1+1', followUp: '2026-11-18', scheduledDate: '2026-11-19', scheduledTime: '09:30' });
assert.equal(saved.status, 200); assert.equal(saved.data.data.scheduledTime, '09:30');
assert.equal((await api('enquiry', { id, revision: saved.data.revision, status: 'Booked', note: '', followUp: '2026-02-31' })).status, 400);
const taskId = randomUUID(), task = { id: taskId, title: marker + ' reminder', date: '2026-11-18', done: false };
let reminder = await api('reminder', { ...task, revision: list.reminders.revision }); assert.equal(reminder.status, 200);
assert.equal((await api('reminder', { ...task, done: true, revision: list.reminders.revision })).status, 409);
reminder = await api('reminder', { ...task, done: true, revision: reminder.data.revision }); assert.equal(reminder.status, 200);
const csvResponse = await fetch(base + '/.netlify/functions/owner?' + new URLSearchParams({ action: 'export', search: marker }));
assert.equal(csvResponse.status, 200); assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
const csv = await csvResponse.text(); assert.match(csv, /09:30/); assert.match(csv, /"'=1\+1"/); assert.match(csv, /"'\+12025550142"/);
list = (await api('list')).data;
assert.ok(list.activity.some(entry => entry.subject === id)); assert.ok(list.activity.some(entry => entry.subject === task.title));
const publicResponse = await fetch(base + '/.netlify/functions/site-content'); const publicJSON = await publicResponse.json();
assert.equal(publicJSON.settings.history, undefined); assert.ok(!JSON.stringify(publicJSON).includes(marker));
assert.equal((await api('enquiry', { id, revision: saved.data.revision, status: 'Closed', note: 'Completed local integration fixture.', followUp: '', scheduledDate: '', scheduledTime: '' })).status, 200);
console.log('Passed profile validation/revisions, reminder persistence/concurrency, confirmed schedules, private history, filtered CSV exports, and public/private separation. Test quote closed; reminder completed; profile restored.');
