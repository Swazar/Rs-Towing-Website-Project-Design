import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { validateProfile } from '../netlify/lib/profile.mjs';
import { preferences, formatClock, formatTimestamp, formatBusinessTime } from '../public/assets/admin-preferences.js';
import { businessDateKey, filterEnquiries } from '../public/assets/admin-data.js';
import { AccountSettings } from '../public/assets/admin-settings.js';
import { prepareAvatar } from '../public/assets/admin-operations.js';
import { workspaceDefaults } from '../public/assets/workspace-config.js';

test('personal settings validate timezones and keep identity and permissions server controlled', () => {
  const previous = { displayName: 'Alex', avatar: '', phone: '+1 202 555 0101', jobTitle: 'Operator', timeZone: 'America/Chicago', timeFormat: '24h' };
  const saved = validateProfile({ displayName: '  Alex R.  ', email: 'other@example.com', roles: ['owner'], id: 'other-user' }, previous);
  assert.deepEqual(saved, { ...previous, displayName: 'Alex R.', workspace: workspaceDefaults() });
  for (const timeZone of ['not-a-timezone', '', {}, 'a'.repeat(101)]) assert.throws(() => validateProfile({ displayName: 'Alex', timeZone }), /timezone/);
  assert.throws(() => validateProfile({ displayName: 'Alex', timeFormat: '25h' }), /clock/);
  assert.throws(() => validateProfile({ displayName: 'Alex', avatar: 'data:image/svg+xml,<svg/>' }), /photo/);
  assert.throws(() => validateProfile({ displayName: 'Alex', phone: '1'.repeat(41) }), /phone/);
  assert.deepEqual(preferences(null), { timeZone: 'America/New_York', timeFormat: '12h' });
});

test('clock preferences respect DST and midnight while business dates and filters stay Eastern', () => {
  const instant = new Date('2026-07-01T00:30:00Z');
  const pacific = { timeZone: 'America/Los_Angeles', timeFormat: '24h' };
  assert.equal(formatClock(instant, pacific), '17:30:00');
  assert.match(formatTimestamp(instant, pacific), /Jun 30, 2026, 17:30/);
  assert.equal(formatClock(new Date('2026-07-01T00:00:00Z'), { timeZone: 'UTC', timeFormat: '24h' }), '00:00:00');
  assert.equal(formatBusinessTime('00:05', { timeFormat: '12h' }), '12:05 AM');
  assert.equal(formatBusinessTime('15:30', pacific), '15:30');
  assert.equal(formatBusinessTime('15:30', { timeFormat: '12h' }), '3:30 PM');
  assert.equal(businessDateKey(new Date('2026-07-01T04:30:00Z')), '2026-07-01', 'Eastern summer time uses daylight saving');
  assert.equal(businessDateKey(new Date('2026-01-01T04:30:00Z')), '2025-12-31', 'Eastern winter time uses standard time');
  const item = { form_name: 'quote-request', created_at: instant.toISOString(), data: {} };
  assert.equal(filterEnquiries([item], { from: '2026-06-30', to: '2026-06-30' }).length, 1);
});

test('settings apply workspace changes only after saving and preserve drafts on navigation or failure', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8888/admin/#settings' });
  globalThis.document = dom.window.document;
  const session = { user: { email: 'alex@example.com' }, role: 'Staff', permissions: ['jobs'] };
  let stored = { data: { displayName: 'Alex', avatar: '', timeZone: 'America/New_York', timeFormat: '12h' }, revision: 'one' }, fail = true;
  const applied = [];
  const editor = new AccountSettings({ applyWorkspace: value => applied.push(structuredClone(value)), api: async (action, body) => {
    assert.equal(action, 'profile');
    if (fail) throw new Error('Save unavailable. Please retry.');
    assert.equal(body.revision, stored.revision);
    stored = { data: validateProfile(body, stored.data), revision: 'two' }; return stored;
  }, onSaved: saved => editor.load(saved, session) });
  const $ = selector => document.querySelector(selector);
  editor.load(stored, session);
  assert.equal(applied.length, 1);
  assert.match($('#settings-clock-value').textContent, /^\d\d:\d\d:\d\d$/);
  assert.match($('#settings-clock-period').textContent, /^[AP]M$/);
  $('[name="workspace-theme"][value="ocean"]').click();
  $('[name="workspacePreset"][value="spacious"]').click();
  $('[data-panel="map"]').click();
  assert.equal(applied.length, 1, 'choosing theme, preset, or visibility must not apply a draft');
  editor.setActive(false); editor.setActive(true); editor.setActive(false);
  assert.equal(editor.customizer.value.theme, 'ocean', 'leaving Settings retains the pending selection');
  assert.equal(applied.length, 1, 'other sections continue using saved preferences');
  $('#profile-display-name').value = 'Alex Rivera';
  $('#profile-phone').value = '+1 202 555 0101';
  $('#profile-job-title').value = 'Dispatcher';
  $('#profile-timezone').value = 'America/Los_Angeles';
  $('#profile-time-format').value = '24h';
  $('#profile-timezone').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(editor.dirty, true);
  assert.match($('#settings-clock-zone').textContent, /Pacific/);
  assert.equal($('#settings-clock-period').hidden, true);
  await editor.save();
  assert.equal(applied.length, 1, 'a failed save does not apply the draft');
  assert.match($('#profile-status').textContent, /retry/);
  assert.equal($('#profile-display-name').value, 'Alex Rivera');
  assert.equal($('#profile-save').disabled, false);
  fail = false; await editor.save();
  assert.equal(applied.length, 2);
  assert.equal(applied.at(-1).theme, 'ocean');
  assert.equal(applied.at(-1).preset, 'spacious');
  assert.ok(applied.at(-1).hiddenPanels.includes('map'));
  assert.equal(stored.data.timeZone, 'America/Los_Angeles');
  assert.equal(stored.data.timeFormat, '24h');
  assert.equal(stored.data.phone, '+1 202 555 0101');
  assert.equal(editor.dirty, false);
  assert.equal($('#profile-email').textContent, 'alex@example.com');
  assert.equal($('#profile-role').textContent, 'Staff');
  $('#profile-display-name').value = 'Unsaved'; editor.markDirty();
  $('#profile-discard').click();
  assert.equal($('#profile-display-name').value, 'Alex Rivera');
  assert.equal($('#profile-time-format').value, '24h');
  assert.equal($('#profile-save').disabled, true);
  editor.setActive(true); assert.ok(editor.timer);
  editor.setActive(false); assert.equal(editor.timer, undefined);
  editor.load(structuredClone(stored), session);
  assert.equal($('#profile-phone').value, '+1 202 555 0101', 'saved fields reload from the account record');
  dom.window.close();
});

test('profile photo preparation fits wide and tall photos without discarding their edges', async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  const draws = [];
  const canvas = { getContext: () => ({ fillRect() {}, drawImage: (...args) => draws.push(args.slice(1)) }), toDataURL: () => 'data:image/jpeg;base64,AA==' };
  globalThis.document = { createElement: () => canvas };
  try {
    for (const [width, height] of [[512, 256], [256, 512]]) {
      let closed = false;
      globalThis.createImageBitmap = async () => ({ width, height, close() { closed = true; } });
      await prepareAvatar({ type: 'image/jpeg', size: 5000 });
      assert.equal(closed, true);
    }
    assert.deepEqual(draws, [[0, 64, 256, 128], [64, 0, 128, 256]]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});
