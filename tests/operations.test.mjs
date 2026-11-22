import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionsFor, canUseAction, addHistory } from '../netlify/lib/owner-access.mjs';
import { validDate, monthDays, calendarEvents, enquiryCSV, filterEnquiries, locationPoint } from '../public/assets/admin-data.js';

test('staff can manage jobs without receiving owner publication or export permissions', () => {
  const staff = { roles: ['staff'] }, owner = { roles: ['owner'] };
  assert.deepEqual(permissionsFor(staff), ['jobs']);
  for (const action of ['enquiry', 'reminder', 'profile']) assert.equal(canUseAction(staff, action, 'POST'), true);
  for (const action of ['content', 'review', 'export']) assert.equal(canUseAction(staff, action, 'POST'), false);
  assert.equal(canUseAction(staff, 'export', 'GET'), false);
  assert.equal(canUseAction(owner, 'export', 'GET'), true);
  assert.equal(canUseAction({ roles: ['unrecognized'] }, 'session', 'GET'), false);
  const history = addHistory({ history: Array.from({ length: 60 }, (_, index) => ({ id: index })) }, { email: 'owner@example.com' }, 'Saved enquiry', 'request');
  assert.equal(history.length, 50); assert.equal(history[0].actor, 'owner@example.com');
});

test('calendar handles leap days and keeps requested pickup dates separate from confirmed bookings', () => {
  assert.equal(validDate('2028-02-29'), true); assert.equal(validDate('2027-02-29'), false); assert.equal(validDate('2026-02-31'), false);
  const month = monthDays(2028, 1); assert.equal(month.length % 7, 0); assert.equal(month.filter(day => day.inMonth).length, 29);
  const item = { id: 'one', form_name: 'quote-request', data: { name: 'Customer', pickup_date: '2026-11-18' }, state: { followUp: '2026-11-17' } };
  let events = calendarEvents([item]); assert.equal(events.find(event => event.kind === 'requested').date, '2026-11-18');
  item.state.scheduledDate = '2026-11-19'; item.state.scheduledTime = '09:30';
  events = calendarEvents([item], [{ id: 'task', title: 'Check trailer', date: '2026-11-17', done: false }]);
  assert.equal(events.some(event => event.kind === 'requested'), false);
  assert.equal(events.find(event => event.kind === 'pickup').time, '09:30');
  assert.equal(events.filter(event => event.date === '2026-11-17').length, 2);
  item.state.status = 'Closed'; assert.equal(calendarEvents([item]).length, 0);
});

test('filtered exports neutralize spreadsheet formulas and apply Eastern received dates consistently', () => {
  const item = { created_at: '2026-11-18T02:30:00Z', form_name: 'quote-request', data: { name: '=HYPERLINK("unsafe")', phone: '+12025550142', pickup: 'Charlotte, NC', details: 'Comma, and newline\ntext' }, state: { status: 'Contacted', note: '@formula' } };
  assert.equal(filterEnquiries([item], { from: '2026-11-17', to: '2026-11-17', status: 'active' }).length, 1);
  assert.equal(filterEnquiries([item], { from: '2026-11-18' }).length, 0);
  const csv = enquiryCSV([item]); assert.match(csv, /"'=HYPERLINK/); assert.match(csv, /"'\+12025550142"/); assert.match(csv, /"'@formula"/);
});

test('maps label city and street-only coordinates as approximate and never guess a manual street pin', () => {
  const places = [['Charlotte, NC', 35.227, -80.843]];
  let item = { data: { pickup: 'Charlotte, NC', pickup_point: '35.227,-80.843' } };
  assert.equal(locationPoint(item, 'pickup', places).approximate, true);
  item = { data: { pickup: '100 Example Road, Charlotte, NC', pickup_accuracy: 'Manual location — owner confirmation needed' } };
  assert.equal(locationPoint(item, 'pickup', places), null);
  item = { data: { pickup: 'Example Road, Charlotte, NC', pickup_accuracy: 'Street only', pickup_point: '35.227,-80.843' } };
  assert.equal(locationPoint(item, 'pickup', places).approximate, true);
});
