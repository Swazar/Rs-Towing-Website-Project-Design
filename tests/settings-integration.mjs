import assert from 'node:assert/strict';
import { preferences } from '../public/assets/admin-preferences.js';
import { resolveWorkspace, workspaceDefaults } from '../public/assets/workspace-config.js';

const origin = 'http://localhost:8888';
async function api(action, body) {
  const response = await fetch(origin + '/.netlify/functions/owner?action=' + action, body ? {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  return { status: response.status, data: await response.json() };
}
const session = await api('session');
assert.equal(session.status, 200);
assert.equal(session.data.localPreview, true, 'this check must only run against the local preview');
const original = (await api('profile')).data;
const before = { displayName: original.data?.displayName || 'Owner', avatar: original.data?.avatar || '', phone: original.data?.phone || '', jobTitle: original.data?.jobTitle || '', ...preferences(original.data), workspace: resolveWorkspace(original.data?.workspace) };
let saved;
try {
  const invalid = await api('profile', { ...before, timeZone: 'Invalid/Zone', revision: original.revision });
  assert.equal(invalid.status, 400);
  assert.equal((await api('profile')).data.revision, original.revision);
  const workspace = { ...workspaceDefaults(), theme: 'ocean', preset: 'spacious', layout: 'single', fontSize: 125, hiddenPanels: ['map'], panelOrder: [...workspaceDefaults().panelOrder].reverse() };
  const invalidLayout = await api('profile', { ...before, workspace: { ...workspace, fontSize: 900 }, revision: original.revision });
  assert.equal(invalidLayout.status, 400);
  const result = await api('profile', { ...before, workspace, timeZone: 'UTC', timeFormat: '24h', email: 'not-the-user@example.com', roles: ['staff'], revision: original.revision });
  assert.equal(result.status, 200); saved = result.data;
  const reloaded = (await api('profile')).data;
  assert.equal(reloaded.data.timeZone, 'UTC');
  assert.equal(reloaded.data.timeFormat, '24h');
  assert.deepEqual(reloaded.data.workspace, workspace);
  assert.equal(reloaded.data.displayName, before.displayName);
  assert.equal(reloaded.data.avatar, before.avatar);
  assert.equal('email' in reloaded.data, false);
  assert.equal('roles' in reloaded.data, false);
  assert.equal((await api('session')).data.role, session.data.role);
  assert.equal((await api('profile', { ...before, revision: original.revision })).status, 409);
  console.log('Local profile and workspace save/reload, validation, stale-save protection, and role isolation passed.');
} finally {
  if (saved) {
    const restored = await api('profile', { ...before, revision: saved.revision });
    assert.equal(restored.status, 200, 'restore the original local profile');
    assert.deepEqual(restored.data.data, before);
    console.log('Original local profile and time preferences restored.');
  }
}
