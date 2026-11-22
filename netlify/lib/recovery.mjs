import { defaults } from '../../public/assets/business-defaults.js';
import { addHistory } from './owner-access.mjs';
import { writeRecord } from './store.mjs';

const maxVersions = 20;
const initialEnquiry = { status: 'New', note: '', followUp: '', scheduledDate: '', scheduledTime: '', priceCents: null };

export function activeData(data) {
  if (!data) return null;
  const { versions, ...active } = data;
  return active;
}

function snapshot(key, data) {
  const initial = key === 'settings' ? defaults : initialEnquiry;
  return Object.fromEntries(Object.entries(initial).map(([field, fallback]) => [field, data?.[field] ?? fallback]));
}

export function versionsFor(key, data) {
  return (data?.versions || []).map(({ id, at, data: saved }) => ({ id, at, data: snapshot(key, saved) }));
}

export async function saveRecoverable(key, next, current, revision, actor, action, subject) {
  const before = snapshot(key, current.data);
  let versions = current.data?.versions || [];
  if (JSON.stringify(before) !== JSON.stringify(snapshot(key, next))) {
    versions = [{ id: crypto.randomUUID(), at: new Date().toISOString(), data: before }, ...versions].slice(0, maxVersions);
  }
  const saved = await writeRecord(key, {
    ...activeData(next), updatedAt: new Date().toISOString(), updatedBy: actor.email,
    history: addHistory(current.data, actor, action, subject), versions,
  }, revision);
  return { ...saved, data: activeData(saved.data) };
}
