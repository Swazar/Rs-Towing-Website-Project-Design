import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { permissionsFor, canUseAction, addHistory } from '../netlify/lib/owner-access.mjs';
import { validDate, monthDays, calendarEvents, enquiryCSV, filterEnquiries, locationPoint } from '../public/assets/admin-data.js';
import { JobMap } from '../public/assets/admin-job-map.js';

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
  item = { data: { pickup: '100 Example Road, Charlotte, NC', pickup_accuracy: 'Manual location — owner confirmation needed', pickup_point: '35.227,-80.843' } };
  assert.equal(locationPoint(item, 'pickup', places), null);
  item = { data: { pickup: 'Example Road, Charlotte, NC', pickup_accuracy: 'Street only', pickup_point: '35.227,-80.843' } };
  assert.equal(locationPoint(item, 'pickup', places).approximate, true);
  assert.equal(locationPoint({ data: { pickup: 'Unmatched address', pickup_point: ', ' } }, 'pickup', places), null);
});

test('job map keeps manual addresses useful and only fetches a driving route on request', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html);
  const globals = { document: window.document, Option: window.Option };
  const previous = new Map(['document', 'Option', 'fetch'].map(name => [name, globalThis[name]]));
  Object.assign(globalThis, globals);
  const { document } = window;
  const get = name => document.querySelector('#overview-map-' + name);
  const calls = [];
  let completeRoute;
  globalThis.fetch = async (path, options) => {
    calls.push(path);
    if (path.endsWith('us-places.json')) return Response.json([['Charlotte, NC', 35.227, -80.843]]);
    assert.equal(path, '/.netlify/functions/route-preview');
    assert.deepEqual(JSON.parse(options.body), { pickup: '35.227,-80.843', dropoff: '35.77,-78.64' });
    return new Promise(resolve => {
      completeRoute = () => resolve(Response.json({ miles: 162, minutes: 145, path: [[[35.227, -80.843], [35.77, -78.64]]] }));
    });
  };
  const job = { id: 'job-1', jobNumber: 'RS-202611-TOW-0001', data: {
    name: 'Fixture driver', service: 'Vehicle towing', pickup: 'Charlotte, NC',
    dropoff: '10 Example Street, Raleigh, NC', dropoff_point: '35.77,-78.64',
  } };
  const manual = { id: 'job-2', data: {
    name: 'Fixture customer', pickup: '22 Example Lane', pickup_accuracy: 'Manual location', dropoff: 'Unsure',
  } };
  let opened;
  let roadLines = 0;
  const bounds = { extend: () => bounds };
  const map = new JobMap(document.querySelector('.jobs-map-panel'), item => { opened = item; });
  map.L = { polyline: () => ({ addTo: () => { roadLines++; return { getBounds: () => bounds }; } }) };
  map.initializeMap = () => {
    map.map = { fitBounds() {}, invalidateSize() {} };
    map.road = { clearLayers() {} };
    map.pins = { getLayers: () => ['fixture'], getBounds: () => bounds };
  };
  map.drawPins = () => {};
  function selectJob(value) {
    get('request').value = value;
    get('request').dispatchEvent(new window.Event('change'));
  }
  try {
    map.update([job, manual]);
    assert.deepEqual(calls, [], 'hidden map makes no requests');
    document.querySelector('#owner-workspace').hidden = false;
    map.setActive(true);
    await setImmediate();
    assert.match(get('caption').textContent, /2 stops mapped/);
    selectJob(job.id);
    await setImmediate();
    assert.match(get('request').selectedOptions[0].textContent, /RS-202611-TOW-0001/);
    assert.match(get('stops').textContent, /Charlotte, NCApproximate pin/);
    assert.equal(get('route').hidden, false);
    assert.deepEqual(calls, ['/assets/us-places.json']);

    get('route').click();
    selectJob(manual.id);
    completeRoute();
    await setImmediate();
    assert.equal(roadLines, 0, 'a late route reply cannot appear on another job');
    assert.match(get('stops').textContent, /22 Example LaneNeeds confirmation.*Not decided/);
    assert.equal(get('route').hidden, true);
    assert.equal(new URL(get('directions').href).searchParams.get('query'), manual.data.pickup);
    get('open').click();
    assert.equal(opened, manual);

    selectJob(job.id);
    await setImmediate();
    get('route').click();
    completeRoute();
    await setImmediate();
    assert.match(get('caption').textContent, /162 mi · About 2 hr 25 min · Approximate endpoints/);
    assert.equal(get('route').textContent, 'Hide route');
    get('route').click();
    get('route').click();
    await setImmediate();
    assert.equal(calls.filter(path => path.endsWith('route-preview')).length, 2, 'reopening the same route uses its cached result');

    selectJob('');
    await setImmediate();
    map.update([{ ...job, state: { status: 'Booked' } }, manual]);
    await setImmediate();
    assert.equal(get('request').value, '', 'refreshing keeps the all-open selection');
    assert.equal(get('summary').hidden, true);
    assert.match(get('caption').textContent, /2 stops mapped · 1 approximate · 1 need confirmation/);
  } finally {
    window.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
